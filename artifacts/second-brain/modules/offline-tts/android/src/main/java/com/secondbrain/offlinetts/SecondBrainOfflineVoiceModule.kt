package com.secondbrain.offlinetts

import android.Manifest
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.Process
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream

private const val VOICE_SAMPLE_RATE = 16_000
private const val MAX_RECORDING_SECONDS = 90
private const val MAX_ARCHIVE_BYTES = 512L * 1024L * 1024L
private const val ASR_ARCHIVE = "voice-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2"
private const val TTS_ARCHIVE = "voice-models/vits-piper-en_US-ljspeech-medium.tar.bz2"
private const val ASR_DIRECTORY = "sherpa-onnx-moonshine-tiny-en-int8"
private const val TTS_DIRECTORY = "vits-piper-en_US-ljspeech-medium"

private data class ModelFiles(
  val root: File,
  val asr: File,
  val tts: File,
)

private data class RecognitionRun(
  val sessionId: Long,
  val recorder: AudioRecord,
  val recording: AtomicBoolean = AtomicBoolean(true),
  val cancelled: AtomicBoolean = AtomicBoolean(false),
)

private data class SpeechRun(
  val id: String,
  val voiceId: String,
  val cancelled: AtomicBoolean = AtomicBoolean(false),
)

class SecondBrainOfflineVoiceModule : Module() {
  private val recognitionExecutor = Executors.newSingleThreadExecutor()
  private val speechExecutor = Executors.newSingleThreadExecutor()
  private val modelLock = Any()
  private val ttsLock = Any()

  @Volatile private var activeRecognition: RecognitionRun? = null
  @Volatile private var activeSpeech: SpeechRun? = null
  @Volatile private var activeAudioTrack: AudioTrack? = null
  @Volatile private var ttsEngine: OfflineTts? = null

  override fun definition() = ModuleDefinition {
    Name("SecondBrainOfflineTts")
    Events("recognitionResult", "recognitionStatus")

    AsyncFunction("getVoiceStatusAsync") {
      ensureModelFiles()
      mapOf(
        "ready" to true,
        "inputAvailable" to true,
        "outputAvailable" to true,
        "language" to "en-US",
        "error" to null,
      )
    }

    AsyncFunction("prepareVoiceModelsAsync") {
      ensureModelFiles()
      mapOf(
        "ready" to true,
        "inputAvailable" to true,
        "outputAvailable" to true,
        "language" to "en-US",
        "error" to null,
      )
    }

    AsyncFunction("getOfflineVoicesAsync") {
      ensureModelFiles()
      listOf(
        mapOf(
          "id" to "piper:en_US-ljspeech-medium",
          "name" to "US English (LJ Speech)",
          "language" to "en-US",
        ),
      )
    }

    AsyncFunction("startRecognitionAsync") {
        sessionId: Long,
        promise: Promise ->
      val context = requireAndroidContext()
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED
      ) {
        promise.reject(
          "ERR_MIC_PERMISSION",
          "Microphone access is required for offline voice input.",
          null,
        )
        return@AsyncFunction
      }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        promise.reject(
          "ERR_ANDROID_VERSION",
          "Offline voice input requires Android 6 or newer.",
          null,
        )
        return@AsyncFunction
      }
      val previous = activeRecognition
      if (previous != null) {
        promise.reject(
          "ERR_RECOGNITION_BUSY",
          "Another offline voice recording is already active.",
          null,
        )
        return@AsyncFunction
      }

