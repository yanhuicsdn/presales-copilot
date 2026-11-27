#!/usr/bin/env bash
set -euo pipefail

# Downloads official int8 quantized SenseVoice ONNX model for Sherpa-ONNX
# Runs 100% locally on Mac (Apple Silicon CoreML/ONNX Runtime) - zero audio leaves Mac!

TARGET_DIR="${1:-$HOME/Library/Application Support/PreSalesCopilot/models/sensevoice-int8}"
MODEL_ARCHIVE="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
DOWNLOAD_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_ARCHIVE}"

mkdir -p "${TARGET_DIR}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[PreSalesCopilot] Downloading int8 SenseVoice model from sherpa-onnx releases..."
curl -fL "${DOWNLOAD_URL}" -o "${TMP_DIR}/${MODEL_ARCHIVE}"

echo "[PreSalesCopilot] Extracting model archive..."
tar -xjf "${TMP_DIR}/${MODEL_ARCHIVE}" -C "${TMP_DIR}"

EXTRACTED_DIR="${TMP_DIR}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
cp "${EXTRACTED_DIR}/model.int8.onnx" "${TARGET_DIR}/model.int8.onnx"
cp "${EXTRACTED_DIR}/tokens.txt" "${TARGET_DIR}/tokens.txt"

echo "[PreSalesCopilot] Done! Installed int8 SenseVoice model at:"
echo "  - ${TARGET_DIR}/model.int8.onnx"
echo "  - ${TARGET_DIR}/tokens.txt"
