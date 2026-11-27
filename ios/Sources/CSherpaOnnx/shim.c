#include "c-api-bridge.h"
#include <stdlib.h>
#include <string.h>

#ifdef SHERPA_ONNX_LINKED
#include "sherpa-onnx/c-api/c-api.h"

struct PreSalesIOSSherpaHandle {
    const SherpaOnnxOfflineRecognizer *recognizer;
};

int32_t presales_ios_sherpa_is_native_linked(void) {
    return 1;
}

PreSalesIOSSherpaHandle *presales_ios_sherpa_create(const PreSalesIOSSherpaConfig *config) {
    if (!config || !config->model_path || !config->tokens_path) {
        return NULL;
    }

    SherpaOnnxOfflineRecognizerConfig rec_cfg;
    memset(&rec_cfg, 0, sizeof(rec_cfg));

    rec_cfg.feat_config.sample_rate = 16000;
    rec_cfg.feat_config.feature_dim = 80;

    rec_cfg.model_config.sense_voice.model = config->model_path;
    rec_cfg.model_config.sense_voice.language = config->language ? config->language : "zh";
    rec_cfg.model_config.sense_voice.use_itn = config->use_itn;
    rec_cfg.model_config.tokens = config->tokens_path;
    rec_cfg.model_config.num_threads = config->num_threads > 0 ? config->num_threads : 2;
    rec_cfg.model_config.provider = config->provider ? config->provider : "cpu";
    rec_cfg.model_config.debug = 0;

    const SherpaOnnxOfflineRecognizer *rec = SherpaOnnxCreateOfflineRecognizer(&rec_cfg);
    if (!rec) {
        return NULL;
    }

    PreSalesIOSSherpaHandle *handle = (PreSalesIOSSherpaHandle *)malloc(sizeof(PreSalesIOSSherpaHandle));
    if (!handle) {
        SherpaOnnxDestroyOfflineRecognizer(rec);
        return NULL;
    }
    handle->recognizer = rec;
    return handle;
}

void presales_ios_sherpa_destroy(PreSalesIOSSherpaHandle *handle) {
    if (!handle) return;
    if (handle->recognizer) {
        SherpaOnnxDestroyOfflineRecognizer(handle->recognizer);
    }
    free(handle);
}

char *presales_ios_sherpa_transcribe_pcm(
    PreSalesIOSSherpaHandle *handle,
    const float *samples,
    int32_t num_samples,
    int32_t sample_rate
) {
    if (!handle || !handle->recognizer || !samples || num_samples <= 0) {
        return NULL;
    }
    const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(handle->recognizer);
    if (!stream) {
        return NULL;
    }
    SherpaOnnxAcceptWaveformOffline(stream, sample_rate, samples, num_samples);
    SherpaOnnxDecodeOfflineStream(handle->recognizer, stream);
    const SherpaOnnxOfflineRecognizerResult *res = SherpaOnnxGetOfflineStreamResult(stream);

    char *out = NULL;
    if (res && res->text) {
        size_t len = strlen(res->text);
        out = (char *)malloc(len + 1);
        if (out) {
            memcpy(out, res->text, len + 1);
        }
    }

    if (res) {
        SherpaOnnxDestroyOfflineRecognizerResult(res);
    }
    SherpaOnnxDestroyOfflineStream(stream);
    return out;
}

#else

struct PreSalesIOSSherpaHandle {
    int placeholder;
};

int32_t presales_ios_sherpa_is_native_linked(void) {
    return 0;
}

PreSalesIOSSherpaHandle *presales_ios_sherpa_create(const PreSalesIOSSherpaConfig *config) {
    if (!config || !config->model_path || !config->tokens_path) {
        return NULL;
    }
    PreSalesIOSSherpaHandle *handle = (PreSalesIOSSherpaHandle *)malloc(sizeof(PreSalesIOSSherpaHandle));
    if (handle) {
        handle->placeholder = 1;
    }
    return handle;
}

void presales_ios_sherpa_destroy(PreSalesIOSSherpaHandle *handle) {
    if (handle) {
        free(handle);
    }
}

char *presales_ios_sherpa_transcribe_pcm(
    PreSalesIOSSherpaHandle *handle,
    const float *samples,
    int32_t num_samples,
    int32_t sample_rate
) {
    (void)handle;
    (void)samples;
    (void)num_samples;
    (void)sample_rate;
    return NULL;
}

#endif

void presales_ios_sherpa_free_text(char *text) {
    if (text) {
        free(text);
    }
}
