#!/bin/sh
# Compile-only iOS verification. This script never signs or uploads an app.
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

mode=${1:-both}
case "$mode" in
  both|archive|simulator) ;;
  *) fail 'Choose both, archive or simulator. No other build arguments are accepted.' ;;
esac
[ "$#" -le 1 ] || fail 'Only one compile target argument is accepted.'
[ "$(uname -s)" = Darwin ] || fail 'iOS compilation requires a Mac with Xcode. No build was attempted.'

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
app_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
cd "$app_root"

: "${FLUTTER_ROOT:?Set FLUTTER_ROOT to the verified official Flutter 3.47.7 Git checkout.}"
expected_flutter_commit=abaf9c523780a608bd46686fd5e53740a07077f8
[ -x "$FLUTTER_ROOT/bin/flutter" ] || fail 'The configured Flutter executable is missing.'
[ "$(git -C "$FLUTTER_ROOT" rev-parse HEAD)" = "$expected_flutter_commit" ] ||
  fail 'Flutter source is not the pinned official 3.47.7 commit.'
git -C "$FLUTTER_ROOT" diff --quiet HEAD -- || fail 'Flutter has tracked local modifications; use a clean verified checkout.'
[ -f pubspec.lock ] || fail 'The reviewed pubspec.lock file is required.'
[ -d ios/Runner.xcodeproj ] || fail 'The reviewed iOS project is missing.'

command -v xcodebuild >/dev/null 2>&1 || fail 'Xcode command-line tools are missing.'
command -v xcrun >/dev/null 2>&1 || fail 'Xcode command-line tools are missing.'
command -v ditto >/dev/null 2>&1 || fail 'The macOS archive tool is missing.'
command -v shasum >/dev/null 2>&1 || fail 'The SHA-256 tool is missing.'
[ -x /usr/libexec/PlistBuddy ] || fail 'The macOS property-list validator is missing.'

# There is no HTTP override or signing input in this iOS build path.
[ -z "${TEMPORARY_HTTP_ENDPOINT:-}" ] || fail 'Temporary HTTP is Android-only. Remove that variable before building iOS.'
[ -z "${ALLOW_LOOPBACK_FIXTURE:-}" ] || fail 'Do not enable fixture networking in an iOS build.'
[ -z "${DART_DEFINES:-}" ] || fail 'Inherited Dart defines are not accepted for this reviewed iOS compile.'
ats=$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' ios/Runner/Info.plist)
[ "$ats" = false ] || fail 'iOS App Transport Security must keep arbitrary loads disabled.'
if /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSExceptionDomains' ios/Runner/Info.plist >/dev/null 2>&1; then
  fail 'Unexpected iOS transport-security exceptions require separate review.'
fi

export CI=true
export FLUTTER_SUPPRESS_ANALYTICS=true
export DART_SUPPRESS_ANALYTICS=true

output="$app_root/build/ios-preview"
[ ! -e "$output" ] || fail 'build/ios-preview already exists. Preserve or move the earlier output before another run.'
mkdir -p "$output"
printf '%s\n' \
  'UNSIGNED COMPILE OUTPUTS — NOT AN IPHONE INSTALLER' \
  'No signed IPA is produced. The device archive cannot be installed on an iPhone as delivered.' \
  'The simulator application is only for a compatible iOS Simulator on a Mac; it is not an iPhone app download.' \
  'Compilation does not prove that the app has launched or passed physical-iPhone tests.' \
  'No Apple account, signing secret, TestFlight upload or App Store submission is used by this script.' \
  'iOS remains HTTPS-only. Financial writes remain disabled in this pilot.' \
  > "$output/README-UNSIGNED.txt"

run_logged() {
  log_name=$1
  shift
  if "$@" > "$output/$log_name.log" 2>&1; then
    cat "$output/$log_name.log"
  else
    cat "$output/$log_name.log" >&2
    fail "The $log_name step failed. No successful iOS build is claimed."
  fi
}

{
  printf 'UTC build time: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'Requested targets: %s\n' "$mode"
  printf 'Flutter commit: %s\n' "$expected_flutter_commit"
  printf 'Runner image: %s\n' "${ImageOS:-local Mac}"
  printf 'Runner image version: %s\n' "${ImageVersion:-not supplied}"
  printf 'Mac architecture: %s\n' "$(uname -m)"
  printf 'Source revision: '
  git rev-parse HEAD 2>/dev/null || printf 'unavailable (source archive)\n'
  xcodebuild -version
  xcrun --sdk iphoneos --show-sdk-version
  xcrun --sdk iphonesimulator --show-sdk-version
  shasum -a 256 pubspec.lock
} > "$output/BUILD-INFO.txt"

run_logged flutter-version "$FLUTTER_ROOT/bin/flutter" --suppress-analytics --version --machine
grep -Eq '"frameworkVersion"[[:space:]]*:[[:space:]]*"3\.47\.7"' "$output/flutter-version.log" ||
  fail 'Flutter reports an unexpected version.'
run_logged precache "$FLUTTER_ROOT/bin/flutter" --suppress-analytics precache --ios
run_logged packages "$FLUTTER_ROOT/bin/flutter" --suppress-analytics pub get --enforce-lockfile
run_logged analysis "$FLUTTER_ROOT/bin/flutter" --suppress-analytics analyze
run_logged tests "$FLUTTER_ROOT/bin/flutter" --suppress-analytics test --reporter expanded

if [ "$mode" = both ] || [ "$mode" = archive ]; then
  run_logged unsigned-archive "$FLUTTER_ROOT/bin/flutter" --suppress-analytics build ipa --release --no-codesign --no-pub
  archive="$app_root/build/ios/archive/Runner.xcarchive"
  [ -d "$archive/Products/Applications/Runner.app" ] || fail 'The expected unsigned Xcode archive is missing.'
  ditto -c -k --sequesterRsrc --keepParent "$archive" "$output/FIBER-net-lb-iOS-UNSIGNED-archive.zip"
fi

if [ "$mode" = both ] || [ "$mode" = simulator ]; then
  run_logged simulator "$FLUTTER_ROOT/bin/flutter" --suppress-analytics build ios --simulator --debug --no-codesign --no-pub
  simulator_app="$app_root/build/ios/iphonesimulator/Runner.app"
  [ -d "$simulator_app" ] || fail 'The expected simulator application is missing.'
  ditto -c -k --sequesterRsrc --keepParent "$simulator_app" "$output/FIBER-net-lb-iOS-SIMULATOR-ONLY.zip"
fi

(
  cd "$output"
  find . -type f ! -name SHA256SUMS.txt -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "$file"
  done > SHA256SUMS.txt
)
printf '%s\n' 'Unsigned compilation completed. These files cannot be installed on an iPhone as delivered.'
