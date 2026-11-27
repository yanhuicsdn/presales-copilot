#!/usr/bin/env bash
set -euo pipefail

# Downloads official prebuilt sherpa-onnx macOS xcframework (Apple Silicon arm64 + x86_64)
SHERPA_VERSION="${SHERPA_VERSION:-1.10.44}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORKS_DIR="${SCRIPT_DIR}/../Frameworks"
ARCHIVE="sherpa-onnx-v${SHERPA_VERSION}-osx-universal2-shared.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/${ARCHIVE}"

mkdir -p "${FRAMEWORKS_DIR}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[PreSalesCopilot] Downloading sherpa-onnx v${SHERPA_VERSION} for macOS..."
curl -fL "${URL}" -o "${TMP_DIR}/${ARCHIVE}"
tar -xjf "${TMP_DIR}/${ARCHIVE}" -C "${FRAMEWORKS_DIR}"

echo "[PreSalesCopilot] Extracted sherpa-onnx binaries to ${FRAMEWORKS_DIR}"
echo "[PreSalesCopilot] Enable -DSHERPA_ONNX_LINKED in Xcode build settings to bind live ONNX Runtime C API."
