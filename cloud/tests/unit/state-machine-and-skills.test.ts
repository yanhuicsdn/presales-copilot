import { describe, expect, it } from 'vitest';
import {
  areAllBoundariesConfirmed,
  getMissingBoundaries,
  isSkillAllowedInStage,
  isValidStageTransition,
  NINE_SKILLS,
  SEVEN_COMMUNICATION_PRINCIPLES,
  STAGE_DEFINITIONS,
  STAGE_ORDER,
} from '@/lib/skills';
import {
  deterministicAnalyze,
  deterministicGenerateQuestions,
  routeStrategy,
  validateQuestionCardCandidate,
} from '@/lib/deterministic-engine';
import { createInitialCheckpoint } from '@/lib/db';
import type { BoundaryConstraints, TranscriptSegment } from '@/lib/types';

function makeSeg(seq: number, text: string): TranscriptSegment {
  return {
    id: `seg_${seq}`,
    groupId: 'grp_test',
    sessionId: 'ses_1',
    seq,
    text,
    originalText: null,
    edited: false,
    speakerLabel: null,
    startedAt: Date.now(),
    endedAt: Date.now(),
    isFinal: true,
    createdAt: Date.now(),
  };
}

describe('Methodology V3.0: 10 FDE Principles, 12 Skills & S0-S5 State Machine', () => {
  it('defines all 10 FDE principles, 12 skills, and 6 ordered stages S0-S5', () => {
    expect(SEVEN_COMMUNICATION_PRINCIPLES).toHaveLength(10);
    expect(NINE_SKILLS).toHaveLength(12);
    expect(STAGE_ORDER).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);
    for (const stage of STAGE_ORDER) {
      expect(STAGE_DEFINITIONS[stage].allowedSkills.length).toBeGreaterThan(0);
    }
  });

  it('enforces strict S0->S5 ordered progression with zero stage skipping', () => {
    expect(isValidStageTransition('S0', 'S0')).toBe(true);
    expect(isValidStageTransition('S0', 'S1')).toBe(true);
    expect(isValidStageTransition('S0', 'S2')).toBe(false);
    expect(isValidStageTransition('S1', 'S3')).toBe(false);
    expect(isValidStageTransition('S1', 'S5')).toBe(false);
    expect(isValidStageTransition('S3', 'S4')).toBe(true);
    expect(isValidStageTransition('S4', 'S5')).toBe(true);
    expect(isValidStageTransition('S4', 'S2')).toBe(false);
  });

  it('triggers interrupt_solution_first when customer talks about LLM/RAG in S1', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S1' as const };
    const segs = [makeSeg(1, '我们想直接上 DeepSeek 大模型加 RAG 向量数据库，你们报价多少？')];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.offTopic).toBe(true);

    const routed = routeStrategy('S1', analysis, cp.boundaries);
    expect(routed.nextStage).toBe('S1'); // Must NOT advance when off-topic
    expect(routed.matchedSkills).toContain('interrupt_solution_first');
  });

  it('triggers vague_demand_redirect on grand abstract requests in S1', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S1' as const };
    const segs = [makeSeg(1, '领导要求我们做一个企业大脑，实现全公司赋能和全面智能化。')];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.vagueGrandDemand).toBe(true);

    const routed = routeStrategy('S1', analysis, cp.boundaries);
    expect(routed.nextStage).toBe('S1');
    expect(routed.matchedSkills).toContain('vague_demand_redirect');
  });

  it('triggers scene_restoration_probe on abstract feedback ("不好用/很乱")', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S1' as const };
    const segs = [makeSeg(1, '现在系统特别不好用，东西很乱，效率低。')];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.abstractness).toBe('high');

    const routed = routeStrategy('S1', analysis, cp.boundaries);
    expect(routed.nextStage).toBe('S1');
    expect(routed.matchedSkills).toContain('scene_restoration_probe');
  });

  it('detects intranet vs mobile contradiction and triggers paraphrase_loop_confirm in S2', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S2' as const };
    const segs = [
      makeSeg(1, '我们所有业务数据都在纯内网物理隔离，绝对不能连外网。'),
      makeSeg(2, '不过销售希望在外勤的时候能用手机随时查外网访问这些文档。'),
    ];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.contradiction).toBe(true);

    const routed = routeStrategy('S2', analysis, cp.boundaries);
    expect(routed.nextStage).toBe('S2');
    expect(routed.matchedSkills).toContain('paraphrase_loop_confirm');
  });

  it('checks all 5 boundary constraints before leaving S3', () => {
    const partial: BoundaryConstraints = {
      dataLocation: '本地机房',
      networkType: '纯内网',
      dataVolume: null,
      terminalType: null,
      confidentiality: '涉密',
    };
    expect(areAllBoundariesConfirmed(partial)).toBe(false);
    expect(getMissingBoundaries(partial).map((m) => m.key)).toEqual(['dataVolume', 'terminalType']);

    const full: BoundaryConstraints = {
      dataLocation: '本地机房',
      networkType: '纯内网',
      dataVolume: '50万份',
      terminalType: 'PC端',
      confidentiality: '涉密',
    };
    expect(areAllBoundariesConfirmed(full)).toBe(true);
  });

  it('self-validator rejects stage skipping, premature solution pitching, and duplicate questions', () => {
    const emptyBoundaries = createInitialCheckpoint('grp_test').boundaries;

    const skipCheck = validateQuestionCardCandidate({
      previousStage: 'S1',
      nextStage: 'S3',
      primaryQuestion: '数据在哪？',
      alternativeQuestions: ['备选1', '备选2'],
      matchedSkills: ['boundary_constraints_confirm'],
      askedQuestions: [],
      boundaries: emptyBoundaries,
    });
    expect(skipCheck.passed).toBe(false);
    expect(skipCheck.stageViolation).toBe(true);

    const solutionCheck = validateQuestionCardCandidate({
      previousStage: 'S1',
      nextStage: 'S1',
      primaryQuestion: '推荐您用 DeepSeek 直接上RAG，报价大概50万。',
      alternativeQuestions: ['备选1', '备选2'],
      matchedSkills: ['scene_restoration_probe'],
      askedQuestions: [],
      boundaries: emptyBoundaries,
    });
    expect(solutionCheck.passed).toBe(false);
    expect(solutionCheck.riskRuleTriggered).toBe(true);

    const dupCheck = validateQuestionCardCandidate({
      previousStage: 'S1',
      nextStage: 'S1',
      primaryQuestion: '能否还原一次具体操作画面？',
      alternativeQuestions: ['备选1', '备选2'],
      matchedSkills: ['scene_restoration_probe'],
      askedQuestions: ['能否还原一次具体操作画面？'],
      boundaries: emptyBoundaries,
    });
    expect(dupCheck.passed).toBe(false);
    expect(dupCheck.duplicateDetected).toBe(true);
  });

  it('generates 1 primary + 2..4 alternative questions with only allowed skills', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S5' as const };
    const segs = [makeSeg(1, '听不懂大模型和RAG是什么原理区别？')];
    const analysis = deterministicAnalyze(segs, cp);
    const routed = routeStrategy('S5', analysis, cp.boundaries);
    for (const sk of routed.matchedSkills) {
      expect(isSkillAllowedInStage(sk, routed.nextStage)).toBe(true);
    }
    const gen = deterministicGenerateQuestions(
      routed.nextStage,
      routed.matchedSkills,
      analysis,
      cp,
      cp.boundaries
    );
    expect(gen.primaryQuestion.length).toBeGreaterThan(10);
    expect(gen.alternativeQuestions.length).toBeGreaterThanOrEqual(2);
    expect(gen.alternativeQuestions.length).toBeLessThanOrEqual(4);
    expect(gen.primaryQuestion).toContain('发动机');
  });

  it('triggers ai_vs_engineering_triage on routine diff/timeout or single-turn OCR problems in S2', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S2' as const };
    const segs = [
      makeSeg(1, '资产滚动盘点总是重复推送没有变化的数据，接口还经常60秒超时。'),
    ];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.rootCauseIdentified).toBe('engineering');
    expect(analysis.needsEngineeringTriage).toBe(true);
    expect(analysis.extractedBoundaries.systemConstraints).toBeTruthy();

    // Even when root cause is identified, check triage routing in S2 or S5
    const cpS5 = { ...createInitialCheckpoint('grp_test'), currentStage: 'S5' as const };
    const routedS5 = routeStrategy('S5', analysis, cpS5.boundaries);
    expect(routedS5.matchedSkills).toContain('ai_vs_engineering_triage');
  });

  it('triggers honest_boundary_defer on messy ontology / cross-industry graph demands', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S4' as const };
    const segs = [
      makeSeg(1, '我们有18000条历史地址字段混乱，二栋几零几写法都不统一，还想顺便做产业图谱。'),
    ];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.needsHonestDefer).toBe(true);

    const routed = routeStrategy('S4', analysis, cp.boundaries);
    expect(routed.matchedSkills).toContain('honest_boundary_defer');
  });

  it('triggers prototype_and_sample_anchor when customer worries about rework or lack of training data', () => {
    const cp = { ...createInitialCheckpoint('grp_test'), currentStage: 'S3' as const };
    const segs = [
      makeSeg(1, '我们不想推倒重来，而且审计是一案一例没有训练数据，怎么验证效果？'),
    ];
    const analysis = deterministicAnalyze(segs, cp);
    expect(analysis.needsSampleAnchor).toBe(true);
    expect(analysis.extractedBoundaries.historicalDataStatus).toBeTruthy();

    const routed = routeStrategy('S3', analysis, cp.boundaries);
    expect(routed.matchedSkills).toContain('prototype_and_sample_anchor');
  });
});
