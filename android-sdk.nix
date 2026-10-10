{ pkgs ? import <nixpkgs> {} }:

let
  android = pkgs.androidenv.composeAndroidPackages {
    platformVersions = [ "35" "36" ];
    buildToolsVersions = [ "35.0.0" "36.0.0" ];
    includeNDK = true;
    ndkVersions = [ "27.1.12297006" ];
    cmakeVersions = [ "3.22.1" ];
  };
in
pkgs.mkShell {
  packages = [
    android.androidsdk
    pkgs.jdk17
    pkgs.unzip
  ];

  shellHook = ''
    export ANDROID_HOME="${android.androidsdk}/libexec/android-sdk"
    if [ ! -d "$ANDROID_HOME/platforms" ]; then
      export ANDROID_HOME="${android.androidsdk}"
    fi
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
    export JAVA_HOME="${pkgs.jdk17}"
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/35.0.0:$ANDROID_HOME/build-tools/36.0.0:$PATH"
  '';
}
