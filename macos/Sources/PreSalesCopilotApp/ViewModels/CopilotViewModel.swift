import Foundation
import SwiftUI
import AppKit
import PreSalesCore

@MainActor
public final class CopilotViewModel: ObservableObject {
    @Published public var groups: [CustomerGroup] = []
    @Published public var selectedGroupId: String?
    @Published public var checkpoint: GroupCheckpoint?
    @Published public var capturedCount: Int = 0
    @Published public var latestCard: QuestionCard?
    @Published public var latestSummary: MeetingSummary?
    @Published public var showSummarySheet = false

    @Published public var isRecording = false
    @Published public var isPaused = false
    @Published public var isTranscribing = false
    @Published public var isAnalyzing = false
    @Published public var unpromptedCount = 0
    @Published public var audioLevel: Float = 0

    @Published public var connectionState: CloudConnectionState = .disconnected
    @Published public var activeModel: String = "DeepSeek"
    @Published public var providerMode: String = "deepseek"

    @Published public var offlineMode = false {
        didSet {
            syncClient.isOfflineMode = offlineMode
            setStatus(offlineMode ? "已开启涉密离线模式（文本仅本地暂存）" : "正在重连云端 Agent...")
            Task { await refreshPendingCount() }
        }
    }

    @Published public var autoHintEnabled: Bool {
        didSet { UserDefaults.standard.set(autoHintEnabled, forKey: Self.keyAutoHintEnabled) }
    }
    @Published public var autoHintThreshold: Int {
        didSet {
            let clamped = min(max(autoHintThreshold, 2), 15)
            if clamped != autoHintThreshold {
                autoHintThreshold = clamped
                return
            }
            UserDefaults.standard.set(autoHintThreshold, forKey: Self.keyAutoHintThreshold)
        }
    }
    @Published public var retainLocalAudioFile: Bool {
        didSet { UserDefaults.standard.set(retainLocalAudioFile, forKey: Self.keyRetainLocalAudio) }
    }
    @Published public var cloudBaseURLString: String
    @Published public var modelStatus: SherpaSenseVoiceEngine.ModelStatus = .unloaded
    @Published public var modelDownloadState: SenseVoiceModelDownloader.DownloadState = .idle
    @Published public var pendingQueueCount = 0
    @Published public var statusMessage: String = ""

    private static let defaultCloudURL = "https://presales.88886666.site"
    private static let keyCloudURL = "presales.cloudBaseURL"
    private static let keyAutoHintEnabled = "presales.autoHintEnabled"
    private static let keyAutoHintThreshold = "presales.autoHintThreshold"
    private static let keyRetainLocalAudio = "presales.retainLocalAudio"

    private let audioManager = AudioCaptureManager()
    private let sherpaEngine = SherpaSenseVoiceEngine()
    private let modelDownloader = SenseVoiceModelDownloader()
    private var syncClient: CloudSyncClient
    private var currentSessionId: String?
    private var nextSeq: Int = 1
    private var unpromptedChars: Int = 0
    private var clearStatusTask: Task<Void, Never>?

    public init() {
        let savedURL = UserDefaults.standard.string(forKey: Self.keyCloudURL) ?? Self.defaultCloudURL
        let savedAutoHint = UserDefaults.standard.object(forKey: Self.keyAutoHintEnabled) as? Bool ?? false
        let savedThreshold = UserDefaults.standard.object(forKey: Self.keyAutoHintThreshold) as? Int ?? 5
        let savedRetain = UserDefaults.standard.object(forKey: Self.keyRetainLocalAudio) as? Bool ?? false

        self.cloudBaseURLString = savedURL
        self.autoHintEnabled = savedAutoHint
        self.autoHintThreshold = min(max(savedThreshold, 2), 15)
        self.retainLocalAudioFile = savedRetain

        let initialURL = URL(string: savedURL) ?? URL(string: Self.defaultCloudURL)!
        self.syncClient = CloudSyncClient(baseHTTPURL: initialURL)
        wireCallbacks()
        loadLocalModel()
        Task {
            await fetchHealth()
            await refreshGroups()
            if SherpaSenseVoiceEngine.isNativeSherpaLinked &&
                !SenseVoiceModelDownloader.hasCompleteModel(in: SherpaSenseVoiceEngine.defaultModelDirectory) &&
                !offlineMode {
                startModelDownload()
            }
        }
    }

    public var currentStage: StageCode {
        checkpoint?.currentStage ?? .S0
    }

