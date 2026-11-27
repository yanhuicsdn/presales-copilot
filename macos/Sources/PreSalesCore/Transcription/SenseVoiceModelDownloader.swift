import Foundation

/// Downloads the official `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`
/// model files (`tokens.txt` + `model.int8.onnx`) directly into local storage with:
/// - Zero external archive/bzip2 dependencies (raw HTTP file download via URLSession)
/// - Automatic dual-mirror fallback (China `hf-mirror.com` -> global `huggingface.co`)
/// - Atomic `.part` staging + file-size verification so interrupted downloads never corrupt models
/// - Smooth progress reporting for non-intrusive status strip / settings UI
public final class SenseVoiceModelDownloader: NSObject, @unchecked Sendable {
    public enum DownloadState: Equatable, Sendable {
        case idle
        case downloading(progress: Double, downloadedMB: Int, totalMB: Int, mirrorName: String)
        case completed
        case failed(String)
    }

    public static let modelRepoPath = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main"

    public static let defaultMirrors: [(name: String, baseURL: String)] = [
        ("HF-Mirror", "https://hf-mirror.com/\(modelRepoPath)"),
        ("HuggingFace", "https://huggingface.co/\(modelRepoPath)")
    ]

    public var onStateChanged: ((DownloadState) -> Void)?
    public private(set) var state: DownloadState = .idle {
        didSet { onStateChanged?(state) }
    }

    private let lock = NSLock()
    private var activeTask: URLSessionDownloadTask?
    private var activeContinuation: CheckedContinuation<URL, Error>?
    private var currentMirrorName = "HF-Mirror"
    private var isCancelledFlag = false
    private var lastReportedPercent = -1
    private var activeSession: URLSession?

    public override init() {
        super.init()
    }

    public static func hasCompleteModel(in directory: URL) -> Bool {
        let fm = FileManager.default
        let modelURL = directory.appendingPathComponent("model.int8.onnx")
        let tokensURL = directory.appendingPathComponent("tokens.txt")
        guard fm.fileExists(atPath: modelURL.path), fm.fileExists(atPath: tokensURL.path) else {
            return false
        }
        let modelSize = (try? fm.attributesOfItem(atPath: modelURL.path)[.size] as? Int64) ?? 0
        let tokensSize = (try? fm.attributesOfItem(atPath: tokensURL.path)[.size] as? Int64) ?? 0
        return modelSize > 100_000_000 && tokensSize > 10_000
    }

    public func cancel() {
        lock.lock()
        isCancelledFlag = true
        let task = activeTask
        lock.unlock()
        task?.cancel()
        state = .idle
    }

    public func deleteModel(in directory: URL) throws {
        let fm = FileManager.default
        for name in ["model.int8.onnx", "tokens.txt", "model.int8.onnx.part", "tokens.txt.part"] {
            let fileURL = directory.appendingPathComponent(name)
            if fm.fileExists(atPath: fileURL.path) {
                try fm.removeItem(at: fileURL)
            }
        }
        state = .idle
    }

    @discardableResult
    public func downloadIfNeeded(
        to directory: URL,
        mirrors: [(name: String, baseURL: String)] = SenseVoiceModelDownloader.defaultMirrors
    ) async -> Bool {
        if Self.hasCompleteModel(in: directory) {
            state = .completed
            return true
        }

        lock.lock()
        isCancelledFlag = false
        lastReportedPercent = -1
        lock.unlock()

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            state = .failed("无法创建模型目录：\(error.localizedDescription)")
            return false
        }

