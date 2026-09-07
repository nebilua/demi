package com.secondbrain.offlinetts

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SecondBrainOfflineTtsModule : Module(), TextToSpeech.OnInitListener {
  private var engine: TextToSpeech? = null
  private var ready = false
  private val pending = ConcurrentHashMap<String, Promise>()
  private val voiceIds = ConcurrentHashMap<String, String>()

  override fun definition() = ModuleDefinition {
    Name("SecondBrainOfflineTts")

    OnCreate {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android application context is unavailable.")
      engine = TextToSpeech(context, this@SecondBrainOfflineTtsModule)
    }

    AsyncFunction("getOfflineVoicesAsync") {
      requireReadyEngine()
        .let(::verifiedOfflineVoices)
        .map { voice ->
          mapOf(
            "id" to voice.name,
            "name" to voice.name,
            "language" to voice.locale.toLanguageTag(),
          )
        }
    }

    AsyncFunction("speakAsync") {
        text: String,
        language: String,
        rate: Double,
        promise: Promise ->
      val tts = try {
        requireReadyEngine()
      } catch (error: Exception) {
        promise.reject("ERR_TTS_NOT_READY", error.message, error)
        return@AsyncFunction
      }
      val locale = Locale.forLanguageTag(language)
      val voice = verifiedOfflineVoices(tts)
        .firstOrNull { candidate ->
          candidate.locale.toLanguageTag().equals(language, ignoreCase = true)
        }
        ?: verifiedOfflineVoices(tts)
          .firstOrNull { candidate ->
            candidate.locale.language.equals(locale.language, ignoreCase = true)
          }

      if (voice == null) {
        promise.reject(
          "ERR_NO_OFFLINE_VOICE",
          "No verified offline voice is installed for $language.",
          null,
        )
        return@AsyncFunction
      }

      val voiceSelection = tts.setVoice(voice)
      val activeVoice = tts.voice
      if (
        voiceSelection != TextToSpeech.SUCCESS ||
        activeVoice == null ||
        activeVoice.name != voice.name ||
        activeVoice.isNetworkConnectionRequired ||
        activeVoice.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
      ) {
        promise.reject(
          "ERR_OFFLINE_VOICE_SELECTION",
          "Android could not activate the verified offline voice.",
          null,
        )
        return@AsyncFunction
      }
      tts.setSpeechRate(rate.toFloat())
      val utteranceId = UUID.randomUUID().toString()
      pending[utteranceId] = promise
      voiceIds[utteranceId] = voice.name
      val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId)
      if (result == TextToSpeech.ERROR) {
        pending.remove(utteranceId)
        voiceIds.remove(utteranceId)
        promise.reject(
          "ERR_TTS_START",
          "The verified offline voice could not start.",
          null,
        )
      }
    }

    AsyncFunction("stopAsync") {
      engine?.stop()
      resolveAllAsStopped()
    }

    OnDestroy {
      resolveAllAsStopped()
      engine?.shutdown()
      engine = null
      ready = false
    }
  }

  override fun onInit(status: Int) {
    ready = status == TextToSpeech.SUCCESS
    engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit

      override fun onDone(utteranceId: String?) {
        if (utteranceId == null) return
        val promise = pending.remove(utteranceId) ?: return
        val voiceId = voiceIds.remove(utteranceId).orEmpty()
        promise.resolve(
          mapOf(
            "status" to "completed",
            "voiceId" to voiceId,
          ),
        )
      }

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) {
        rejectUtterance(utteranceId)
      }

      override fun onError(utteranceId: String?, errorCode: Int) {
        rejectUtterance(utteranceId)
      }

      override fun onStop(utteranceId: String?, interrupted: Boolean) {
        if (utteranceId == null) return
        val promise = pending.remove(utteranceId) ?: return
        val voiceId = voiceIds.remove(utteranceId).orEmpty()
        promise.resolve(
          mapOf(
            "status" to "stopped",
            "voiceId" to voiceId,
          ),
        )
      }
    })
  }

  private fun requireReadyEngine(): TextToSpeech {
    val tts = engine
    if (!ready || tts == null) {
      throw IllegalStateException("The Android offline voice engine is not ready.")
    }
    return tts
  }

  private fun verifiedOfflineVoices(tts: TextToSpeech) =
    tts.voices
      .orEmpty()
      .filter { voice ->
        !voice.isNetworkConnectionRequired &&
          !voice.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
      }

  private fun rejectUtterance(utteranceId: String?) {
    if (utteranceId == null) return
    val promise = pending.remove(utteranceId) ?: return
    voiceIds.remove(utteranceId)
    promise.reject(
      "ERR_TTS_PLAYBACK",
      "The verified offline voice stopped unexpectedly.",
      null,
    )
  }

  private fun resolveAllAsStopped() {
    pending.forEach { (utteranceId, promise) ->
      promise.resolve(
        mapOf(
          "status" to "stopped",
          "voiceId" to voiceIds[utteranceId].orEmpty(),
        ),
      )
    }
    pending.clear()
    voiceIds.clear()
  }
}