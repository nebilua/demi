package com.secondbrain.screenaccess

import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class SecondBrainAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile private var active: SecondBrainAccessibilityService? = null
    fun isEnabled() = active != null
    fun screenshotAvailable() = active != null && Build.VERSION.SDK_INT >= 30

    fun snapshot(excludedApps: List<String> = emptyList()): Map<String, Any?> {
      val service = active
      val root = service?.rootInActiveWindow
      val packageName = root?.packageName?.toString()
      val label = try {
        if (packageName == null) "" else service?.packageManager?.let {
          it.getApplicationLabel(it.getApplicationInfo(packageName, 0)).toString()
        } ?: ""
      } catch (_: Exception) { "" }
      val excluded = excludedApps.any { rule ->
        rule.isNotBlank() && (packageName?.contains(rule, true) == true || label.contains(rule, true))
      }
      val text = StringBuilder()
      var count = 0
      var protected = false
      var editable = false
      var truncated = false
      fun visit(node: AccessibilityNodeInfo) {
        if (count >= 500) { truncated = true; return }
        if (!node.isVisibleToUser) return
        count++
        if (node.isPassword) { protected = true; return }
        if (node.isEditable) editable = true
        // Input fields may contain credentials even when not marked password.
        if (!node.isEditable && text.length < 6000) {
          val value = node.text?.toString() ?: node.contentDescription?.toString()
          if (!value.isNullOrBlank()) text.append(value.take(6000 - text.length)).append('\n')
        }
        for (index in 0 until node.childCount) {
          val child = node.getChild(index) ?: continue
          try { visit(child) } finally { child.recycle() }
          if (count >= 500 && index + 1 < node.childCount) { truncated = true; break }
        }
      }
      try {
        if (root != null && !excluded) visit(root)
      } finally { root?.recycle() }
      // Fail closed for the entire snapshot when a protected field is present.
      val output = if (excluded || protected || truncated) "" else text.toString().take(6000).trim()
      return mapOf(
        "available" to (service != null && packageName != null),
        "textAvailable" to output.isNotBlank(),
        "text" to output,
        "nodeCount" to count,
        "protectedContent" to (protected || excluded || truncated),
        "screenshotBlocked" to (protected || excluded || editable || truncated),
        "protectedContentState" to if (protected || excluded) "detected" else "none",
        "packageName" to packageName,
        "excluded" to excluded,
      )
    }

    fun screenshot(callback: TakeScreenshotCallback) {
      val service = active ?: throw IllegalStateException("Enable Demi in Android Accessibility settings first.")
      if (Build.VERSION.SDK_INT < 30) throw IllegalStateException("Screenshot OCR requires Android 11 or later.")
      service.takeScreenshot(Display.DEFAULT_DISPLAY, service.mainExecutor, callback)
    }
  }

  override fun onServiceConnected() { active = this }
  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
  override fun onInterrupt() = Unit
  override fun onDestroy() {
    if (active === this) active = null
    super.onDestroy()
  }
}