    public var activeGroupName: String {
        groups.first(where: { $0.id == selectedGroupId })?.name ?? "选择客户分组"
    }

    public var confirmedBoundaryCount: Int {
        checkpoint?.boundaries.confirmedCoreCount ?? 0
    }

    public var canRequestHint: Bool {
        capturedCount > 0 && !isAnalyzing && !offlineMode && selectedGroupId != nil
    }

    public var isSenseVoiceActive: Bool {
        if case .ready(let nativeLinked, _) = modelStatus {
            return nativeLinked
        }
        return false
    }

    public func loadLocalModel() {
        modelStatus = sherpaEngine.loadModel()
        if SenseVoiceModelDownloader.hasCompleteModel(in: SherpaSenseVoiceEngine.defaultModelDirectory) {
            modelDownloadState = .completed
        }
    }

    public func startModelDownload() {
        if case .downloading = modelDownloadState { return }
        guard !offlineMode else {
            setStatus("离线模式下无法下载模型，请先关闭涉密离线模式")
            return
        }
        setStatus("正在后台下载 int8 SenseVoice 模型 (~226MB)...")
        Task {
            let ok = await modelDownloader.downloadIfNeeded(to: SherpaSenseVoiceEngine.defaultModelDirectory)
            if ok {
                let wasRecording = self.isRecording
                if wasRecording {
                    self.sherpaEngine.stopAppleOnDeviceStream()
                }
                self.loadLocalModel()
                self.setStatus("Sherpa-ONNX int8 SenseVoice 已就绪")
            }
        }
    }

    public func cancelModelDownload() {
        modelDownloader.cancel()
        setStatus("已取消 SenseVoice 模型下载")
    }

    public func deleteLocalModel() {
        do {
            sherpaEngine.unload()
            try modelDownloader.deleteModel(in: SherpaSenseVoiceEngine.defaultModelDirectory)
            loadLocalModel()
            setStatus("已删除本地 SenseVoice 模型（已切换回 Apple 端侧语音）")
        } catch {
            setStatus("删除模型失败：\(error.localizedDescription)")
        }
    }

    public func fetchHealth() async {
        guard !offlineMode else { return }
        if let info = await syncClient.fetchHealth() {
            if let mode = info.providerMode { providerMode = mode }
            if let model = info.model, !model.isEmpty { activeModel = model }
        }
    }

    public func updateCloudURL(_ urlString: String) {
        var cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        while cleaned.hasSuffix("/") { cleaned.removeLast() }
        guard let url = URL(string: cleaned), !cleaned.isEmpty else {
            setStatus("云端服务地址格式无效")
            return
        }
        cloudBaseURLString = url.absoluteString
        UserDefaults.standard.set(cloudBaseURLString, forKey: Self.keyCloudURL)
        syncClient.baseHTTPURL = url
        if let gid = selectedGroupId, !offlineMode {
            syncClient.connect(groupId: gid)
        }
        Task {
            await fetchHealth()
            await refreshGroups()
        }
        setStatus("已切换云端服务地址")
    }

    public func refreshGroups() async {
        guard !offlineMode else { return }
        do {
            let fetched = try await syncClient.fetchGroups()
            groups = fetched
            if selectedGroupId == nil, let first = fetched.first {
                selectGroup(first.id)
            }
        } catch {
            setStatus("拉取客户分组失败：\(error.localizedDescription)")
        }
    }

