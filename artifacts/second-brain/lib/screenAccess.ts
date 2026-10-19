import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export type ScreenAccessStatus = {
  platform: "android" | "web" | "unsupported";
  mediaProjection: "available" | "denied" | "inactive" | "unavailable";
  accessibility: "enabled" | "disabled" | "unavailable";
  activeSource: "none" | "screenshot" | "accessibility" | "both";
  protectedContent: boolean;
  protectedContentState: "none" | "detected" | "unknown";
  lastStopReason: string | null;
  screenshotAvailable?: boolean;
};

export type ScreenCaptureResult = {
  status: "active" | "denied" | "unavailable";
  reason: string | null;
};

export type AccessibilitySnapshot = {
  available: boolean;
  textAvailable: boolean;
  nodeCount: number;
  protectedContent: boolean;
  protectedContentState: "none" | "detected" | "unknown";
  packageName: string | null;
  excluded: boolean;
  text?: string;
};

declare class SecondBrainScreenAccessModule extends NativeModule {
  getStatusAsync(): Promise<ScreenAccessStatus>;
  requestScreenCaptureAsync(): Promise<ScreenCaptureResult>;
  stopScreenSessionAsync(reason?: string): Promise<void>;
  openAccessibilitySettingsAsync(): Promise<void>;
  getAccessibilitySnapshotAsync(excludedApps?: string[]): Promise<AccessibilitySnapshot>;
  captureScreenshotTextAsync(excludedApps: string[]): Promise<string>;
  readImageTextAsync(uri: string): Promise<string>;
}

let nativeModule: SecondBrainScreenAccessModule | null | undefined;

function getNativeModule() {
  if (nativeModule !== undefined) return nativeModule;
  if (Platform.OS !== "android") {
    nativeModule = null;
    return nativeModule;
  }
  try {
    nativeModule = requireNativeModule<SecondBrainScreenAccessModule>(
      "SecondBrainScreenAccess",
    );
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export function screenAccessAvailable() {
  return Platform.OS === "android" && getNativeModule() !== null;
}

export async function getScreenAccessStatus(): Promise<ScreenAccessStatus> {
  const module = getNativeModule();
  if (!module) {
    return {
      platform: Platform.OS === "web" ? "web" : "unsupported",
      mediaProjection: "unavailable",
      accessibility: "unavailable",
      activeSource: "none",
      protectedContent: false,
      protectedContentState: "unknown",
      lastStopReason: null,
    };
  }
  return module.getStatusAsync();
}

export async function requestScreenCapture() {
  const module = getNativeModule();
  if (!module) {
    return {
      status: "unavailable",
      reason: "Screen capture requires the installed Android build.",
    } satisfies ScreenCaptureResult;
  }
  return module.requestScreenCaptureAsync();
}

export async function stopScreenSession(reason = "user-stopped") {
  await getNativeModule()?.stopScreenSessionAsync(reason);
}

export async function openAccessibilitySettings() {
  await getNativeModule()?.openAccessibilitySettingsAsync();
}

export async function getAccessibilitySnapshot(
  excludedApps: string[] = [],
): Promise<AccessibilitySnapshot> {
  const module = getNativeModule();
  if (!module) {
    return {
      available: false,
      textAvailable: false,
      nodeCount: 0,
      protectedContent: false,
      protectedContentState: "none",
      packageName: null,
      excluded: false,
    };
  }
  return module.getAccessibilitySnapshotAsync(excludedApps);
}

export async function captureScreenshotText(excludedApps: string[]) {
  const module = getNativeModule();
  if (!module) throw new Error("Screenshot OCR needs the rebuilt Android app.");
  return module.captureScreenshotTextAsync(excludedApps);
}

export async function readImageText(uri: string) {
  const module = getNativeModule();
  if (!module) throw new Error("Image OCR needs the rebuilt Android app.");
  return module.readImageTextAsync(uri);
}