      val models = try {
        ensureModelFiles()
      } catch (error: Exception) {
        promise.reject(
          "ERR_VOICE_ASSETS",
          error.message ?: "The bundled offline speech models are not ready.",
          error,
        )
        return@AsyncFunction
      }
      val recorder = try {
        createAudioRecord()
      } catch (error: Exception) {
        promise.reject(
          "ERR_AUDIO_CAPTURE",
          error.message ?: "The microphone could not be initialized.",
          error,
        )
        return@AsyncFunction
      }
      val run = RecognitionRun(sessionId = sessionId, recorder = recorder)
      activeRecognition = run
      recognitionExecutor.execute {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        try {
          recorder.startRecording()
          if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            throw IllegalStateException("Android did not start microphone capture.")
          }
          sendRecognitionStatus(sessionId, "listening")
          promise.resolve(null)
          val audio = captureAudio(run)
          if (run.cancelled.get()) {
            sendRecognitionStatus(sessionId, "cancelled")
            return@execute
          }
          sendRecognitionStatus(sessionId, "processing")
          val transcript = recognizeAudio(models.asr, audio)
          sendEvent(
            "recognitionResult",
            mapOf(
              "sessionId" to sessionId,
              "transcript" to transcript,
              "isFinal" to true,
            ),
          )
          sendRecognitionStatus(sessionId, "completed")
        } catch (error: Exception) {
          if (run.cancelled.get()) {
            sendRecognitionStatus(sessionId, "cancelled")
          } else {
            sendRecognitionStatus(
              sessionId,
              "error",
              error.message ?: "Offline speech recognition could not finish.",
            )
          }
          try {
            promise.reject(
              "ERR_RECOGNITION_START",
              error.message ?: "Offline speech recognition could not start.",
              error,
            )
          } catch (_: Exception) {
            // The start promise may already be resolved after recording began.
          }
        } finally {
          try {
            if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
              recorder.stop()
            }
          } catch (_: Exception) {
            // The microphone may already have stopped.
          }
          recorder.release()
          if (activeRecognition === run) activeRecognition = null
        }
      }
    }

    AsyncFunction("stopRecognitionAsync") { sessionId: Long ->
      activeRecognition
        ?.takeIf { it.sessionId == sessionId }
        ?.let { run ->
          run.recording.set(false)
          try {
            run.recorder.stop()
          } catch (_: Exception) {
            // The recorder can stop itself after a device-level error.
          }
        }
    }

    AsyncFunction("cancelRecognitionAsync") { sessionId: Long ->
      activeRecognition
        ?.takeIf { it.sessionId == sessionId }
        ?.let { run ->
          run.cancelled.set(true)
          run.recording.set(false)
          try {
            run.recorder.stop()
          } catch (_: Exception) {
            // The recorder can stop itself after a device-level error.
          }
        }
    }

    AsyncFunction("speakAsync") {
        text: String,
        language: String,
        rate: Double,
        preferredVoiceId: String?,
        promise: Promise ->
      if (!language.startsWith("en", ignoreCase = true)) {
        promise.reject(
          "ERR_VOICE_LANGUAGE",
          "The bundled offline voice supports US English only.",
          null,
        )
        return@AsyncFunction
      }
      val voiceId = "piper:en_US-ljspeech-medium"
      val run = SpeechRun(
        id = UUID.randomUUID().toString(),
        voiceId = voiceId,
      )
      cancelSpeechPlayback()
      activeSpeech = run
      speechExecutor.execute {
        try {
          val models = ensureModelFiles()
          val tts = requireTtsEngine(models.tts)
          val generated = tts.generate(
            text = text.take(3_800),
            sid = 0,
            speed = rate.toFloat().coerceIn(0.75f, 1.2f),
          )
          if (run.cancelled.get()) {
            promise.resolve(mapOf("status" to "stopped", "voiceId" to voiceId))
            return@execute
          }
          playGeneratedAudio(generated.samples, generated.sampleRate, run)
          promise.resolve(
            mapOf(
              "status" to if (run.cancelled.get()) "stopped" else "completed",
              "voiceId" to voiceId,
            ),
          )
        } catch (error: Exception) {
          if (run.cancelled.get()) {
            promise.resolve(mapOf("status" to "stopped", "voiceId" to voiceId))
          } else {
            promise.reject(
              "ERR_TTS_PLAYBACK",
              error.message ?: "The bundled offline voice could not play.",
              error,
            )
          }
        } finally {
          if (activeSpeech === run) activeSpeech = null
          activeAudioTrack = null
        }
      }
    }

    AsyncFunction("stopSpeechAsync") {
      cancelSpeechPlayback()
    }

    OnDestroy {
      activeRecognition?.let { run ->
        run.cancelled.set(true)
        run.recording.set(false)
        try {
          run.recorder.stop()
        } catch (_: Exception) {
          // The recorder can stop itself during teardown.
        }
      }
      cancelSpeechPlayback()
      try {
        ttsEngine?.release()
      } catch (_: Exception) {
        // The native engine may already have been released.
      }
      ttsEngine = null
      recognitionExecutor.shutdownNow()
      speechExecutor.shutdownNow()
    }
  }

  private fun requireAndroidContext(): Context =
    appContext.reactContext
      ?: throw IllegalStateException("Android application context is unavailable.")

  private fun ensureModelFiles(): ModelFiles = synchronized(modelLock) {
    val context = requireAndroidContext()
    val parent = File(context.noBackupFilesDir, "offline-voice")
    val target = File(parent, "v1")
    val asr = File(target, ASR_DIRECTORY)
    val tts = File(target, TTS_DIRECTORY)
    if (hasRequiredModelFiles(asr, tts)) {
      return@synchronized ModelFiles(target, asr, tts)
    }

    if (!parent.exists() && !parent.mkdirs()) {
      throw IllegalStateException("The app could not create local voice storage.")
    }
    val staging = File(parent, ".staging-${UUID.randomUUID()}")
    if (!staging.mkdirs()) {
      throw IllegalStateException("The app could not prepare bundled voice models.")
    }
    try {
      extractModelArchive(context, ASR_ARCHIVE, staging)
      extractModelArchive(context, TTS_ARCHIVE, staging)
      val stagedAsr = File(staging, ASR_DIRECTORY)
      val stagedTts = File(staging, TTS_DIRECTORY)
      if (!hasRequiredModelFiles(stagedAsr, stagedTts)) {
        throw IllegalStateException("A bundled offline speech model is incomplete.")
      }
      if (target.exists() && !target.deleteRecursively()) {
        throw IllegalStateException("The app could not replace incomplete voice files.")
      }
      if (!staging.renameTo(target)) {
        throw IllegalStateException("The app could not activate bundled voice models.")
      }
      ModelFiles(target, asr, tts)
    } catch (error: Exception) {
      staging.deleteRecursively()
      throw error
    }
  }

  private fun hasRequiredModelFiles(asr: File, tts: File): Boolean =
    File(asr, "preprocess.onnx").isFile &&
      File(asr, "encode.int8.onnx").isFile &&
      File(asr, "uncached_decode.int8.onnx").isFile &&
      File(asr, "cached_decode.int8.onnx").isFile &&
      File(asr, "tokens.txt").isFile &&
      File(tts, "en_US-ljspeech-medium.onnx").isFile &&
      File(tts, "tokens.txt").isFile &&
      File(tts, "espeak-ng-data/phondata").isFile &&
      File(tts, "espeak-ng-data/phontab").isFile

  private fun extractModelArchive(context: Context, assetName: String, destination: File) {
    var extractedBytes = 0L
    context.assets.open(assetName).use { asset ->
      BZip2CompressorInputStream(asset, true).use { bzip ->
        TarArchiveInputStream(bzip).use { tar ->
          var entry = tar.nextTarEntry
          while (entry != null) {
            val output = File(destination, entry.name).canonicalFile
            val root = destination.canonicalFile
            if (output != root && !output.toPath().startsWith(root.toPath())) {
              throw IllegalStateException("A bundled model contains an unsafe path.")
            }
            if (entry.isSymbolicLink || entry.isLink || entry.isSparse) {
              throw IllegalStateException("A bundled model contains an unsupported archive entry.")
            }
            if (entry.isDirectory) {
              if (!output.exists() && !output.mkdirs()) {
                throw IllegalStateException("The app could not unpack a voice model.")
              }
            } else if (entry.isFile) {
              extractedBytes += entry.size
              if (extractedBytes > MAX_ARCHIVE_BYTES) {
                throw IllegalStateException("A bundled voice archive exceeds its size limit.")
              }
              output.parentFile?.let { parent ->
                if (!parent.exists() && !parent.mkdirs()) {
                  throw IllegalStateException("The app could not unpack a voice model.")
                }
              }
              FileOutputStream(output).use { file ->
                tar.copyTo(file)
              }
            }
            entry = tar.nextTarEntry
          }
        }
      }
    }
  }

  private fun createAudioRecord(): AudioRecord {
    val minimumBuffer = AudioRecord.getMinBufferSize(
      VOICE_SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minimumBuffer <= 0) {
      throw IllegalStateException("Android could not configure the microphone.")
    }
    val record = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(VOICE_SAMPLE_RATE)
          .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .build(),
      )
      .setBufferSizeInBytes(maxOf(minimumBuffer * 2, VOICE_SAMPLE_RATE))
      .build()
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw IllegalStateException("Android did not initialize the microphone.")
    }
    return record
  }

  private fun captureAudio(run: RecognitionRun): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(4_096)
    val maximumBytes = VOICE_SAMPLE_RATE * 2 * MAX_RECORDING_SECONDS
    while (run.recording.get()) {
      val count = run.recorder.read(buffer, 0, buffer.size)
      if (count > 0) {
        if (output.size() + count > maximumBytes) {
          run.recording.set(false)
          try {
            run.recorder.stop()
          } catch (_: Exception) {
            // The recorder may stop as the duration limit is reached.
          }
          throw IllegalStateException("Recording reached the 90-second limit.")
        }
        output.write(buffer, 0, count)
      } else if (count < 0 && run.recording.get()) {
        throw IllegalStateException("The microphone stopped before recognition finished.")
      } else if (count < 0) {
        break
      }
    }
    return output.toByteArray()
  }

  private fun recognizeAudio(modelDirectory: File, pcm: ByteArray): String {
    if (pcm.size < VOICE_SAMPLE_RATE / 2) return ""
    val samples = FloatArray(pcm.size / 2)
    for (index in samples.indices) {
      val low = pcm[index * 2].toInt() and 0xff
      val high = pcm[index * 2 + 1].toInt()
      val value = (high shl 8) or low
      samples[index] = value.toShort().toFloat() / 32_768f
    }

    val moonshine = OfflineMoonshineModelConfig(
      preprocessor = File(modelDirectory, "preprocess.onnx").absolutePath,
      encoder = File(modelDirectory, "encode.int8.onnx").absolutePath,
      uncachedDecoder = File(modelDirectory, "uncached_decode.int8.onnx").absolutePath,
      cachedDecoder = File(modelDirectory, "cached_decode.int8.onnx").absolutePath,
    )
    val recognizer = OfflineRecognizer(
      config = OfflineRecognizerConfig(
        modelConfig = OfflineModelConfig(
          moonshine = moonshine,
          tokens = File(modelDirectory, "tokens.txt").absolutePath,
          numThreads = maxOf(1, Runtime.getRuntime().availableProcessors().coerceAtMost(2)),
          provider = "cpu",
        ),
      ),
    )
    val stream: OfflineStream = recognizer.createStream()
    try {
      stream.acceptWaveform(samples, VOICE_SAMPLE_RATE)
      recognizer.decode(stream)
      return recognizer.getResult(stream).text.trim()
    } finally {
      stream.release()
      recognizer.release()
    }
  }

  private fun requireTtsEngine(modelDirectory: File): OfflineTts =
    ttsEngine ?: synchronized(ttsLock) {
      ttsEngine ?: OfflineTts(
        config = OfflineTtsConfig(
          model = OfflineTtsModelConfig(
            vits = OfflineTtsVitsModelConfig(
              model = File(modelDirectory, "en_US-ljspeech-medium.onnx").absolutePath,
              tokens = File(modelDirectory, "tokens.txt").absolutePath,
              dataDir = File(modelDirectory, "espeak-ng-data").absolutePath,
              lexicon = "",
              dictDir = "",
              noiseScale = 0.667f,
              noiseScaleW = 0.8f,
              lengthScale = 1.0f,
            ),
            numThreads = maxOf(1, Runtime.getRuntime().availableProcessors().coerceAtMost(2)),
            provider = "cpu",
          ),
        ),
      ).also { ttsEngine = it }
    }

  private fun playGeneratedAudio(
    samples: FloatArray,
    sampleRate: Int,
    run: SpeechRun,
  ) {
    if (samples.isEmpty()) {
      throw IllegalStateException("The bundled voice returned no audio.")
    }
    val minimumBuffer = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minimumBuffer <= 0) {
      throw IllegalStateException("Android could not configure audio playback.")
    }
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .build(),
      )
      .setBufferSizeInBytes(maxOf(minimumBuffer, 8_192))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    activeAudioTrack = track
    try {
      track.play()
      val chunkSize = 2_048
      var start = 0
      while (start < samples.size && !run.cancelled.get()) {
        val end = minOf(start + chunkSize, samples.size)
        val pcm = ShortArray(end - start)
        for (index in start until end) {
          pcm[index - start] =
            (samples[index].coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort()
        }
        val written = track.write(
          pcm,
          0,
          pcm.size,
          AudioTrack.WRITE_BLOCKING,
        )
        if (written < 0) {
          throw IllegalStateException("Android stopped local speech playback.")
        }
        start = end
      }
      if (!run.cancelled.get()) track.stop()
    } finally {
      track.release()
      if (activeAudioTrack === track) activeAudioTrack = null
    }
  }

  private fun cancelSpeechPlayback() {
    activeSpeech?.cancelled?.set(true)
    try {
      activeAudioTrack?.pause()
      activeAudioTrack?.flush()
      activeAudioTrack?.stop()
    } catch (_: Exception) {
      // Playback may already have stopped or released its track.
    }
  }

  private fun sendRecognitionStatus(
    sessionId: Long,
    status: String,
    message: String? = null,
  ) {
    val body = mutableMapOf<String, Any>(
      "sessionId" to sessionId,
      "status" to status,
    )
    if (message != null) body["message"] = message
    sendEvent("recognitionStatus", body)
  }
}