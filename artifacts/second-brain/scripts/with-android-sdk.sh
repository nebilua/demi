#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$project_dir/../.." && pwd)"
cd "$project_dir"

case "${1:-}" in
  preflight)
    command='env ANDROID_PREFLIGHT_ONLY=1 node scripts/validate-android-apk.js'
    ;;
  validate)
    command='node scripts/validate-android-apk.js'
    ;;
  *)
    echo "Usage: $0 {preflight|validate}" >&2
    exit 2
    ;;
esac

export NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1
exec nix-shell "$repo_root/android-sdk.nix" --run "exec $command"
