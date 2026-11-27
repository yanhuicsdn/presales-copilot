import Foundation

public enum StageCode: String, Codable, CaseIterable, Sendable {
    case S0, S1, S2, S3, S4, S5

    public var displayName: String {
        switch self {
        case .S0: return "破冰开场"
        case .S1: return "痛点挖掘"
        case .S2: return "根因分析"
        case .S3: return "边界确认"
        case .S4: return "痛点收敛"
        case .S5: return "方案探讨"
        }
    }

    public var orderIndex: Int {
        switch self {
        case .S0: return 0
        case .S1: return 1
        case .S2: return 2
        case .S3: return 3
        case .S4: return 4
        case .S5: return 5
        }
    }
}

public enum RiskLevel: String, Codable, Sendable {
    case low
    case medium
    case high
}

public struct RiskTag: Codable, Identifiable, Equatable, Sendable {
    public var id: String { code }
    public let code: String
    public let label: String
    public let level: RiskLevel
    public let reason: String
}

public struct BoundaryConstraints: Codable, Equatable, Sendable {
    public var dataLocation: String?
    public var networkType: String?
    public var dataVolume: String?
    public var terminalType: String?
    public var confidentiality: String?

    public init(
        dataLocation: String? = nil,
        networkType: String? = nil,
        dataVolume: String? = nil,
        terminalType: String? = nil,
        confidentiality: String? = nil
    ) {
        self.dataLocation = dataLocation
        self.networkType = networkType
        self.dataVolume = dataVolume
        self.terminalType = terminalType
        self.confidentiality = confidentiality
    }
}

public struct PainPointItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let description: String
    public let rootCauseCategory: String
    public let priority: Int?
    public let confirmed: Bool
}

public struct GroupCheckpoint: Codable, Equatable, Sendable {
    public let groupId: String
    public let currentStage: StageCode
    public let stageGoalProgress: Int
    public let painPoints: [PainPointItem]
    public let boundaries: BoundaryConstraints
    public let confirmedItems: [String]
    public let unconfirmedItems: [String]
    public let askedQuestions: [String]
    public let rollingSummary: String
    public let lastAnalyzedSeq: Int
    public let updatedAt: Int64
    public let version: Int
}

public struct CustomerGroup: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let customerCompany: String
    public let industry: String
    public let notes: String
    public let status: String
    public let nextExpectedSeq: Int
    public let createdAt: Int64
    public let updatedAt: Int64
    public let stage: String?
    public let segmentCount: Int?
}

public struct TranscriptSegment: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let groupId: String
    public let sessionId: String
    public let seq: Int
    public var text: String
    public let originalText: String?
    public var edited: Bool
    public let speakerLabel: String?
    public let startedAt: Int64
    public let endedAt: Int64
    public let isFinal: Bool
    public let createdAt: Int64

    public init(
        id: String,
        groupId: String,
        sessionId: String,
        seq: Int,
        text: String,
        originalText: String? = nil,
        edited: Bool = false,
        speakerLabel: String? = nil,
        startedAt: Int64,
        endedAt: Int64,
        isFinal: Bool = true,
        createdAt: Int64
    ) {
        self.id = id
        self.groupId = groupId
        self.sessionId = sessionId
        self.seq = seq
        self.text = text
        self.originalText = originalText
        self.edited = edited
        self.speakerLabel = speakerLabel
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.isFinal = isFinal
        self.createdAt = createdAt
    }
}

public struct OutgoingSegmentPayload: Codable, Equatable, Identifiable, Sendable {
    public var id: String { "\(groupId)#\(seq)" }
    public let groupId: String
    public let segmentId: String
    public let sessionId: String
    public let seq: Int
    public let text: String
    public let startedAt: Int64
    public let endedAt: Int64
    public let isFinal: Bool

    public init(
        groupId: String,
        segmentId: String = "seg_\(UUID().uuidString.prefix(10))",
        sessionId: String,
        seq: Int,
        text: String,
        startedAt: Int64,
        endedAt: Int64,
        isFinal: Bool = true
    ) {
        self.groupId = groupId
        self.segmentId = segmentId
        self.sessionId = sessionId
        self.seq = seq
        self.text = text
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.isFinal = isFinal
    }
}

public struct SixDimensionAnalysis: Codable, Equatable, Sendable {
    public let offTopic: Bool
    public let offTopicReason: String?
    public let abstractness: String
    public let completeness: String
    public let contradiction: Bool
    public let contradictionDetail: String?
    public let emotion: String
    public let painPointClarity: Int
    public let stageGoalMet: Bool
}

public struct ValidationResult: Codable, Equatable, Sendable {
    public let passed: Bool
    public let attempts: Int
    public let issues: [String]
    public let stageViolation: Bool
    public let duplicateDetected: Bool
    public let riskRuleTriggered: Bool
}

public struct QuestionCard: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let groupId: String
    public let sessionId: String?
    public let stage: StageCode
    public let previousStage: StageCode
    public let primaryQuestion: String
    public let alternativeQuestions: [String]
    public let riskTags: [RiskTag]
    public let matchedSkills: [String]
    public let rationale: String
    public let analysis: SixDimensionAnalysis
    public let validation: ValidationResult
    public let triggerSeq: Int
    public let latencyMs: Int
    public let providerMode: String
    public let createdAt: Int64
}

public struct MeetingSummary: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let groupId: String
    public let sessionId: String?
    public let minutes: String
    public let painPoints: [PainPointItem]
    public let confirmedBoundaries: BoundaryConstraints
    public let unconfirmedItems: [String]
    public let nextActions: [String]
    public let markdown: String
    public let createdAt: Int64
}

// MARK: - WebSocket Envelopes (1:1 contract with Cloud Next.js Gateway)

public struct ServerWsEnvelope: Decodable {
    public let type: String
    public let group: CustomerGroup?
    public let checkpoint: GroupCheckpoint?
    public let segments: [TranscriptSegment]?
    public let latestCard: QuestionCard?
    public let card: QuestionCard?
    public let summary: MeetingSummary?
    public let bufferedSeqs: [Int]?
    public let acceptedSeqs: [Int]?
    public let nextExpectedSeq: Int?
    public let currentStage: StageCode?
    public let previousStage: StageCode?
    public let code: String?
    public let message: String?
}
