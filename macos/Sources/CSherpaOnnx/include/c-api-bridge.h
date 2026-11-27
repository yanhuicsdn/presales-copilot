#ifndef CSHERPA_ONNX_BRIDGE_H
#define CSHERPA_ONNX_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Minimal C API bridge compatible with k2-fsa/sherpa-onnx C API for
 * int8 SenseVoice offline recognizer (run in 1-2s VAD streaming chunks on macOS Apple Silicon).
 *
 * When SHERPA_ONNX_LINKED is defined (after running scripts/setup-sherpa-onnx.sh),
 * calls bind directly to sherpa-onnx.xcframework. Otherwise, the bridge compiles cleanly
 * for SwiftUI preview / unit tests with a safe stub indicator.
 */

typedef struct PreSalesSherpaConfig {
    const char *model_path;       // Path to model.int8.onnx
    const char *tokens_path;      // Path to tokens.txt
    const char *language;         // "zh" or "auto"
    int32_t use_itn;              // 1 = enable inverse text normalization & punctuation
    int32_t num_threads;          // Recommended: 4 on Apple Silicon
    const char *provider;         // "coreml" or "cpu"
} PreSalesSherpaConfig;

typedef struct PreSalesSherpaHandle PreSalesSherpaHandle;

PreSalesSherpaHandle *presales_sherpa_create(const PreSalesSherpaConfig *config);
void presales_sherpa_destroy(PreSalesSherpaHandle *handle);
int32_t presales_sherpa_is_native_linked(void);

/**
 * Decodes 16kHz mono Float32 PCM audio samples completely locally on Mac.
 * Caller must free returned string via presales_sherpa_free_text().
 */
char *presales_sherpa_transcribe_pcm(
    PreSalesSherpaHandle *handle,
    const float *samples,
    int32_t num_samples,
    int32_t sample_rate
);

void presales_sherpa_free_text(char *text);

#ifdef __cplusplus
}
#endif

#endif /* CSHERPA_ONNX_BRIDGE_H */
