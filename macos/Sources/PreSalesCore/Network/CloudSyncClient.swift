import Foundation

public enum CloudConnectionState: Equatable, Sendable {
    case disconnected
    case connecting
    case connected
    case offlineConfidential
}

/// Manages WebSocket streaming + HTTP catch-up with the Next.js + Mastra Cloud Agent Service.
/// Matches the Omarchy client contract:
/// - Silently uploads local transcribed text with `autoAnalyze: false` by default
/// - Fetches concise short prompts on demand via WS `request_hint` (with HTTP `/analyze` fallback)
/// Privacy guarantee: Only UTF-8 transcript text and JSON control messages are ever transmitted.
public final class CloudSyncClient: @unchecked Sendable {
    public var baseHTTPURL: URL
    public var onConnectionStateChanged: ((CloudConnectionState) -> Void)?
    public var onSnapshot: ((CustomerGroup, GroupCheckpoint, [TranscriptSegment], QuestionCard?, [Int]) -> Void)?
    public var onQuestionCard: ((QuestionCard) -> Void)?
    public var onStageUpdated: ((StageCode, StageCode, GroupCheckpoint) -> Void)?
    public var onSessionSummary: ((MeetingSummary) -> Void)?
    public var onSegmentAck: ((String, [Int], [Int], Int) -> Void)?
    public var onError: ((String) -> Void)?

    public private(set) var connectionState: CloudConnectionState = .disconnected {
        didSet { onConnectionStateChanged?(connectionState) }
    }

    public var isOfflineMode: Bool = false {
        didSet {
            if isOfflineMode {
                disconnectInternal()
                connectionState = .offlineConfidential
            } else if let groupId = subscribedGroupId {
                connect(groupId: groupId)
            }
        }
    }

    public let pendingQueue: PendingQueueStore
    private let session: URLSession
    private var webSocketTask: URLSessionWebSocketTask?
    private var subscribedGroupId: String?
    private var reconnectAttempt = 0
    private var receiveTask: Task<Void, Never>?

    public init(baseHTTPURL: URL, pendingQueue: PendingQueueStore = PendingQueueStore()) {
        self.baseHTTPURL = baseHTTPURL
        self.pendingQueue = pendingQueue
        self.session = URLSession(configuration: .default)
    }

    private func makeWebSocketURL(groupId: String) -> URL {
        var comps = URLComponents(url: baseHTTPURL, resolvingAgainstBaseURL: false)!
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/ws"
        comps.queryItems = [
            URLQueryItem(name: "groupId", value: groupId),
            URLQueryItem(name: "clientId", value: "macos-\(Host.current().localizedName ?? "mac")")
        ]
        return comps.url!
    }

    public func connect(groupId: String) {
        subscribedGroupId = groupId
        guard !isOfflineMode else {
            connectionState = .offlineConfidential
            return
        }

        disconnectInternal()
        connectionState = .connecting

        let wsURL = makeWebSocketURL(groupId: groupId)
        let task = session.webSocketTask(with: wsURL)
        self.webSocketTask = task
        task.resume()
        connectionState = .connected
        reconnectAttempt = 0

        sendRawJSON(["type": "subscribe", "groupId": groupId])
        startReceiveLoop(task: task)

        Task {
            await flushPendingQueue(groupId: groupId, triggerAnalyze: false)
        }
    }

    public func disconnect() {
        subscribedGroupId = nil
        disconnectInternal()
        connectionState = isOfflineMode ? .offlineConfidential : .disconnected
    }

    private func disconnectInternal() {
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    /// Sends a transcribed text segment (pure text only).
    /// Defaults to `autoAnalyze = false` to mirror Omarchy's silent capture & on-demand hint UX.
    public func sendSegment(_ segment: OutgoingSegmentPayload, autoAnalyze: Bool = false) async {
        await pendingQueue.enqueue(segment)
        guard !isOfflineMode else { return }

        if connectionState == .connected, webSocketTask != nil {
            let payload: [String: Any] = [
                "type": "segment",
                "groupId": segment.groupId,
                "segmentId": segment.segmentId,
                "sessionId": segment.sessionId,
                "seq": segment.seq,
                "text": segment.text,
                "startedAt": segment.startedAt,
                "endedAt": segment.endedAt,
                "isFinal": segment.isFinal,
                "autoAnalyze": autoAnalyze
            ]
            sendRawJSON(payload)
        } else {
            await flushPendingQueue(groupId: segment.groupId, triggerAnalyze: autoAnalyze)
        }
    }

    /// Triggers an on-demand concise question hint from the cloud V3.0 FDE Agent.
    /// Uses WebSocket `request_hint` when connected, falling back to HTTP `POST /api/groups/:id/analyze`.
    public func requestHint(groupId: String, sessionId: String?) async throws -> (QuestionCard?, GroupCheckpoint?) {
        guard !isOfflineMode else { return (nil, nil) }

        if connectionState == .connected, webSocketTask != nil {
            var frame: [String: Any] = [
                "type": "request_hint",
                "groupId": groupId
            ]
            if let sessionId, !sessionId.isEmpty {
                frame["sessionId"] = sessionId
            }
            sendRawJSON(frame)
            return (nil, nil)
        }

        let url = baseHTTPURL.appendingPathComponent("api/groups/\(groupId)/analyze")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [:]
        if let sessionId, !sessionId.isEmpty {
            body["sessionId"] = sessionId
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        struct AnalyzeResp: Decodable {
            let card: QuestionCard?
            let checkpoint: GroupCheckpoint?
        }
        let decoded = try JSONDecoder().decode(AnalyzeResp.self, from: data)
        if let card = decoded.card {
            onQuestionCard?(card)
        }
        if let cp = decoded.checkpoint {
            onStageUpdated?(cp.currentStage, cp.currentStage, cp)
        }
        return (decoded.card, decoded.checkpoint)
    }

    /// HTTP catch-up upload of all queued offline/disconnected text segments.
    public func flushPendingQueue(groupId: String, triggerAnalyze: Bool = false) async {
        guard !isOfflineMode else { return }
        let pending = await pendingQueue.allItems(forGroup: groupId)
        guard !pending.isEmpty else { return }

        let url = baseHTTPURL.appendingPathComponent("api/groups/\(groupId)/segments")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct BatchBody: Encodable {
            let segments: [OutgoingSegmentPayload]
            let triggerAnalyze: Bool
        }

        do {
            req.httpBody = try JSONEncoder().encode(BatchBody(segments: pending, triggerAnalyze: triggerAnalyze))
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return
            }

            struct IngestResp: Decodable {
                struct IngestInfo: Decodable {
                    let acceptedSeqs: [Int]
                    let duplicateSeqs: [Int]
                    let bufferedSeqs: [Int]
                    let nextExpectedSeq: Int
                }
                let ingest: IngestInfo
                let card: QuestionCard?
            }

            if let decoded = try? JSONDecoder().decode(IngestResp.self, from: data) {
                let acked = decoded.ingest.acceptedSeqs + decoded.ingest.duplicateSeqs + decoded.ingest.bufferedSeqs
                await pendingQueue.markAcked(groupId: groupId, seqs: acked)
                onSegmentAck?(groupId, decoded.ingest.acceptedSeqs, decoded.ingest.bufferedSeqs, decoded.ingest.nextExpectedSeq)
                if let card = decoded.card {
                    onQuestionCard?(card)
                }
            }
        } catch {
            // Keep items in pending queue for next retry
        }
    }

    // MARK: - REST Helpers

    public func fetchHealth() async -> CloudHealthInfo? {
        guard !isOfflineMode else { return nil }
        let url = baseHTTPURL.appendingPathComponent("api/health")
        guard let (data, resp) = try? await session.data(from: url),
              let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return nil
        }
        return try? JSONDecoder().decode(CloudHealthInfo.self, from: data)
    }

