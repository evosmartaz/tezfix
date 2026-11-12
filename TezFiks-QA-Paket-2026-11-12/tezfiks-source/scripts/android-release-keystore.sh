#!/usr/bin/env bash
# Creates the TezFiks Android release keystore (BUG-003) OR prints the fingerprints of an existing one.
#
# Run this ONLY as the authorized release owner, and only if the company has no release key yet. If a release key
# already exists, do not create a new one: use --print with the existing file.
#
#   scripts/android-release-keystore.sh                 # create ~/.tezfiks-signing/tezfiks-release.jks (prompts)
#   scripts/android-release-keystore.sh --print FILE    # print alias + SHA-1/SHA-256 of an existing keystore
#
# Passwords are typed into keytool's own hidden prompts (or taken from TEZFIKS_RELEASE_STORE_PASSWORD /
# TEZFIKS_RELEASE_KEY_PASSWORD if set); they are never echoed or written to disk by this script.
# Only public certificate data (alias, SHA-1, SHA-256, validity) is printed.
set -euo pipefail

ALIAS="${TEZFIKS_RELEASE_KEY_ALIAS:-tezfiks-release}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

print_fingerprints() {
  local file="$1"
  local args=(-list -v -keystore "$file" -alias "$ALIAS")
  if [[ -n "${TEZFIKS_RELEASE_STORE_PASSWORD:-}" ]]; then
    args+=(-storepass:env TEZFIKS_RELEASE_STORE_PASSWORD)
  fi
  keytool "${args[@]}" | grep -E '^(Alias name|Owner|Valid from|[[:space:]]+SHA(1|256)):'
}

if [[ "${1:-}" == "--print" ]]; then
  [[ -f "${2:-}" ]] || { echo "usage: $0 --print <keystore>" >&2; exit 2; }
  print_fingerprints "$2"
  exit 0
fi

DIR="${TEZFIKS_SIGNING_DIR:-$HOME/.tezfiks-signing}"
FILE="$DIR/tezfiks-release.jks"

case "$(cd "$(dirname "$DIR")" 2>/dev/null && pwd)/$(basename "$DIR")" in
  "$REPO_ROOT"|"$REPO_ROOT"/*) echo "Refusing to create the release keystore inside the repository ($DIR)." >&2; exit 1 ;;
esac
if [[ -e "$FILE" ]]; then
  echo "$FILE already exists. Not overwriting a release key. Use: $0 --print $FILE" >&2
  exit 1
fi

umask 077
mkdir -p "$DIR"
args=(-genkeypair -v -storetype PKCS12 -keystore "$FILE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000
  -dname "${TEZFIKS_RELEASE_DNAME:-CN=TezFiks, O=TezFiks, C=AZ}")
[[ -n "${TEZFIKS_RELEASE_STORE_PASSWORD:-}" ]] && args+=(-storepass:env TEZFIKS_RELEASE_STORE_PASSWORD)
[[ -n "${TEZFIKS_RELEASE_KEY_PASSWORD:-}" ]] && args+=(-keypass:env TEZFIKS_RELEASE_KEY_PASSWORD)
keytool "${args[@]}" >/dev/null
chmod 600 "$FILE"

echo "Created $FILE (mode 600). Back it up now (see docs/android-release-signing.md): losing it means no more updates."
print_fingerprints "$FILE"
