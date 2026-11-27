import XCTest
@testable import PreSalesCore

final class PreSalesCoreTests: XCTestCase {
    func testVADChunkerEmitsSpeechChunkAfterSilence() {
        let chunker = VADChunker(config: .init(
            sampleRate: 16_000,
            energyThreshold: 0.01,
            silenceFlushSeconds: 0.5,
            maxChunkSeconds: 4.0,
            minSpeechSeconds: 0.4
        ))

        // 0.5s loud speech
        let speech = [Float](repeating: 0.15, count: 8_000)
        XCTAssertNil(chunker.append(samples: speech, nowMs: 1_000))

        // 0.5s silence triggers chunk emission
        let silence = [Float](repeating: 0.0001, count: 8_000)
        let emitted = chunker.append(samples: silence, nowMs: 1_500)
        XCTAssertNotNil(emitted)
        XCTAssertEqual(emitted?.samples.count, 16_000)
    }

    func testPendingQueuePersistsAndAcksInOrder() async {
        let tmpFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("pending_queue_test_\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmpFile) }

        let store = PendingQueueStore(storageURL: tmpFile)
        await store.enqueue(OutgoingSegmentPayload(
            groupId: "grp_1",
            sessionId: "ses_1",
            seq: 2,
            text: "第二句",
            startedAt: 2000,
            endedAt: 2500
        ))
        await store.enqueue(OutgoingSegmentPayload(
            groupId: "grp_1",
            sessionId: "ses_1",
            seq: 1,
            text: "第一句",
            startedAt: 1000,
            endedAt: 1500
        ))

        let ordered = await store.allItems(forGroup: "grp_1")
        XCTAssertEqual(ordered.map(\.seq), [1, 2])

        // Re-open from disk to verify persistence across restarts
        let reloaded = PendingQueueStore(storageURL: tmpFile)
        let reloadedCount = await reloaded.count(forGroup: "grp_1")
        XCTAssertEqual(reloadedCount, 2)

        await reloaded.markAcked(groupId: "grp_1", seqs: [1])
        let remaining = await reloaded.allItems(forGroup: "grp_1")
        XCTAssertEqual(remaining.map(\.seq), [2])
    }

    func testServerEnvelopeDecodesCloudQuestionCard() throws {
        let json = """
        {
          "type": "question_card",
          "card": {
            "id": "card_123",
            "groupId": "grp_1",
            "sessionId": "ses_1",
            "stage": "S1",
            "previousStage": "S0",
            "primaryQuestion": "先不说解决方案，先说您的业务问题是什么？",
            "alternativeQuestions": ["备选1", "备选2", "备选3"],
            "riskTags": [{"code": "SOLUTION_FIRST_RISK", "label": "方案先行风险", "level": "high", "reason": "提前谈模型"}],
            "matchedSkills": ["interrupt_solution_first"],
            "rationale": "命中打断方案先行",
            "analysis": {
              "offTopic": true,
              "abstractness": "medium",
              "completeness": "low",
              "contradiction": false,
              "emotion": "neutral",
              "painPointClarity": 35,
              "stageGoalMet": false
            },
            "validation": {
              "passed": true,
              "attempts": 1,
              "issues": [],
              "stageViolation": false,
              "duplicateDetected": false,
              "riskRuleTriggered": false
            },
            "triggerSeq": 1,
            "latencyMs": 12,
            "providerMode": "deterministic",
            "createdAt": 1730000000000
          }
        }
        """
        let envelope = try JSONDecoder().decode(ServerWsEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(envelope.type, "question_card")
        XCTAssertEqual(envelope.card?.stage, .S1)
        XCTAssertEqual(envelope.card?.alternativeQuestions.count, 3)
    }
}
