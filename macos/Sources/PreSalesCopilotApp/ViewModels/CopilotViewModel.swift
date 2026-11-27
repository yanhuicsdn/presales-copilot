import Foundation
import SwiftUI
import PreSalesCore

@MainActor
public final class CopilotViewModel: ObservableObject {
    @Published public var groups: [CustomerGroup] = []
    @Published public var selectedGroupId: String?
    @Published public var checkpoint: GroupCheckpoint?
    @Published public var segments: [TranscriptSegment] = []
    @Published public var latestCard: QuestionCard?
    @Published public var latestSummary: MeetingSummary?
    @Published public var showSummarySheet = false

    @Published public var isRecording = false
    @Published public var isPaused = false
    @Published public var audioLevel: Float = 0
    @Published public var connectionState: CloudConnectionState = .disconnected
    @Published public var offlineMode = false {
        didSet {
            syncClient.isOfflineMode = offlineMode
            Task { await refreshPendingCount() }
        }
    }
    @Published public var modelStatus: SherpaSenseVoiceEngine.ModelStatus = .unloaded
    @Published public var pendingQueueCount = 0
    @Published public var retainLocalAudioFile = false
    @Published public var cloudBaseURLString = "https://presales.88886666.site"
    @Published public var statusErrorMessage: String?

    private let audioManager = AudioCaptureManager()
    private let sherpaEngine = SherpaSenseVoiceEngine()
    private var syncClient: CloudSyncClient
    private var currentSessionId: String?
    private var nextSeq: Int = 1

    public init() {
        let initialURL = URL(string: "https://presales.88886666.site")!
        self.syncClient = CloudSyncClient(baseHTTPURL: initialURL)
        wireCallbacks()
        loadLocalModel()
        Task { await refreshGroups() }
    }

    public var currentStage: StageCode {
        checkpoint?.currentStage ?? .S0
    }

    public var activeGroupName: String {
        groups.first(where: { $0.id == selectedGroupId })?.name ?? "未选择客户分组"
    }

    public func loadLocalModel() {
        modelStatus = sherpaEngine.loadModel()
    }

    public func updateCloudURL(_ urlString: String) {
        guard let url = URL(string: urlString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            statusErrorMessage = "云端服务地址格式无效"
            return
        }
        cloudBaseURLString = url.absoluteString
        syncClient.baseHTTPURL = url
        if let gid = selectedGroupId, !offlineMode {
            syncClient.connect(groupId: gid)
        }
        Task { await refreshGroups() }
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
            statusErrorMessage = "无法拉取客户分组：\(error.localizedDescription)"
        }
    }

    public func createGroup(name: String, company: String, industry: String) async {
        do {
            let (group, cp) = try await syncClient.createGroup(name: name, company: company, industry: industry)
            groups.insert(group, at: 0)
            selectedGroupId = group.id
            checkpoint = cp
            segments = []
            latestCard = nil
            nextSeq = 1
            syncClient.connect(groupId: group.id)
        } catch {
            statusErrorMessage = "创建客户分组失败：\(error.localizedDescription)"
        }
    }

    public func selectGroup(_ groupId: String) {
        selectedGroupId = groupId
        latestSummary = nil
        syncClient.connect(groupId: groupId)
        Task { await refreshPendingCount() }
    }

    public func startOrResumeRecording() {
        guard let groupId = selectedGroupId else {
            statusErrorMessage = "请先选择或新建客户分组"
            return
        }
        do {
            let recordingsDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
                .appendingPathComponent("PreSalesCopilot/recordings/\(groupId)", isDirectory: true)
            try audioManager.startRecording(
                retainLocalAudioFile: retainLocalAudioFile,
                localRecordingsDirectory: recordingsDir
            )
            let action = isPaused ? "resume" : "start"
            if currentSessionId == nil {
                currentSessionId = "ses_\(UUID().uuidString.prefix(10))"
            }
            isRecording = true
            isPaused = false
            Task {
                _ = try? await syncClient.sendSessionControl(groupId: groupId, sessionId: currentSessionId, action: action)
            }
        } catch {
            statusErrorMessage = error.localizedDescription
        }
    }

    public func pauseRecording() {
        audioManager.pauseRecording()
        isRecording = false
        isPaused = true
        if let groupId = selectedGroupId {
            Task {
                _ = try? await syncClient.sendSessionControl(groupId: groupId, sessionId: currentSessionId, action: "pause")
            }
        }
    }

    public func endSession() {
        audioManager.stopRecording()
        isRecording = false
        isPaused = false
        guard let groupId = selectedGroupId else { return }
        let sid = currentSessionId
        currentSessionId = nil
        Task {
            do {
                if let summary = try await syncClient.sendSessionControl(groupId: groupId, sessionId: sid, action: "end") {
                    latestSummary = summary
                    showSummarySheet = true
                }
            } catch {
                statusErrorMessage = "生成结构化纪要失败：\(error.localizedDescription)"
            }
        }
    }

    public func deleteLastLocalRecording() {
        do {
            try audioManager.deleteLastLocalRecording()
        } catch {
            statusErrorMessage = "删除本地录音失败：\(error.localizedDescription)"
        }
    }

    /// Manual text submission or fallback when testing without microphone
    public func submitTranscriptText(_ text: String, startedAt: Int64? = nil, endedAt: Int64? = nil) {
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

        // Immediately reflect locally in left pane
        let localSeg = TranscriptSegment(
            id: outgoing.segmentId,
            groupId: groupId,
            sessionId: sid,
            seq: seq,
            text: trimmed,
            originalText: nil,
            edited: false,
            speakerLabel: nil,
            startedAt: outgoing.startedAt,
            endedAt: outgoing.endedAt,
            isFinal: true,
            createdAt: now
        )
        segments.append(localSeg)

        Task {
            await syncClient.sendSegment(outgoing)
            await refreshPendingCount()
        }
    }

    public func editSegment(segmentId: String, newText: String) {
        guard let groupId = selectedGroupId else { return }
        if let idx = segments.firstIndex(where: { $0.id == segmentId }) {
            segments[idx].text = newText
            segments[idx].edited = true
        }
        Task {
            try? await syncClient.editSegment(groupId: groupId, segmentId: segmentId, newText: newText)
        }
    }

    private func refreshPendingCount() async {
        pendingQueueCount = await syncClient.pendingQueue.count(forGroup: selectedGroupId)
    }

    private func wireCallbacks() {
        audioManager.onAudioLevel = { [weak self] rms in
            Task { @MainActor in
                self?.audioLevel = min(1.0, rms * 10.0)
            }
        }

        // 100% On-device transcription pipeline: AVAudioEngine -> VADChunker -> Sherpa-ONNX -> Pure Text -> CloudSyncClient
        audioManager.onSpeechChunk = { [weak self] chunk in
            guard let self else { return }
            Task {
                if let text = await self.sherpaEngine.transcribe(samples: chunk.samples, sampleRate: 16_000) {
                    await MainActor.run {
                        self.submitTranscriptText(text, startedAt: chunk.startedAtMs, endedAt: chunk.endedAtMs)
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
                self?.segments = segs
                self?.latestCard = card
                self?.nextSeq = max(group.nextExpectedSeq, (segs.last?.seq ?? 0) + 1)
                await self?.refreshPendingCount()
            }
        }

        syncClient.onQuestionCard = { [weak self] card in
            Task { @MainActor in
                self?.latestCard = card
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
                self?.statusErrorMessage = msg
            }
        }
    }
}
