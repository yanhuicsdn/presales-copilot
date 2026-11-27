import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PresalesDatabase, setDbForTesting } from '@/lib/db';
import { ingestOrderedSegments } from '@/lib/sequence-manager';
import { resetMastraForTesting, runPresalesAnalysis, runSessionSummary } from '@/mastra';
import { STAGE_ORDER } from '@/lib/skills';

describe('Mastra Workflows: Full S0->S5 State Machine, Cross-Session Resume & Summary', () => {
  let tmpDir: string;
  let dbFile: string;
  let mastraDbFile: string;
  let db: PresalesDatabase;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presales-mastra-test-'));
    dbFile = `file:${path.join(tmpDir, 'app.db')}`;
    mastraDbFile = `file:${path.join(tmpDir, 'mastra.db')}`;
    process.env.MASTRA_DATABASE_URL = mastraDbFile;
    delete process.env.DEEPSEEK_API_KEY;

    resetMastraForTesting();
    db = new PresalesDatabase(dbFile);
    await db.init();
    setDbForTesting(db);
  });

  afterEach(async () => {
    await db.close();
    setDbForTesting(null);
    resetMastraForTesting();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('progresses strictly S0->S1->S2->S3->S4->S5 without skipping, resumes across restart, and builds summary', async () => {
    const { group } = await db.createGroup({
      name: '某政务服务中心项目',
      customerCompany: '某市政务局',
      industry: '政务信息化',
    });

    const stageHistory: string[] = ['S0'];
    let seq = 1;

    const sendTurn = async (sessionId: string, text: string) => {
      await ingestOrderedSegments(db, group.id, [{ sessionId, seq: seq++, text }]);
      const res = await runPresalesAnalysis({ groupId: group.id, sessionId, triggerSeq: seq - 1 });
      expect(res.card.validation.passed).toBe(true);
      expect(res.card.alternativeQuestions.length).toBeGreaterThanOrEqual(2);
      expect(res.card.alternativeQuestions.length).toBeLessThanOrEqual(4);
      expect(res.card.latencyMs).toBeLessThan(3000);
      const prevIdx = STAGE_ORDER.indexOf(res.previousStage);
      const currIdx = STAGE_ORDER.indexOf(res.currentStage);
      // Strict invariant: never skip a stage!
      expect(currIdx - prevIdx).toBeGreaterThanOrEqual(0);
      expect(currIdx - prevIdx).toBeLessThanOrEqual(1);
      if (res.stageChanged) stageHistory.push(res.currentStage);
      return res;
    };

    // Turn 1 (S0 -> S1): Opening intro
    const t1 = await sendTurn('ses_day1', '你好，我们是政务大厅合同与材料审核科室，平时窗口受理压力非常大。');
    expect(t1.currentStage).toBe('S1');

    // Turn 2 (stays S1): Customer jumps ahead to LLM/RAG -> must trigger interrupt_solution_first!
    const t2 = await sendTurn('ses_day1', '我们想直接私有化部署 DeepSeek 大模型加 RAG，你们需要几台 GPU 服务器？');
    expect(t2.currentStage).toBe('S1');
    expect(t2.card.matchedSkills).toContain('interrupt_solution_first');
    expect(t2.card.riskTags.some((r) => r.code === 'SOLUTION_FIRST_RISK')).toBe(true);

    // Turn 3 (S1 -> S2): Concrete scene + clear pain point
    const t3 = await sendTurn(
      'ses_day1',
      '具体操作是办事员每天上传 PDF 合同和申请表格到审批系统，点人工逐条比对条款，期望 5 分钟查出漏项，实际要花 2 小时人工核对且经常漏审。'
    );
    expect(t3.currentStage).toBe('S2');
    expect(t3.checkpoint.painPoints.length).toBeGreaterThanOrEqual(1);

    // --- Simulate recording interruption & cloud/app restart (Cross-session resume!) ---
    await db.close();
    resetMastraForTesting();
    db = new PresalesDatabase(dbFile);
    await db.init();
    setDbForTesting(db);

    const restoredCheckpoint = await db.getCheckpoint(group.id);
    expect(restoredCheckpoint?.currentStage).toBe('S2');
    expect(restoredCheckpoint?.painPoints.length).toBeGreaterThanOrEqual(1);

    // Turn 4 (S2 -> S3 in new session ses_day2): Identify root cause (system + process)
    const t4 = await sendTurn(
      'ses_day2',
      '主要是现有老系统功能做不到自动条款比对，系统不支持结构化提取，而且跨部门审批流程规范也没统一。'
    );
    expect(t4.currentStage).toBe('S3');

    // Turn 5 (stays S3): Only partial boundaries provided -> must remain in S3!
    const t5 = await sendTurn('ses_day2', '数据目前存在本地机房政务云里，网络是纯内网物理隔离。');
    expect(t5.currentStage).toBe('S3');
    expect(t5.card.matchedSkills).toContain('boundary_constraints_confirm');

    // Turn 6 (S3 -> S4): Remaining 3 boundaries provided -> advances to S4!
    const t6 = await sendTurn(
      'ses_day2',
      '存量大概 30 万份历史文档，一线审批员都在 PC端浏览器使用，属于涉密数据必须等保三级不可出域。'
    );
    expect(t6.currentStage).toBe('S4');
    expect(t6.checkpoint.boundaries.dataLocation).toBeTruthy();
    expect(t6.checkpoint.boundaries.networkType).toBeTruthy();
    expect(t6.checkpoint.boundaries.dataVolume).toBeTruthy();
    expect(t6.checkpoint.boundaries.terminalType).toBeTruthy();
    expect(t6.checkpoint.boundaries.confidentiality).toBeTruthy();

    // Turn 7 (S4 -> S5): Customer confirms pain point priority -> advances to S5!
    const t7 = await sendTurn(
      'ses_day2',
      '同意，合同人工审核耗时易漏排第一 P0 优先解决，接下来可以聊聊整体解决思路了。'
    );
    expect(t7.currentStage).toBe('S5');

    // Verify full ordered progression S0 -> S1 -> S2 -> S3 -> S4 -> S5 with zero jumps
    expect(stageHistory).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);

    // Turn 8 (in S5): Tech concept translation triggered
    const t8 = await sendTurn('ses_day2', '听不太懂大模型和工作流引擎到底是什么原理区别？');
    expect(t8.currentStage).toBe('S5');
    expect(t8.card.matchedSkills).toContain('tech_concept_translation');

    // End session: generate structured summary via Mastra summaryWorkflow
    const summary = await runSessionSummary({ groupId: group.id, sessionId: 'ses_day2' });
    expect(summary.minutes).toContain('S5');
    expect(summary.painPoints.length).toBeGreaterThanOrEqual(1);
    expect(summary.confirmedBoundaries.networkType).toBeTruthy();
    expect(summary.nextActions.length).toBeGreaterThanOrEqual(2);
    expect(summary.markdown).toContain('# 售前沟通纪要');
    expect(summary.markdown).toContain('## 三、已确认边界约束');
  });
});
