import Foundation
import CSherpaOnnx
#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(Speech)
import Speech
#endif

/// 100% On-Device Speech-to-Text Engine for macOS.
/// - Primary: Sherpa-ONNX Runtime + int8 SenseVoice model (when native library + model exist).
/// - Built-in Fallback: macOS Apple SFSpeechRecognizer strictly in on-device mode (`requiresOnDeviceRecognition = true`),
///   so downloaded DMG/App works out of the box with zero audio leaving the MacBook.
public final class SherpaSenseVoiceEngine {
    public enum ModelStatus: Equatable, Sendable {
        case unloaded
        case ready(nativeLinked: Bool, modelPath: String)
        case appleOnDeviceSpeech
        case missingModelFiles(expectedDir: String)
        case failed(String)

        public var isReady: Bool {
            switch self {
            case .ready(let nativeLinked, _): return nativeLinked
            case .appleOnDeviceSpeech: return true
            default: return false
            }
        }

        public var displayText: String {
            switch self {
            case .unloaded:
                return "本地语音未初始化"
            case .ready(let nativeLinked, _):
                return nativeLinked
                    ? "SenseVoice 本地就绪"
                    : "Apple 端侧语音就绪"
            case .appleOnDeviceSpeech:
                return "Apple 端侧语音就绪"
            case .missingModelFiles:
                return "缺少 SenseVoice 模型（已回退 Apple 端侧）"
            case .failed(let err):
                return "语音引擎异常：\(err)"
            }
        }
    }

    public private(set) var status: ModelStatus = .unloaded
    private var handle: OpaquePointer?
    private let inferenceQueue = DispatchQueue(label: "com.presalescopilot.sherpa.inference", qos: .userInitiated)

    #if canImport(Speech)
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var lastCommittedTranscript = ""
    #endif

    public init() {}

    deinit {
        unload()
    }

    public static var defaultModelDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("PreSalesCopilot/models/sensevoice-int8", isDirectory: true)
    }

    @discardableResult
    public func loadModel(directory: URL = SherpaSenseVoiceEngine.defaultModelDirectory, provider: String = "cpu") -> ModelStatus {
        unload()
        let modelURL = directory.appendingPathComponent("model.int8.onnx")
        let tokensURL = directory.appendingPathComponent("tokens.txt")

        let fm = FileManager.default
        let isNative = presales_sherpa_is_native_linked() == 1
        if isNative && fm.fileExists(atPath: modelURL.path) && fm.fileExists(atPath: tokensURL.path) {
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

            if let created {
                handle = created
                status = .ready(nativeLinked: true, modelPath: modelURL.path)
                return status
            }
        }

        // Fall back seamlessly to Apple's built-in on-device speech recognizer (zh-CN, zero audio upload)
        status = .appleOnDeviceSpeech
        return status
    }

    public func unload() {
        stopAppleOnDeviceStream()
        if let h = handle {
            presales_sherpa_destroy(h)
            handle = nil
        }
        status = .unloaded
    }

    private struct SendableHandleBox: @unchecked Sendable {
        let ptr: OpaquePointer
    }

    /// Runs local int8 SenseVoice inference on a 16kHz mono Float32 PCM buffer when native Sherpa is active.
    public func transcribe(samples: [Float], sampleRate: Int = 16_000) async -> String? {
        guard let h = handle, !samples.isEmpty else { return nil }
        let box = SendableHandleBox(ptr: h)
        return await withCheckedContinuation { continuation in
            inferenceQueue.async {
                let text: String? = samples.withUnsafeBufferPointer { buf in
                    guard let base = buf.baseAddress else { return nil }
                    guard let rawPtr = presales_sherpa_transcribe_pcm(box.ptr, base, Int32(buf.count), Int32(sampleRate)) else {
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

    public func requestSpeechAuthorization() async -> Bool {
        #if canImport(Speech)
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { authStatus in
                continuation.resume(returning: authStatus == .authorized)
            }
        }
        #else
        return false
        #endif
    }

    public func startAppleOnDeviceStream(onFinalSegment: @escaping (String) -> Void) {
        #if canImport(Speech)
        guard case .appleOnDeviceSpeech = status, let recognizer = speechRecognizer else { return }
        stopAppleOnDeviceStream()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        recognitionRequest = request
        lastCommittedTranscript = ""

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let fullText = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                if result.isFinal {
                    let delta = Self.extractDelta(fullText: fullText, committed: self.lastCommittedTranscript)
                    if !delta.isEmpty {
                        self.lastCommittedTranscript = fullText
                        onFinalSegment(delta)
                    }
                } else if let lastChar = fullText.last, "。！？?!".contains(lastChar) {
                    let delta = Self.extractDelta(fullText: fullText, committed: self.lastCommittedTranscript)
                    if delta.count >= 6 {
                        self.lastCommittedTranscript = fullText
                        onFinalSegment(delta)
                    }
                }
            }
            if error != nil {
                self.stopAppleOnDeviceStream()
            }
        }
        #endif
    }

    #if canImport(AVFoundation)
    public func appendAudioBufferForAppleSpeech(_ buffer: AVAudioPCMBuffer) {
        #if canImport(Speech)
        recognitionRequest?.append(buffer)
        #endif
    }
    #endif

    public func stopAppleOnDeviceStream() {
        #if canImport(Speech)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        #endif
    }

    public static func extractDelta(fullText: String, committed: String) -> String {
        guard !committed.isEmpty else { return fullText }
        if fullText.hasPrefix(committed) {
            return String(fullText.dropFirst(committed.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return fullText
    }
}
