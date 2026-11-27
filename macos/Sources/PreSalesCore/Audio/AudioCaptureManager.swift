import Foundation
#if os(macOS)
import AVFoundation
import IOKit.pwr_mgt
#endif

/// Native macOS audio capture built on AVAudioEngine.
/// - Resamples microphone input to 16kHz mono Float32 PCM for Sherpa-ONNX SenseVoice.
/// - Optionally writes raw WAV recording locally (never uploaded; user can delete anytime).
/// - Acquires macOS IOKit NoIdleSystemSleep assertion while recording to prevent sleep interruption.
public final class AudioCaptureManager {
    public enum CaptureError: Error, LocalizedError {
        case unsupportedPlatform
        case formatCreationFailed
        case converterCreationFailed
        case engineStartFailed(String)

        public var errorDescription: String? {
            switch self {
            case .unsupportedPlatform: return "AudioCaptureManager 仅支持 macOS 平台"
            case .formatCreationFailed: return "无法初始化 16kHz 单声道音频格式"
            case .converterCreationFailed: return "无法创建音频重采样转换器"
            case .engineStartFailed(let msg): return "AVAudioEngine 启动失败: \(msg)"
            }
        }
    }

    public var onSpeechChunk: ((VADChunker.SpeechChunk) -> Void)?
    public var onAudioLevel: ((Float) -> Void)?
    public private(set) var isRecording = false
    public private(set) var isPaused = false
    public private(set) var lastLocalRecordingURL: URL?

    private let vadChunker: VADChunker
    private let processingQueue = DispatchQueue(label: "com.presalescopilot.audio.vad", qos: .userInitiated)

    #if os(macOS)
    private let audioEngine = AVAudioEngine()
    private var localAudioFile: AVAudioFile?
    private var sleepAssertionID: IOPMAssertionID = 0
    private var hasSleepAssertion = false
    #endif

    public init(vadConfig: VADChunker.Config = VADChunker.Config()) {
        self.vadChunker = VADChunker(config: vadConfig)
    }

    public func startRecording(retainLocalAudioFile: Bool, localRecordingsDirectory: URL?) throws {
        #if os(macOS)
        if isPaused {
            try audioEngine.start()
            isPaused = false
            isRecording = true
            acquirePreventSleepAssertion()
            return
        }

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ) else {
            throw CaptureError.formatCreationFailed
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw CaptureError.converterCreationFailed
        }

        if retainLocalAudioFile, let dir = localRecordingsDirectory {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let fileURL = dir.appendingPathComponent("recording-\(Int(Date().timeIntervalSince1970)).wav")
            localAudioFile = try AVAudioFile(forWriting: fileURL, settings: targetFormat.settings)
            lastLocalRecordingURL = fileURL
        } else {
            localAudioFile = nil
            lastLocalRecordingURL = nil
        }

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            let ratio = targetFormat.sampleRate / inputFormat.sampleRate
            let targetFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
            guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: targetFrames) else {
                return
            }

            var error: NSError?
            var consumed = false
            converter.convert(to: converted, error: &error) { _, outStatus in
                if consumed {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                consumed = true
                outStatus.pointee = .haveData
                return buffer
            }

            guard error == nil, converted.frameLength > 0, let channelData = converted.floatChannelData?[0] else {
                return
            }

            if let file = self.localAudioFile {
                try? file.write(from: converted)
            }

            let count = Int(converted.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channelData, count: count))
            let rms = VADChunker.computeRMS(samples)
            self.onAudioLevel?(rms)

            self.processingQueue.async {
                if let chunk = self.vadChunker.append(samples: samples) {
                    self.onSpeechChunk?(chunk)
                }
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            throw CaptureError.engineStartFailed(error.localizedDescription)
        }

        isRecording = true
        isPaused = false
        acquirePreventSleepAssertion()
        #else
        throw CaptureError.unsupportedPlatform
        #endif
    }

    public func pauseRecording() {
        #if os(macOS)
        guard isRecording else { return }
        audioEngine.pause()
        isPaused = true
        isRecording = false
        releasePreventSleepAssertion()
        processingQueue.async { [weak self] in
            if let flushed = self?.vadChunker.flush() {
                self?.onSpeechChunk?(flushed)
            }
        }
        #endif
    }

    public func stopRecording() {
        #if os(macOS)
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        localAudioFile = nil
        isRecording = false
        isPaused = false
        releasePreventSleepAssertion()
        processingQueue.async { [weak self] in
            if let flushed = self?.vadChunker.flush() {
                self?.onSpeechChunk?(flushed)
            }
        }
        #endif
    }

    /// Deletes the local raw recording file on user request (Section 7 Step 10).
    public func deleteLastLocalRecording() throws {
        guard let url = lastLocalRecordingURL else { return }
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        lastLocalRecordingURL = nil
    }

    #if os(macOS)
    private func acquirePreventSleepAssertion() {
        guard !hasSleepAssertion else { return }
        let reason = "售前智问分身正在进行本地实时语音转写" as CFString
        let result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypeNoIdleSystemSleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            reason,
            &sleepAssertionID
        )
        hasSleepAssertion = (result == kIOReturnSuccess)
    }

    private func releasePreventSleepAssertion() {
        guard hasSleepAssertion else { return }
        IOPMAssertionRelease(sleepAssertionID)
        hasSleepAssertion = false
    }
    #endif
}
