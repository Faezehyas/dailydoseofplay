#!/usr/bin/env bash
# Builds the mental-poker library (vendor/mental-poker, a pinned git
# submodule) to WebAssembly, with our patches from vendor/patches/mental-poker
# and our Cargo.lock, and writes it to public/engine/vendor/mental-poker/.
# The output is committed: the site has no build step, so Wasmer serves it as is.
#
#   scripts/build-mental-poker.sh          rebuild the committed files
#   scripts/build-mental-poker.sh --check  fail if a fresh build differs from them
#
# Needs rustup, wasm-pack and wasm-opt (binaryen), at the versions below, so
# that every machine builds the same bytes.
set -euo pipefail

TOOLCHAIN="1.98.1"
WASM_PACK_VERSION="0.13.1"
WASM_OPT_VERSION="130"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vendor/mental-poker"
PATCHES="$ROOT/vendor/patches/mental-poker"
LOCK="$ROOT/vendor/mental-poker.Cargo.lock"
OUT="$ROOT/public/engine/vendor/mental-poker"

fail() { echo "build-mental-poker: $*" >&2; exit 1; }

[ -e "$SRC/.git" ] || fail "vendor/mental-poker is missing: run git submodule update --init"
# The commit this repo pins (staged or committed), whatever the submodule has checked out.
PIN="$(git -C "$ROOT" ls-files --stage vendor/mental-poker | awk '$1 == "160000" { print $2 }')"
[ -n "$PIN" ] || fail "vendor/mental-poker is not a pinned submodule"
git -C "$SRC" cat-file -e "$PIN^{commit}" 2>/dev/null || fail "vendor/mental-poker doesn't have $PIN: run git submodule update --init"
wasm-pack --version | grep -qx "wasm-pack $WASM_PACK_VERSION" || fail "needs wasm-pack $WASM_PACK_VERSION (cargo install wasm-pack --version $WASM_PACK_VERSION --locked)"
wasm-opt --version | grep -q "version $WASM_OPT_VERSION\b" || fail "needs wasm-opt version $WASM_OPT_VERSION on PATH (binaryen release version_$WASM_OPT_VERSION)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$SRC" archive "$PIN" | tar -x -C "$WORK"
for p in "$PATCHES"/*.patch; do
  patch -d "$WORK" -p1 --quiet --forward < "$p" || fail "patch $(basename "$p") does not apply"
done
cp "$LOCK" "$WORK/Cargo.lock"

rustup toolchain install "$TOOLCHAIN" --profile minimal --target wasm32-unknown-unknown >/dev/null
export RUSTUP_TOOLCHAIN="$TOOLCHAIN"
# Keep machine-specific paths out of the binary.
export RUSTFLAGS="--remap-path-prefix=$WORK=/mental-poker --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"

(cd "$WORK" && wasm-pack --quiet build play --release --target web --no-pack --out-dir "$WORK/pkg" -- --features wasm --locked)

DEST="$OUT"
[ "${1:-}" = "--check" ] && DEST="$WORK/out"
rm -rf "$DEST" && mkdir -p "$DEST"
cp "$WORK/pkg/cards_play.js" "$WORK/pkg/cards_play_bg.wasm" "$DEST/"
cp "$ROOT/vendor/mental-poker.LICENSE" "$DEST/LICENSE"
echo "paritytech/mental-poker $PIN + vendor/patches/mental-poker" > "$DEST/SOURCE"

if [ "${1:-}" = "--check" ]; then
  diff -r "$OUT" "$DEST" >/dev/null || { diff -rq "$OUT" "$DEST" >&2 || true; fail "public/engine/vendor/mental-poker differs from a fresh build"; }
  echo "build-mental-poker: the committed files match a fresh build"
else
  (cd "$DEST" && sha256sum cards_play_bg.wasm cards_play.js)
fi
