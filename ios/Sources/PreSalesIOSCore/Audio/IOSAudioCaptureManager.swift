import Foundation
import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

/// Native iOS audio capture engine built on AVAudioSession + AVAudioEngine.
/// - Resamples microphone PCM to 16kHz mono Float32 for on-device transcription.
/// - Handles iOS phone call / Siri audio interruptions gracefully.
/// - Keeps screen awake during active recording and supports optional local WAV deletion.
public final class IOSAudioCaptureManager {
    public enum CaptureError: Error, LocalizedError {
        case microphonePermissionDenied
        case formatCreationFailed
        case converterCreationFailed
        case engineStartFailed(String)

        public var errorDescription: String? {
            switch self {
            case .microphonePermissionDenied: return "未获得麦克风权限，请在系统设置中允许访问麦克风"
            case .formatCreationFailed: return "无法初始化 16kHz 单声道音频格式"
            case .converterCreationFailed: return "无法创建音频重采样转换器"
            case .engineStartFailed(let msg): return "音频引擎启动失败：\(msg)"
            }
        }
    }

    public var onSpeechChunk: ((VADChunker.SpeechChunk) -> Void)?
    public var onRawPCMBuffer: ((AVAudioPCMBuffer) -> Void)?
    public var onAudioLevel: ((Float) -> Void)?
    public var onInterrupted: ((Bool) -> Void)?

    public private(set) var isRecording = false
    public private(set) var isPaused = false
    public private(set) var lastLocalRecordingURL: URL?

    private let audioEngine = AVAudioEngine()
    private let vadChunker: VADChunker
    private let processingQueue = DispatchQueue(label: "com.presalescopilot.ios.audio.vad", qos: .userInitiated)
    private var localAudioFile: AVAudioFile?
    private var interruptionObserver: NSObjectProtocol?

    public init(vadConfig: VADChunker.Config = VADChunker.Config()) {
        self.vadChunker = VADChunker(config: vadConfig)
        registerInterruptionObserver()
    }

    deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    public func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    public func startRecording(retainLocalAudioFile: Bool, localRecordingsDirectory: URL?) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .measurement,
            options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
        )
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        if isPaused {
            try audioEngine.start()
            isPaused = false
            isRecording = true
            setIdleTimerDisabled(true)
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
            let fileURL = dir.appendingPathComponent("ios-recording-\(Int(Date().timeIntervalSince1970)).wav")
            localAudioFile = try AVAudioFile(forWriting: fileURL, settings: targetFormat.settings)
            lastLocalRecordingURL = fileURL
        } else {
            localAudioFile = nil
            lastLocalRecordingURL = nil
        }

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.onRawPCMBuffer?(buffer)

            let ratio = targetFormat.sampleRate / max(inputFormat.sampleRate, 1)
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
        setIdleTimerDisabled(true)
    }

    public func pauseRecording() {
        guard isRecording else { return }
        audioEngine.pause()
        isPaused = true
        isRecording = false
        setIdleTimerDisabled(false)
        processingQueue.async { [weak self] in
            if let flushed = self?.vadChunker.flush() {
                self?.onSpeechChunk?(flushed)
            }
        }
    }

    public func stopRecording() {
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        localAudioFile = nil
        isRecording = false
        isPaused = false
        setIdleTimerDisabled(false)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        processingQueue.async { [weak self] in
            if let flushed = self?.vadChunker.flush() {
                self?.onSpeechChunk?(flushed)
            }
        }
    }

    public func deleteLastLocalRecording() throws {
        guard let url = lastLocalRecordingURL else { return }
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        lastLocalRecordingURL = nil
    }

    private func setIdleTimerDisabled(_ disabled: Bool) {
        #if canImport(UIKit)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = disabled
        }
        #endif
    }

    private func registerInterruptionObserver() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard let self,
                  let info = notification.userInfo,
                  let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeVal) else { return }

            switch type {
            case .began:
                if self.isRecording {
                    self.pauseRecording()
                    self.onInterrupted?(true)
                }
            case .ended:
                self.onInterrupted?(false)
            @unknown default:
                break
            }
        }
    }
}
