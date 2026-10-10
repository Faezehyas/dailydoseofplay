#!/usr/bin/env bash
# Installs the wasm-pack and wasm-opt versions that scripts/build-mental-poker.sh
# pins (Linux x86-64 release builds), checking each download's SHA-256, into
# DIR, and prints the folders to put on PATH, one per line. Used by CI.
#
#   scripts/install-wasm-tools.sh DIR
set -euo pipefail

DIR="${1:?usage: scripts/install-wasm-tools.sh DIR}"
WASM_PACK="wasm-pack-v0.13.1-x86_64-unknown-linux-musl"
WASM_PACK_URL="https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/$WASM_PACK.tar.gz"
WASM_PACK_SHA256="c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539"
BINARYEN="binaryen-version_130"
BINARYEN_URL="https://github.com/WebAssembly/binaryen/releases/download/version_130/$BINARYEN-x86_64-linux.tar.gz"
BINARYEN_SHA256="0a18362361ad05465118cd8eeb72edaeec89de6894bc283576ef4e07aa3babcc"

mkdir -p "$DIR"
fetch() {
  curl -fsSL --retry 3 -o "$DIR/$3" "$1"
  echo "$2  $DIR/$3" | sha256sum --check --quiet
  tar -xzf "$DIR/$3" -C "$DIR"
  rm "$DIR/$3"
}
fetch "$WASM_PACK_URL" "$WASM_PACK_SHA256" wasm-pack.tar.gz
fetch "$BINARYEN_URL" "$BINARYEN_SHA256" binaryen.tar.gz
echo "$DIR/$WASM_PACK"
echo "$DIR/$BINARYEN/bin"
