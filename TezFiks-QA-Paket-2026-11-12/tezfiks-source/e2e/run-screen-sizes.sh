#!/usr/bin/env bash
# Runs the Maestro screen tours (e2e/maestro) on the connected emulator or phone at several screen sizes and collects
# the screenshots into <output-dir>/<size>/. Needs adb and maestro on PATH (or ADB=..., MAESTRO=...).
# Usage: e2e/run-screen-sizes.sh <output-dir>
set -u
OUT="${1:-e2e-screens}"
ADB="${ADB:-adb}"
MAESTRO="${MAESTRO:-maestro}"
DIR="$(cd "$(dirname "$0")/maestro" && pwd)"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
mkdir -p "$OUT"

# name size density font_scale
SIZES=(
  "small 720x1280 320 1.0"
  "standard 1080x2400 420 1.0"
  "large-font 1080x2400 420 1.3"
  "tall-hd 1440x3120 560 1.0"
  "short-wide 1080x1920 420 1.0"
)

apply() {
  "$ADB" shell wm size "$2"
  "$ADB" shell wm density "$3"
  "$ADB" shell settings put system font_scale "$4"
  sleep 4
}
reset_screen() {
  "$ADB" shell wm size reset
  "$ADB" shell wm density reset
  "$ADB" shell settings put system font_scale 1.0
}
collect() { # copy the newest Maestro run's screenshots into $OUT/$1
  local run
  run="$(ls -td "$HOME"/.maestro/tests/*/ | head -1)"
  mkdir -p "$OUT/$1"
  find "$run" -name '*.png' -exec cp {} "$OUT/$1/" \;
}
trap reset_screen EXIT

# Log both apps in once, at the smallest size (also captures the login screens there): OTP requests are rate-limited per IP.
apply small 720x1280 320 1.0
"$MAESTRO" test -e SIZE=small "$DIR/customer-login.yaml"; collect small
"$MAESTRO" test -e SIZE=small "$DIR/pro-login.yaml"; collect small

for s in "${SIZES[@]}"; do
  # shellcheck disable=SC2086
  set -- $s
  apply "$@"
  "$MAESTRO" test -e SIZE="$1" "$DIR/customer-screens.yaml"; collect "$1"
  "$MAESTRO" test -e SIZE="$1" "$DIR/pro-screens.yaml"; collect "$1"
done
echo "screenshots in $OUT"
