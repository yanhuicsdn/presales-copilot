import Foundation
import CSherpaOnnx

/// 100% On-Device Speech-to-Text Engine backed by Sherpa-ONNX Runtime + int8 SenseVoice model.
/// Guarantees zero raw audio leaves the MacBook (Apple Silicon CoreML / CPU accelerated).
public final class SherpaSenseVoiceEngine {
    public enum ModelStatus: Equatable, Sendable {
        case unloaded
        case ready(nativeLinked: Bool, modelPath: String)
        case missingModelFiles(expectedDir: String)
        case failed(String)

        public var displayText: String {
            switch self {
            case .unloaded:
                return "Sherpa-ONNX 未加载"
            case .ready(let nativeLinked, _):
                return nativeLinked
                    ? "Sherpa-ONNX int8 SenseVoice 已就绪（本地加速）"
                    : "Sherpa-ONNX 桥接已就绪（需运行 setup-sherpa-onnx.sh 链接框架）"
            case .missingModelFiles:
                return "缺少 int8 SenseVoice 模型文件（请运行 download-sensevoice-model.sh）"
            case .failed(let err):
                return "模型加载失败：\(err)"
            }
        }
    }

    public private(set) var status: ModelStatus = .unloaded
    private var handle: OpaquePointer?
    private let inferenceQueue = DispatchQueue(label: "com.presalescopilot.sherpa.inference", qos: .userInitiated)

    public init() {}

    deinit {
        unload()
    }

    public static var defaultModelDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("PreSalesCopilot/models/sensevoice-int8", isDirectory: true)
    }

    public func loadModel(directory: URL = SherpaSenseVoiceEngine.defaultModelDirectory, provider: String = "cpu") -> ModelStatus {
        unload()
        let modelURL = directory.appendingPathComponent("model.int8.onnx")
        let tokensURL = directory.appendingPathComponent("tokens.txt")

        let fm = FileManager.default
        let isNative = presales_sherpa_is_native_linked() == 1
        if isNative && (!fm.fileExists(atPath: modelURL.path) || !fm.fileExists(atPath: tokensURL.path)) {
            status = .missingModelFiles(expectedDir: directory.path)
            return status
        }

        let created: OpaquePointer? = modelURL.path.withCString { modelCStr in
            tokensURL.path.withCString { tokensCStr in
                "zh".withCString { langCStr in
                    provider.withCString { providerCStr in
                        var cfg = PreSalesSherpaConfig(
                            model_path: modelCStr,
                            tokens_path: tokensCStr,
                            language: langCStr,
                            use_itn: 1,
                            num_threads: 4,
                            provider: providerCStr
                        )
                        return presales_sherpa_create(&cfg)
                    }
                }
            }
        }

        guard let created else {
            status = .failed("presales_sherpa_create 返回空句柄")
            return status
        }

        handle = created
        status = .ready(nativeLinked: isNative, modelPath: modelURL.path)
        return status
    }

    public func unload() {
        if let h = handle {
            presales_sherpa_destroy(h)
            handle = nil
        }
        status = .unloaded
    }

    /// Runs local int8 SenseVoice inference on a 16kHz mono Float32 PCM buffer.
    /// Returns recognized Chinese text with automatic punctuation (ITN), or nil if silence.
    public func transcribe(samples: [Float], sampleRate: Int = 16_000) async -> String? {
        guard let h = handle, !samples.isEmpty else { return nil }
        return await withCheckedContinuation { continuation in
            inferenceQueue.async {
                let text: String? = samples.withUnsafeBufferPointer { buf in
                    guard let base = buf.baseAddress else { return nil }
                    guard let rawPtr = presales_sherpa_transcribe_pcm(h, base, Int32(buf.count), Int32(sampleRate)) else {
                        return nil
                    }
                    defer { presales_sherpa_free_text(rawPtr) }
                    let cleaned = String(cString: rawPtr).trimmingCharacters(in: .whitespacesAndNewlines)
                    return cleaned.isEmpty ? nil : cleaned
                }
                continuation.resume(returning: text)
            }
        }
    }
}