        var lastError = "网络异常"
        for mirror in mirrors {
            if isCancelled() {
                state = .idle
                return false
            }

            currentMirrorName = mirror.name
            state = .downloading(progress: 0.01, downloadedMB: 0, totalMB: 226, mirrorName: mirror.name)

            do {
                try await downloadSingleFile(
                    urlString: "\(mirror.baseURL)/tokens.txt",
                    destination: directory.appendingPathComponent("tokens.txt"),
                    minBytes: 10_000,
                    reportProgress: false
                )

                try await downloadSingleFile(
                    urlString: "\(mirror.baseURL)/model.int8.onnx",
                    destination: directory.appendingPathComponent("model.int8.onnx"),
                    minBytes: 100_000_000,
                    reportProgress: true
                )

                if Self.hasCompleteModel(in: directory) {
                    state = .completed
                    return true
                }
            } catch {
                if isCancelled() || (error as? URLError)?.code == .cancelled {
                    state = .idle
                    return false
                }
                lastError = "\(mirror.name): \(error.localizedDescription)"
            }
        }

        state = .failed(lastError)
        return false
    }

    private func isCancelled() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return isCancelledFlag
    }

    private func downloadSingleFile(
        urlString: String,
        destination: URL,
        minBytes: Int64,
        reportProgress: Bool
    ) async throws {
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }

        // Skip if already valid on disk
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            let size = (try? fm.attributesOfItem(atPath: destination.path)[.size] as? Int64) ?? 0
            if size >= minBytes {
                return
            }
        }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 1800
        let session = URLSession(configuration: config, delegate: reportProgress ? self : nil, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let tempLocation: URL = try await withCheckedThrowingContinuation { continuation in
            if reportProgress {
                let task = session.downloadTask(with: url)
                lock.lock()
                self.activeSession = session
                self.activeTask = task
                self.activeContinuation = continuation
                lock.unlock()
                task.resume()
            } else {
                let simpleTask = session.downloadTask(with: url) { tmpURL, resp, err in
                    if let err {
                        continuation.resume(throwing: err)
                        return
                    }
                    guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode), let tmpURL else {
                        continuation.resume(throwing: URLError(.badServerResponse))
                        return
                    }
                    let staged = destination.appendingPathExtension("part")
                    try? fm.removeItem(at: staged)
                    do {
                        try fm.moveItem(at: tmpURL, to: staged)
                        continuation.resume(returning: staged)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
                lock.lock()
                self.activeSession = session
                self.activeTask = simpleTask
                lock.unlock()
                simpleTask.resume()
            }
        }

        let size = (try? fm.attributesOfItem(atPath: tempLocation.path)[.size] as? Int64) ?? 0
        guard size >= minBytes else {
            try? fm.removeItem(at: tempLocation)
            throw URLError(.cannotDecodeRawData)
        }

        if fm.fileExists(atPath: destination.path) {
            try fm.removeItem(at: destination)
        }
        try fm.moveItem(at: tempLocation, to: destination)
    }
}

extension SenseVoiceModelDownloader: URLSessionDownloadDelegate {
    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 237_115_547
        let progress = min(0.99, max(0.01, Double(totalBytesWritten) / Double(total)))
        let pct = Int(progress * 100)

        lock.lock()
        let shouldEmit = pct != lastReportedPercent
        if shouldEmit { lastReportedPercent = pct }
        let mirror = currentMirrorName
        lock.unlock()

        if shouldEmit {
            let dlMB = Int(totalBytesWritten / 1_048_576)
            let totMB = max(1, Int(total / 1_048_576))
            state = .downloading(progress: progress, downloadedMB: dlMB, totalMB: totMB, mirrorName: mirror)
        }
    }

    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let http = downloadTask.response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            resumeActiveContinuation(with: .failure(URLError(.badServerResponse)))
            return
        }

        let staged = FileManager.default.temporaryDirectory
            .appendingPathComponent("sensevoice-\(UUID().uuidString).onnx.part")
        do {
            try FileManager.default.moveItem(at: location, to: staged)
            resumeActiveContinuation(with: .success(staged))
        } catch {
            resumeActiveContinuation(with: .failure(error))
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            resumeActiveContinuation(with: .failure(error))
        }
    }

    private func resumeActiveContinuation(with result: Result<URL, Error>) {
        lock.lock()
        let cont = activeContinuation
        activeContinuation = nil
        activeTask = nil
        lock.unlock()
        cont?.resume(with: result)
    }
}
