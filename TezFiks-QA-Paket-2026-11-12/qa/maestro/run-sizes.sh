#!/usr/bin/env bash
# QA: AU-O01 — 4 ssenari 5 ekran ölçüsündə (real telefon). e2e/run-screen-sizes.sh əsasında.
set -u
export JAVA_HOME=/d/tools/jdk17 PATH=/d/tools/platform-tools:$PATH JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8" MSYS_NO_PATHCONV=1
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
Q="/d/QA manual/tezfiks/qa/maestro"; OUT="$Q/shots"; RES="/d/QA manual/tezfiks/qa/automation/results/maestro-sizes"
M=/d/tools/maestro/bin/maestro
SIZES=("small 720x1280 320 1.0" "standard 1080x2400 420 1.0" "large-font 1080x2400 420 1.3" "tall-hd 1440x3120 560 1.0" "short-wide 1080x1920 420 1.0")
apply() { adb shell wm size "$2"; adb shell wm density "$3"; adb shell settings put system font_scale "$4"; sleep 4; }
reset_screen() { adb shell wm size reset; adb shell wm density reset; adb shell settings put system font_scale 1.0; echo "screen reset"; }
trap reset_screen EXIT
run() { # size flow
  local d="$RES/$1"; mkdir -p "$d" "$OUT/$1"
  "$M" test --no-ansi --no-reinstall-driver -e SIZE="$1" "$(cygpath -w "$Q/$2.yaml")" --test-output-dir "$(cygpath -w "$d/$2")" > "$d/$2.log" 2>&1
  local rc=$?; echo "RESULT $1 $2 rc=$rc"
  find "$d/$2" -name "$1-*.png" -exec cp {} "$OUT/$1/" \;
}
apply small 720x1280 320 1.0
run small customer-login; run small pro-login
for s in "${SIZES[@]}"; do set -- $s; apply "$@"; run "$1" customer-screens; run "$1" pro-screens; done
echo DONE
