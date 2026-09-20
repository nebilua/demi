package com.secondbrain.screenaccess

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class SecondBrainAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile
    private var active: SecondBrainAccessibilityService? = null

    fun isEnabled(): Boolean = active != null

    fun snapshot(excludedApps: List<String> = emptyList()): Map<String, Any?> {
      val service = active ?: return mapOf(
        "available" to false,
        "textAvailable" to false,
        "nodeCount" to 0,
        "protectedContent" to false,
        "protectedContentState" to "none",
        "packageName" to null,
        "excluded" to false,
      )
      val root = service.rootInActiveWindow
      val packageName = root?.packageName?.toString()
      val excluded = packageName != null && excludedApps.any { rule ->
        rule.equals(packageName, ignoreCase = true) ||
          packageName.contains(rule, ignoreCase = true)
      }
      if (excluded) {
        return mapOf(
          "available" to true,
          "textAvailable" to false,
          "nodeCount" to 0,
          "protectedContent" to true,
          "protectedContentState" to "detected",
          "packageName" to packageName,
          "excluded" to true,
        )
      }
      val nodeCount = root?.let(::countNodes) ?: 0
      return mapOf(
        "available" to true,
        "textAvailable" to (nodeCount > 0),
        "nodeCount" to nodeCount,
        "protectedContent" to false,
        "protectedContentState" to "none",
        "packageName" to packageName,
        "excluded" to false,
      )
    }

    private fun countNodes(node: AccessibilityNodeInfo): Int {
      var count = 1
      for (index in 0 until node.childCount) {
        val child = node.getChild(index) ?: continue
        count += countNodes(child)
        child.recycle()
        if (count >= 500) return count
      }
      return count
    }
  }

  override fun onServiceConnected() {
    active = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // The bridge deliberately reads only node availability. It never logs or
    // retains node text, passwords, package names, or event payloads.
  }

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (active === this) active = null
    super.onDestroy()
  }
}