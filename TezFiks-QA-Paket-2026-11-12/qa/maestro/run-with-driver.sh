#!/usr/bin/env bash
# İstifadə: run-with-driver.sh <flow.yaml> <driver-əmri> <nəticə-adı>
set -u
F="$1"; CMD="$2"; NAME="$3"
Q="$(cd "$(dirname "$0")/.." && pwd)"; R="$Q/automation/results/maestro-mob/$NAME"; mkdir -p "$R"
export JAVA_HOME=/d/tools/jdk17 PATH=/d/tools/platform-tools:$PATH JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8" MAESTRO_CLI_NO_ANALYTICS=1
cd "$Q/automation" && node mobile-driver.mts prep < /dev/null > "$R/prep.log" 2>&1 || { echo "prep FAILED"; tail -5 "$R/prep.log"; exit 1; }
(node mobile-driver.mts $CMD < /dev/null > "$R/driver.log" 2>&1; echo "driver rc=$?" >> "$R/driver.log") &
for i in $(seq 1 40); do grep -qE "Elvin onlayn|Elvinin tətbiqdə" "$R/driver.log" 2>/dev/null && break; powershell -NoProfile -Command "Start-Sleep 1"; done
cd "$Q/maestro" && /d/tools/maestro/bin/maestro test --no-ansi --no-reinstall-driver "$(cygpath -w "$PWD/$F")" --test-output-dir "$(cygpath -w "$R/run")" > "$R/maestro.log" 2>&1
echo "maestro rc=$?"
grep -E "FAILED|Assertion is false" "$R/maestro.log" | head -3
wait
cat "$R/driver.log"
mkdir -p "$Q/maestro/shots/$NAME"; find "$R/run" -name "o0*.png" -exec cp {} "$Q/maestro/shots/$NAME/" \;
