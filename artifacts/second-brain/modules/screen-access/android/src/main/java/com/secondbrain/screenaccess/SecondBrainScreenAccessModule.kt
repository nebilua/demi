package com.secondbrain.screenaccess

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SecondBrainScreenAccessModule : Module() {
  @Volatile private var epoch = 0
  private var lastStopReason: String? = null
  private val ocrExecutor = Executors.newSingleThreadExecutor()
  private val ocrBusy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("SecondBrainScreenAccess")
    AsyncFunction("getStatusAsync") {
      mapOf(
        "platform" to "android",
        "mediaProjection" to "unavailable",
        "accessibility" to if (SecondBrainAccessibilityService.isEnabled()) "enabled" else "disabled",
        "screenshotAvailable" to SecondBrainAccessibilityService.screenshotAvailable(),
        "activeSource" to "none",
        "protectedContent" to false,
        "protectedContentState" to "unknown",
        "lastStopReason" to lastStopReason,
      )
    }
    // Kept for compatibility with older JS; never claim a discarded frame is usable.
    AsyncFunction("requestScreenCaptureAsync") {
      mapOf("status" to "unavailable", "reason" to "Use one-shot Screenshot OCR with Android Accessibility enabled, or select a screenshot.")
    }
    AsyncFunction("getAccessibilitySnapshotAsync") { excluded: List<String>? ->
      SecondBrainAccessibilityService.snapshot(excluded ?: emptyList())
    }
    AsyncFunction("captureScreenshotTextAsync") { excluded: List<String>, promise: Promise ->
      val run = epoch
      val before = SecondBrainAccessibilityService.snapshot(excluded)
      if (before["available"] != true || before["protectedContent"] == true || before["screenshotBlocked"] == true || before["excluded"] == true) {
        promise.reject("ERR_SCREEN_PROTECTED", "Protected, excluded, or unavailable screen. Nothing was captured.", null)
      } else if (Build.VERSION.SDK_INT < 30) {
        promise.reject("ERR_SCREEN_UNAVAILABLE", "Screenshot OCR requires Android 11 or later.", null)
      } else {
        try {
          SecondBrainAccessibilityService.screenshot(object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
              val buffer = result.hardwareBuffer
              try {
                val after = SecondBrainAccessibilityService.snapshot(excluded)
                if (run != epoch || before["packageName"] != after["packageName"] || after["protectedContent"] == true || after["screenshotBlocked"] == true) {
                  promise.reject("ERR_SCREEN_STALE", "Screen changed or sharing stopped. Capture again.", null)
                  return
                }
                val hardware = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
                val bitmap = hardware?.copy(Bitmap.Config.ARGB_8888, false)
                hardware?.recycle()
                if (bitmap == null) throw IllegalStateException()
                recognize(bitmap, run, promise)
              } catch (_: Exception) {
                promise.reject("ERR_SCREEN_CAPTURE", "Screenshot could not be read. Select a screenshot instead.", null)
              } finally { buffer.close() }
            }
            override fun onFailure(errorCode: Int) {
              promise.reject("ERR_SCREEN_CAPTURE", "Android withheld this screenshot or capture is temporarily unavailable. Retry or choose a screenshot.", null)
            }
          })
        } catch (_: Exception) {
          promise.reject("ERR_SCREEN_UNAVAILABLE", "Enable Demi in Android Accessibility settings or select a screenshot.", null)
        }
      }
    }
    AsyncFunction("readImageTextAsync") { uri: String, promise: Promise ->
      val run = epoch
      try {
        val context = appContext.reactContext ?: throw IllegalStateException()
        val parsed = Uri.parse(uri)
        require(parsed.scheme == "file" || parsed.scheme == "content")
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, options) }
        require(options.outWidth > 0 && options.outHeight > 0)
        var sample = 1
        while (options.outWidth / sample > 2048 || options.outHeight / sample > 2048) sample *= 2
        val bitmap = context.contentResolver.openInputStream(parsed).use {
          BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw IllegalStateException()
        recognize(bitmap, run, promise)
      } catch (_: Exception) {
        promise.reject("ERR_IMAGE_READ", "This image could not be decoded locally. Choose a PNG or JPEG screenshot.", null)
      }
    }
    AsyncFunction("stopScreenSessionAsync") { reason: String? ->
      epoch++
      lastStopReason = reason ?: "user-stopped"
    }
    AsyncFunction("openAccessibilitySettingsAsync") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable.")
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    OnActivityEntersBackground { epoch++; lastStopReason = "app-paused" }
    OnDestroy { epoch++; ocrExecutor.shutdown() }
  }

  private fun recognize(bitmap: Bitmap, run: Int, promise: Promise) {
    if (run != epoch || ocrExecutor.isShutdown) {
      bitmap.recycle()
      promise.reject("ERR_SCREEN_STALE", "Sharing stopped. Capture again.", null)
      return
    }
    // Bound pixels before processing. No image files, network, or logs.
    val scaled = if (bitmap.width > 2048 || bitmap.height > 2048) {
      val factor = 2048.0 / maxOf(bitmap.width, bitmap.height)
      Bitmap.createScaledBitmap(bitmap, (bitmap.width * factor).toInt().coerceAtLeast(1), (bitmap.height * factor).toInt().coerceAtLeast(1), true)
    } else bitmap
    if (scaled !== bitmap) bitmap.recycle()
    if (!ocrBusy.compareAndSet(false, true)) {
      scaled.recycle()
      promise.reject("ERR_OCR_BUSY", "OCR is still finishing. Retry in a moment.", null)
      return
    }
    ocrExecutor.execute {
      var tess: TessBaseAPI? = null
      try {
        if (run != epoch) throw IllegalStateException()
        val context = appContext.reactContext ?: throw IllegalStateException()
        val directory = File(context.noBackupFilesDir, "screen-ocr")
        val data = File(directory, "tessdata/eng.traineddata")
        data.parentFile?.mkdirs()
        val expected = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
        fun valid(): Boolean {
          if (!data.isFile) return false
          val digest = MessageDigest.getInstance("SHA-256")
          data.inputStream().use { input ->
            val bytes = ByteArray(8192)
            while (true) {
              val count = input.read(bytes)
              if (count < 0) break
              digest.update(bytes, 0, count)
            }
          }
          return digest.digest().joinToString("") { "%02x".format(it) } == expected
        }
        if (!valid()) {
          context.assets.open("ocr/eng.traineddata").use { input -> data.outputStream().use { input.copyTo(it) } }
          check(valid())
        }
        tess = TessBaseAPI()
        check(tess.init(directory.absolutePath, "eng"))
        tess.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT)
        tess.setImage(scaled)
        val text = tess.getUTF8Text().take(6000)
        if (run != epoch) promise.reject("ERR_SCREEN_STALE", "Sharing stopped. Capture again.", null)
        else promise.resolve(text)
      } catch (_: Exception) {
        promise.reject("ERR_OCR", "Local English OCR failed or sharing stopped. Retry with a clearer screenshot.", null)
      } finally {
        tess?.recycle()
        scaled.recycle()
        ocrBusy.set(false)
      }
    }
  }
}
