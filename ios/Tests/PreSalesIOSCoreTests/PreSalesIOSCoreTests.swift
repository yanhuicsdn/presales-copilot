import XCTest
@testable import PreSalesIOSCore

final class PreSalesIOSCoreTests: XCTestCase {
    func testVADChunkerEmitsSpeechAfterSilence() {
        let chunker = VADChunker(config: .init(
            sampleRate: 16_000,
            energyThreshold: 0.01,
            silenceFlushSeconds: 0.5,
            maxChunkSeconds: 4.0,
            minSpeechSeconds: 0.4
        ))

        let speech = [Float](repeating: 0.15, count: 8_000)
        XCTAssertNil(chunker.append(samples: speech, nowMs: 1_000))

        let silence = [Float](repeating: 0.0001, count: 8_000)
        let chunk = chunker.append(samples: silence, nowMs: 1_500)
        XCTAssertNotNil(chunk)
        XCTAssertEqual(chunk?.samples.count, 16_000)
    }

    func testPendingQueuePersistsAndAcksInOrder() async {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("ios_queue_test_\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }

        let store = PendingQueueStore(storageURL: tmp)
        await store.enqueue(OutgoingSegmentPayload(
            groupId: "grp_ios",
            sessionId: "ses_1",
            seq: 2,
            text: "第二句",
            startedAt: 2000,
            endedAt: 2500
        ))
        await store.enqueue(OutgoingSegmentPayload(
            groupId: "grp_ios",
            sessionId: "ses_1",
            seq: 1,
            text: "第一句",
            startedAt: 1000,
            endedAt: 1500
        ))

        let ordered = await store.allItems(forGroup: "grp_ios")
        XCTAssertEqual(ordered.map(\.seq), [1, 2])

        let reloaded = PendingQueueStore(storageURL: tmp)
        let cnt = await reloaded.count(forGroup: "grp_ios")
        XCTAssertEqual(cnt, 2)

        await reloaded.markAcked(groupId: "grp_ios", seqs: [1])
        let remaining = await reloaded.allItems(forGroup: "grp_ios")
        XCTAssertEqual(remaining.map(\.seq), [2])
    }

    func testDeltaExtractionForStreamingOnDeviceSpeech() {
        XCTAssertEqual(
            OnDeviceSpeechEngine.extractDelta(fullText: "你好世界。我们合同审核很慢。", committed: "你好世界。"),
            "我们合同审核很慢。"
        )
        XCTAssertEqual(
            OnDeviceSpeechEngine.extractDelta(fullText: "全新一句话", committed: ""),
            "全新一句话"
        )
    }

    func testServerEnvelopeDecodesCloudQuestionCard() throws {
        let json = """
        {
          "type": "question_card",
          "card": {
            "id": "card_ios_1",
            "groupId": "grp_ios",
            "sessionId": "ses_1",
            "stage": "S1",
            "previousStage": "S0",
            "primaryQuestion": "先不说解决方案，先说您的业务痛点是什么？",
            "alternativeQuestions": ["备选1", "备选2", "备选3"],
            "riskTags": [{"code": "SOLUTION_FIRST_RISK", "label": "方案先行风险", "level": "high", "reason": "提前谈技术"}],
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
            "latencyMs": 120,
            "providerMode": "deepseek",
            "createdAt": 1730000000000
          }
        }
        """
        let envelope = try JSONDecoder().decode(ServerWsEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(envelope.type, "question_card")
        XCTAssertEqual(envelope.card?.stage, .S1)
        XCTAssertEqual(envelope.card?.providerMode, "deepseek")
        XCTAssertEqual(envelope.card?.alternativeQuestions.count, 3)
    }
}