    public func fetchGroups() async throws -> [CustomerGroup] {
        let url = baseHTTPURL.appendingPathComponent("api/groups")
        let (data, _) = try await session.data(from: url)
        struct Resp: Decodable { let groups: [CustomerGroup] }
        return try JSONDecoder().decode(Resp.self, from: data).groups
    }

    public func createGroup(name: String, company: String, industry: String) async throws -> (CustomerGroup, GroupCheckpoint) {
        let url = baseHTTPURL.appendingPathComponent("api/groups")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": name,
            "customerCompany": company,
            "industry": industry
        ])
        let (data, _) = try await session.data(for: req)
        struct Resp: Decodable {
            let group: CustomerGroup
            let checkpoint: GroupCheckpoint
        }
        let decoded = try JSONDecoder().decode(Resp.self, from: data)
        return (decoded.group, decoded.checkpoint)
    }

    public func sendSessionControl(groupId: String, sessionId: String?, action: String) async throws -> MeetingSummary? {
        guard !isOfflineMode else { return nil }
        let url = baseHTTPURL.appendingPathComponent("api/groups/\(groupId)/sessions")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["action": action, "generateSummaryOnEnd": true]
        if let sessionId { body["sessionId"] = sessionId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await session.data(for: req)
        struct Resp: Decodable { let summary: MeetingSummary? }
        let decoded = try JSONDecoder().decode(Resp.self, from: data)
        if let summary = decoded.summary {
            onSessionSummary?(summary)
        }
        return decoded.summary
    }

    // MARK: - Internal WS Loop

    private func sendRawJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else { return }
        webSocketTask?.send(.string(text)) { [weak self] error in
            if error != nil {
                self?.scheduleReconnect()
            }
        }
    }

    private func startReceiveLoop(task: URLSessionWebSocketTask) {
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        await self?.handleIncomingFrame(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            await self?.handleIncomingFrame(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    self?.scheduleReconnect()
                    break
                }
            }
        }
    }

    private func handleIncomingFrame(_ text: String) async {
        guard let data = text.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(ServerWsEnvelope.self, from: data) else {
            return
        }

        switch envelope.type {
        case "snapshot":
            if let group = envelope.group, let cp = envelope.checkpoint {
                onSnapshot?(group, cp, envelope.segments ?? [], envelope.latestCard, envelope.bufferedSeqs ?? [])
            }
        case "segment_ack":
            if let groupId = subscribedGroupId {
                let accepted = envelope.acceptedSeqs ?? []
                let buffered = envelope.bufferedSeqs ?? []
                await pendingQueue.markAcked(groupId: groupId, seqs: accepted + buffered)
                onSegmentAck?(groupId, accepted, buffered, envelope.nextExpectedSeq ?? 1)
            }
        case "question_card":
            if let card = envelope.card {
                onQuestionCard?(card)
            }
        case "stage_updated":
            if let prev = envelope.previousStage, let curr = envelope.currentStage, let cp = envelope.checkpoint {
                onStageUpdated?(prev, curr, cp)
            }
        case "session_summary":
            if let summary = envelope.summary {
                onSessionSummary?(summary)
            }
        case "error":
            if let msg = envelope.message {
                onError?(msg)
            }
        default:
            break
        }
    }

    private func scheduleReconnect() {
        guard !isOfflineMode, let groupId = subscribedGroupId else { return }
        connectionState = .disconnected
        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt - 1)), 15.0)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            if !self.isOfflineMode, self.subscribedGroupId == groupId {
                self.connect(groupId: groupId)
            }
        }
    }
}
