#ifndef CSHERPA_ONNX_IOS_BRIDGE_H
#define CSHERPA_ONNX_IOS_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PreSalesIOSSherpaConfig {
    const char *model_path;
    const char *tokens_path;
    const char *language;
    int32_t use_itn;
    int32_t num_threads;
    const char *provider;
} PreSalesIOSSherpaConfig;

typedef struct PreSalesIOSSherpaHandle PreSalesIOSSherpaHandle;

PreSalesIOSSherpaHandle *presales_ios_sherpa_create(const PreSalesIOSSherpaConfig *config);
void presales_ios_sherpa_destroy(PreSalesIOSSherpaHandle *handle);
int32_t presales_ios_sherpa_is_native_linked(void);

char *presales_ios_sherpa_transcribe_pcm(
    PreSalesIOSSherpaHandle *handle,
    const float *samples,
    int32_t num_samples,
    int32_t sample_rate
);

void presales_ios_sherpa_free_text(char *text);

#ifdef __cplusplus
}
#endif

#endif /* CSHERPA_ONNX_IOS_BRIDGE_H */
