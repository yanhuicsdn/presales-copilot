import Foundation

/// Energy-based Voice Activity Detection (VAD) chunker optimized for 16kHz mono Float32 PCM
/// feeding Sherpa-ONNX int8 SenseVoice to achieve 1-2s local transcription latency.
public final class VADChunker {
    public struct Config: Sendable {
        public var sampleRate: Int = 16_000
        public var energyThreshold: Float = 0.012
        public var silenceFlushSeconds: Double = 0.65
        public var maxChunkSeconds: Double = 4.0
        public var minSpeechSeconds: Double = 0.45

        public init(
            sampleRate: Int = 16_000,
            energyThreshold: Float = 0.012,
            silenceFlushSeconds: Double = 0.65,
            maxChunkSeconds: Double = 4.0,
            minSpeechSeconds: Double = 0.45
        ) {
            self.sampleRate = sampleRate
            self.energyThreshold = energyThreshold
            self.silenceFlushSeconds = silenceFlushSeconds
            self.maxChunkSeconds = maxChunkSeconds
            self.minSpeechSeconds = minSpeechSeconds
        }
    }

    public struct SpeechChunk: Sendable {
        public let samples: [Float]
        public let startedAtMs: Int64
        public let endedAtMs: Int64
    }

    private let config: Config
    private var buffer: [Float] = []
    private var speechSamplesCount: Int = 0
    private var trailingSilenceSamples: Int = 0
    private var chunkStartMs: Int64?

    public init(config: Config = Config()) {
        self.config = config
    }

    public func append(samples: [Float], nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> SpeechChunk? {
        guard !samples.isEmpty else { return nil }

        let rms = Self.computeRMS(samples)
        let isSpeech = rms >= config.energyThreshold

        if isSpeech {
            if chunkStartMs == nil {
                chunkStartMs = nowMs
            }
            buffer.append(contentsOf: samples)
            speechSamplesCount += samples.count
            trailingSilenceSamples = 0
        } else if !buffer.isEmpty {
            buffer.append(contentsOf: samples)
            trailingSilenceSamples += samples.count
        }

        let maxSamples = Int(Double(config.sampleRate) * config.maxChunkSeconds)
        let silenceLimit = Int(Double(config.sampleRate) * config.silenceFlushSeconds)
        let minSpeech = Int(Double(config.sampleRate) * config.minSpeechSeconds)

        if buffer.count >= maxSamples || (trailingSilenceSamples >= silenceLimit && speechSamplesCount >= minSpeech) {
            return flush(nowMs: nowMs)
        }
        return nil
    }

    public func flush(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> SpeechChunk? {
        let minSpeech = Int(Double(config.sampleRate) * config.minSpeechSeconds)
        defer {
            buffer.removeAll(keepingCapacity: true)
            speechSamplesCount = 0
            trailingSilenceSamples = 0
            chunkStartMs = nil
        }
        guard speechSamplesCount >= minSpeech, !buffer.isEmpty else {
            return nil
        }
        return SpeechChunk(
            samples: buffer,
            startedAtMs: chunkStartMs ?? nowMs,
            endedAtMs: nowMs
        )
    }

    public static func computeRMS(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sumSq: Float = 0
        for s in samples {
            sumSq += s * s
        }
        return sqrt(sumSq / Float(samples.count))
    }
}
