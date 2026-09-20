package com.secondbrain.screenaccess

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.provider.Settings
import android.view.Display
import android.view.WindowManager
import android.hardware.display.DisplayManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.events.OnActivityResultPayload
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SecondBrainScreenAccessModule : Module() {
  private var projection: MediaProjection? = null
  private var virtualDisplay: android.hardware.display.VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var pendingCapturePromise: Promise? = null
  private var lastStopReason: String? = null
  private var screenshotReceived = false

  companion object {
    private const val CAPTURE_REQUEST_CODE = 7041
  }

  override fun definition() = ModuleDefinition {
    Name("SecondBrainScreenAccess")

    Events("sessionStateChanged")

    AsyncFunction("getStatusAsync") {
      status()
    }

    AsyncFunction("requestScreenCaptureAsync") { promise: Promise ->
      if (projection != null) {
        promise.resolve(mapOf("status" to "active", "reason" to null))
        return@AsyncFunction
      }
      val activity = appContext.activityProvider?.currentActivity
      val context = appContext.reactContext
      if (activity == null || context == null) {
        promise.resolve(
          mapOf(
            "status" to "unavailable",
            "reason" to "Demi needs a visible Android activity to request screen consent.",
          ),
        )
        return@AsyncFunction
      }
      val manager =
        context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
      if (manager == null) {
        promise.resolve(
          mapOf(
            "status" to "unavailable",
            "reason" to "Android does not expose MediaProjection on this device.",
          ),
        )
        return@AsyncFunction
      }
      pendingCapturePromise?.reject(
        "ERR_CAPTURE_REQUEST_REPLACED",
        "A screen consent request was replaced.",
        null,
      )
      pendingCapturePromise = promise
      try {
        activity.startActivityForResult(manager.createScreenCaptureIntent(), CAPTURE_REQUEST_CODE)
      } catch (error: Exception) {
        pendingCapturePromise = null
        promise.resolve(
          mapOf(
            "status" to "unavailable",
            "reason" to (error.message ?: "Android could not show screen consent."),
          ),
        )
      }
    }

    AsyncFunction("stopScreenSessionAsync") { reason: String? ->
      stopCapture(reason ?: "user-stopped")
    }

    AsyncFunction("openAccessibilitySettingsAsync") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android application context is unavailable.")
      context.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    AsyncFunction("getAccessibilitySnapshotAsync") { excludedApps: List<String>? ->
      SecondBrainAccessibilityService.snapshot(excludedApps ?: emptyList())
    }

    OnActivityResult { _: Activity, payload: OnActivityResultPayload ->
      if (payload.requestCode != CAPTURE_REQUEST_CODE) return@OnActivityResult
      val promise = pendingCapturePromise
      pendingCapturePromise = null
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        lastStopReason = "consent-denied"
        promise?.resolve(mapOf("status" to "denied", "reason" to "Screen capture was not approved."))
        sendEvent("denied")
        return@OnActivityResult
      }
      try {
        val manager = appContext.reactContext
          ?.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
          ?: throw IllegalStateException("MediaProjection is unavailable.")
        projection = manager.getMediaProjection(payload.resultCode, payload.data!!)
        startFrameReader()
        promise?.resolve(mapOf("status" to "active", "reason" to null))
        sendEvent("active")
      } catch (error: Exception) {
        lastStopReason = "capture-start-failed"
        promise?.resolve(
          mapOf(
            "status" to "unavailable",
            "reason" to (error.message ?: "Android could not start screen capture."),
          ),
        )
      }
    }

    OnActivityEntersBackground {
      if (projection != null) stopCapture("app-paused")
    }

    OnDestroy {
      stopCapture("module-destroyed")
      pendingCapturePromise?.reject(
        "ERR_CAPTURE_SESSION_ENDED",
        "The screen consent request ended with the app.",
        null,
      )
      pendingCapturePromise = null
    }
  }

  private fun startFrameReader() {
    val context = appContext.reactContext ?: return
    val metrics = context.resources.displayMetrics
    imageReader?.close()
    imageReader = ImageReader.newInstance(
      2,
      2,
      PixelFormat.RGBA_8888,
      2,
    ).also { reader ->
      reader.setOnImageAvailableListener({ source ->
        val image = source.acquireLatestImage()
        if (image != null) {
          screenshotReceived = true
          image.close()
        }
      }, null)
    }
    virtualDisplay = projection?.createVirtualDisplay(
      "DemiScreenUnderstanding",
      2,
      2,
      metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      imageReader?.surface,
      null,
      null,
    )
  }

  private fun stopCapture(reason: String) {
    virtualDisplay?.release()
    virtualDisplay = null
    imageReader?.close()
    imageReader = null
    projection?.stop()
    projection = null
    screenshotReceived = false
    lastStopReason = reason
    sendEvent("stopped")
  }

  private fun sendEvent(state: String) {
    sendEvent(
      "sessionStateChanged",
      mapOf("state" to state, "protectedContent" to false),
    )
  }

  private fun status(): Map<String, Any?> {
    val accessibilityEnabled = SecondBrainAccessibilityService.isEnabled()
    val screenshotActive = projection != null
    val activeSource = when {
      screenshotActive && accessibilityEnabled -> "both"
      screenshotActive -> "screenshot"
      accessibilityEnabled -> "accessibility"
      else -> "none"
    }
    return mapOf(
      "platform" to "android",
      "mediaProjection" to when {
        screenshotActive -> "available"
        lastStopReason == "consent-denied" -> "denied"
        else -> "inactive"
      },
      "accessibility" to if (accessibilityEnabled) "enabled" else "disabled",
      "activeSource" to activeSource,
      "protectedContent" to false,
      "protectedContentState" to if (screenshotActive) "unknown" else "none",
      "lastStopReason" to lastStopReason,
      "screenshotReceived" to screenshotReceived,
    )
  }
}