    @discardableResult
    public func createGroup(name: String, company: String, industry: String) async -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        do {
            let (group, cp) = try await syncClient.createGroup(name: trimmed, company: company, industry: industry)
            groups.insert(group, at: 0)
            selectedGroupId = group.id
            checkpoint = cp
            capturedCount = 0
            unpromptedCount = 0
            unpromptedChars = 0
            latestCard = nil
            latestSummary = nil
            nextSeq = 1
            syncClient.connect(groupId: group.id)
            setStatus("已创建分组：\(group.name)")
            return group.id
        } catch {
            setStatus("创建客户分组失败：\(error.localizedDescription)")
            return nil
        }
    }

    public func selectGroup(_ groupId: String) {
        selectedGroupId = groupId
        latestSummary = nil
        unpromptedCount = 0
        unpromptedChars = 0
        syncClient.connect(groupId: groupId)
        Task { await refreshPendingCount() }
    }

    /// Mirrors Omarchy single-click Record/Pause UX:
    /// Auto-creates a default group if none is selected so recording starts immediately.
    public func toggleRecording() {
        if isRecording {
            pauseRecording()
            return
        }

        if selectedGroupId == nil {
            if offlineMode {
                selectedGroupId = "grp_offline_\(UUID().uuidString.prefix(8))"
                startRecordingInternal()
            } else {
                let df = DateFormatter()
                df.dateFormat = "MM-dd HH:mm"
                let defaultName = "现场会议 \(df.string(from: Date()))"
                setStatus("正在自动创建会话分组...")
                Task {
                    if await createGroup(name: defaultName, company: "", industry: "") != nil {
                        startRecordingInternal()
                    }
                }
            }
            return
        }

        startRecordingInternal()
    }

    private func startRecordingInternal() {
        guard let groupId = selectedGroupId else { return }

        Task {
            if case .appleOnDeviceSpeech = modelStatus {
                let granted = await sherpaEngine.requestSpeechAuthorization()
                if !granted {
                    setStatus("请在系统设置开启语音识别权限，或配置 SenseVoice 本地模型")
                }
            }

            do {
                let recordingsDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
                    .appendingPathComponent("PreSalesCopilot/recordings/\(groupId)", isDirectory: true)
                try audioManager.startRecording(
                    retainLocalAudioFile: retainLocalAudioFile,
                    localRecordingsDirectory: recordingsDir
                )

                if case .appleOnDeviceSpeech = modelStatus {
                    sherpaEngine.startAppleOnDeviceStream { [weak self] text in
                        Task { @MainActor in
                            self?.submitTranscriptSilently(text)
                        }
                    }
                }

                let action = isPaused ? "resume" : "start"
                if currentSessionId == nil {
                    currentSessionId = "ses_mac_\(UUID().uuidString.prefix(8))"
                }
                isRecording = true
                isPaused = false
                setStatus("本地静默录音中（原始音频零上传）")

                if !offlineMode {
                    _ = try? await syncClient.sendSessionControl(groupId: groupId, sessionId: currentSessionId, action: action)
                }
            } catch {
                setStatus(error.localizedDescription)
            }
        }
    }

    public func pauseRecording() {
        audioManager.pauseRecording()
        sherpaEngine.stopAppleOnDeviceStream()
        isRecording = false
        isPaused = true
        setStatus("已暂停录音")
        if let groupId = selectedGroupId, !offlineMode {
            Task {
                _ = try? await syncClient.sendSessionControl(groupId: groupId, sessionId: currentSessionId, action: "pause")
            }
        }
    }

    public func endSession() {
        audioManager.stopRecording()
        sherpaEngine.stopAppleOnDeviceStream()
        isRecording = false
        isPaused = false
        guard let groupId = selectedGroupId else { return }
        if offlineMode {
            setStatus("离线模式下请联网后生成云端结构化纪要")
            return
        }
        let sid = currentSessionId
        currentSessionId = nil
        setStatus("正在生成结构化沟通纪要...")
        Task {
            do {
                if let summary = try await syncClient.sendSessionControl(groupId: groupId, sessionId: sid, action: "end") {
                    latestSummary = summary
                    showSummarySheet = true
                    setStatus("结构化纪要已生成")
                }
            } catch {
                setStatus("生成纪要失败：\(error.localizedDescription)")
            }
        }
    }

    /// On-demand button action ("获取提问建议"), identical to Omarchy `Backend::requestHint()`.
    public func requestHint() {
        guard let groupId = selectedGroupId else {
            setStatus("请先开始录音或选择客户分组")
            return
        }
        guard !offlineMode else {
            setStatus("涉密离线模式中，联网后可获取云端建议")
            return
        }
        guard capturedCount > 0 else {
            setStatus("尚未采集到对话内容")
            return
        }
        guard !isAnalyzing else { return }

        isAnalyzing = true
        unpromptedCount = 0
        unpromptedChars = 0
        setStatus("正在提炼简短提词...")

        let sid = currentSessionId
        Task {
            do {
                let (card, cp) = try await syncClient.requestHint(groupId: groupId, sessionId: sid)
                if let card {
                    latestCard = card
                    isAnalyzing = false
                    setStatus("")
                }
                if let cp {
                    checkpoint = cp
                }
            } catch {
                isAnalyzing = false
                setStatus("获取提词失败：\(error.localizedDescription)")
            }
        }
    }

    public func copyText(_ text: String) {
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        setStatus("已复制到剪贴板")
    }

    public func deleteLastLocalRecording() {
        do {
            try audioManager.deleteLastLocalRecording()
            setStatus("已删除本机原始录音")
        } catch {
            setStatus("删除本地录音失败：\(error.localizedDescription)")
        }
    }

    /// Silently uploads transcribed speech without spamming prompts on every sentence.
    /// Only triggers auto-analyze if user explicitly enabled auto-hint and threshold is met.
    public func submitTranscriptSilently(_ text: String, startedAt: Int64? = nil, endedAt: Int64? = nil) {
        guard let groupId = selectedGroupId else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let seq = nextSeq
        nextSeq += 1
        let sid = currentSessionId ?? "ses_mac_default"

        let outgoing = OutgoingSegmentPayload(
            groupId: groupId,
            sessionId: sid,
            seq: seq,
            text: trimmed,
            startedAt: startedAt ?? now,
            endedAt: endedAt ?? now,
            isFinal: true
        )

        capturedCount += 1
        unpromptedCount += 1
        unpromptedChars += trimmed.count

        let shouldAutoTrigger = !offlineMode &&
            autoHintEnabled &&
            unpromptedCount >= autoHintThreshold &&
            unpromptedChars >= 60

        if shouldAutoTrigger {
            isAnalyzing = true
            unpromptedCount = 0
            unpromptedChars = 0
        }

        Task {
            await syncClient.sendSegment(outgoing, autoAnalyze: shouldAutoTrigger)
            await refreshPendingCount()
        }
    }

    private func setStatus(_ msg: String) {
        statusMessage = msg
        clearStatusTask?.cancel()
        guard !msg.isEmpty else { return }
        clearStatusTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled && self.statusMessage == msg {
                self.statusMessage = ""
            }
        }
    }

    private func refreshPendingCount() async {
        pendingQueueCount = await syncClient.pendingQueue.count(forGroup: selectedGroupId)
    }

    private func wireCallbacks() {
        modelDownloader.onStateChanged = { [weak self] st in
            Task { @MainActor in
                self?.modelDownloadState = st
                if case .failed(let err) = st {
                    self?.setStatus("模型下载失败（当前用 Apple 端侧兜底）：\(err)")
                }
            }
        }

        audioManager.onAudioLevel = { [weak self] rms in
            Task { @MainActor in
                self?.audioLevel = min(1.0, rms * 10.0)
            }
        }

        audioManager.onRawPCMBuffer = { [weak self] buffer in
            self?.sherpaEngine.appendAudioBufferForAppleSpeech(buffer)
        }

        audioManager.onSpeechChunk = { [weak self] chunk in
            guard let self else { return }
            Task {
                await MainActor.run { self.isTranscribing = true }
                let text = await self.sherpaEngine.transcribe(samples: chunk.samples, sampleRate: 16_000)
                await MainActor.run {
                    self.isTranscribing = false
                    if let text {
                        self.submitTranscriptSilently(text, startedAt: chunk.startedAtMs, endedAt: chunk.endedAtMs)
                    }
                }
            }
        }

        syncClient.onConnectionStateChanged = { [weak self] state in
            Task { @MainActor in self?.connectionState = state }
        }

        syncClient.onSnapshot = { [weak self] group, cp, segs, card, _ in
            Task { @MainActor in
                self?.checkpoint = cp
                self?.capturedCount = segs.count
                self?.latestCard = card
                self?.nextSeq = max(group.nextExpectedSeq, (segs.last?.seq ?? 0) + 1)
                await self?.refreshPendingCount()
            }
        }

        syncClient.onQuestionCard = { [weak self] card in
            Task { @MainActor in
                self?.isAnalyzing = false
                self?.latestCard = card
                self?.statusMessage = ""
            }
        }

        syncClient.onStageUpdated = { [weak self] _, _, cp in
            Task { @MainActor in
                self?.checkpoint = cp
            }
        }

        syncClient.onSegmentAck = { [weak self] _, _, _, nextExpected in
            Task { @MainActor in
                self?.nextSeq = max(self?.nextSeq ?? 1, nextExpected)
                await self?.refreshPendingCount()
            }
        }

        syncClient.onSessionSummary = { [weak self] summary in
            Task { @MainActor in
                self?.latestSummary = summary
                self?.showSummarySheet = true
            }
        }

        syncClient.onError = { [weak self] msg in
            Task { @MainActor in
                self?.isAnalyzing = false
                self?.setStatus(msg)
            }
        }
    }
}
