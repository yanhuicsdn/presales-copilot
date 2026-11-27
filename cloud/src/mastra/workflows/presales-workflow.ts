import crypto from 'node:crypto';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  computeRiskTags,
  deterministicAnalyze,
  deterministicGenerateQuestions,
  mergeCheckpointState,
  routeStrategy,
  validateQuestionCardCandidate,
} from '@/lib/deterministic-engine';
import { isDeepSeekConfigured } from '@/lib/llm-provider';
import { SKILL_MAP, STAGE_DEFINITIONS } from '@/lib/skills';
import { assembleLayeredContext } from '@/lib/vector-recall';
import type {
  BoundaryConstraints,
  GroupCheckpoint,
  QuestionCard,
  SixDimensionAnalysis,
  SkillId,
  StageCode,
  TranscriptSegment,
  ValidationResult,
} from '@/lib/types';

const stageSchema = z.enum(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);

const skillIdSchema = z.enum([
  'interrupt_solution_first',
  'scene_restoration_probe',
  'root_cause_distinction',
  'ai_vs_engineering_triage',
  'boundary_constraints_confirm',
  'paraphrase_loop_confirm',
  'vague_demand_redirect',
  'pain_point_convergence',
  'honest_boundary_defer',
  'tech_concept_translation',
  'prototype_and_sample_anchor',
  'stage_progression_control',
]);

const rootCauseSchema = z.enum([
  'people',
  'system',
  'process',
  'engineering',
  'ai_architecture',
  'unknown',
]);

const analysisOutputSchema = z.object({
  offTopic: z.boolean(),
  offTopicReason: z.string().optional(),
  abstractness: z.enum(['low', 'medium', 'high']),
  completeness: z.enum(['low', 'medium', 'high']),
  contradiction: z.boolean(),
  contradictionDetail: z.string().optional(),
  emotion: z.enum(['positive', 'neutral', 'frustrated', 'skeptical', 'anxious']),
  painPointClarity: z.number().min(0).max(100),
  rootCauseIdentified: rootCauseSchema,
  vagueGrandDemand: z.boolean(),
  needsEngineeringTriage: z.boolean().optional(),
  needsHonestDefer: z.boolean().optional(),
  needsSampleAnchor: z.boolean().optional(),
  needsTechTranslation: z.boolean(),
  stageGoalMet: z.boolean(),
  customerAgreedToAdvance: z.boolean(),
  extractedPainPoints: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      rootCauseCategory: rootCauseSchema,
    })
  ),
  extractedBoundaries: z.object({
    dataLocation: z.string().nullable().optional(),
    networkType: z.string().nullable().optional(),
    dataVolume: z.string().nullable().optional(),
    terminalType: z.string().nullable().optional(),
    confidentiality: z.string().nullable().optional(),
    historicalDataStatus: z.string().nullable().optional(),
    systemConstraints: z.string().nullable().optional(),
  }),
  summaryDelta: z.string(),
});

const questionGenSchema = z.object({
  primaryQuestion: z.string().min(4),
  alternativeQuestions: z.array(z.string().min(4)).min(2).max(4),
});

// Step 1: Load Group Checkpoint & Layered Context Assembly (Section 3.3 Steps 2-3)
const loadContextStep = createStep({
  id: 'load-checkpoint-and-context',
  description: 'Load customer group checkpoint and assemble layered context (recent + rolling summary + vector recall + key slots)',
  inputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable().optional(),
    triggerSeq: z.number().int().min(0).optional(),
  }),
  outputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable(),
    triggerSeq: z.number(),
    startedAtMs: z.number(),
    checkpoint: z.any(),
    recentSegments: z.array(z.any()),
    recalledCount: z.number(),
    formattedPromptContext: z.string(),
  }),
  execute: async ({ inputData }) => {
    const startedAtMs = Date.now();
    const db = getDb();
    const group = await db.getGroup(inputData.groupId);
    if (!group) {
      throw new Error(`Customer group not found: ${inputData.groupId}`);
    }
    const checkpoint = await db.getCheckpoint(inputData.groupId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found for group: ${inputData.groupId}`);
    }
    const embeddedSegments = await db.getEmbeddedSegments(inputData.groupId);
    const layered = assembleLayeredContext(embeddedSegments, checkpoint, {
      recentWindowSize: 8,
      recallTopK: 4,
    });
    const latestSeq =
      inputData.triggerSeq ??
      (embeddedSegments.length > 0
        ? embeddedSegments[embeddedSegments.length - 1].segment.seq
        : checkpoint.lastAnalyzedSeq);

    return {
      groupId: inputData.groupId,
      sessionId: inputData.sessionId ?? null,
      triggerSeq: latestSeq,
      startedAtMs,
      checkpoint,
      recentSegments: layered.recentSegments,
      recalledCount: layered.recalledSegments.length,
      formattedPromptContext: layered.formattedPromptContext,
    };
  },
});

// Step 2: 6-Dimension Customer Answer Analysis (Section 3.3 Step 4)
const analyzeResponseStep = createStep({
  id: 'analyze-customer-response',
  description: 'Run 6-dimension analysis and stage goal completion evaluation via Mastra analyzerAgent (DeepSeek or deterministic fallback)',
  inputSchema: loadContextStep.outputSchema,
  outputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable(),
    triggerSeq: z.number(),
    startedAtMs: z.number(),
    checkpoint: z.any(),
    recentSegments: z.array(z.any()),
    formattedPromptContext: z.string(),
    analysis: z.any(),
    providerMode: z.enum(['deepseek', 'deterministic']),
  }),
  execute: async ({ inputData, mastra }) => {
    const checkpoint = inputData.checkpoint as GroupCheckpoint;
    const recentSegments = inputData.recentSegments as TranscriptSegment[];

    // Always compute baseline deterministic extraction for boundary safety
    const baseline = deterministicAnalyze(recentSegments, checkpoint);
    let finalAnalysis: SixDimensionAnalysis = baseline;
    let providerMode: 'deepseek' | 'deterministic' = 'deterministic';

    if (isDeepSeekConfigured() && recentSegments.length > 0) {
      try {
        const agent = mastra.getAgent('analyzerAgent');
        const prompt = `请对以下客户分组的现场沟通记录进行六维分析与阶段目标评估：

${inputData.formattedPromptContext}

请严格按 JSON Schema 返回分析结果。`;
        const response = await agent.generate(prompt, {
          structuredOutput: {
            schema: analysisOutputSchema,
          },
        });
        if (response.object) {
          const obj = response.object;
          finalAnalysis = {
            ...obj,
            needsEngineeringTriage: obj.needsEngineeringTriage ?? baseline.needsEngineeringTriage,
            needsHonestDefer: obj.needsHonestDefer ?? baseline.needsHonestDefer,
            needsSampleAnchor: obj.needsSampleAnchor ?? baseline.needsSampleAnchor,
            extractedBoundaries: {
              dataLocation: obj.extractedBoundaries.dataLocation ?? baseline.extractedBoundaries.dataLocation,
              networkType: obj.extractedBoundaries.networkType ?? baseline.extractedBoundaries.networkType,
              dataVolume: obj.extractedBoundaries.dataVolume ?? baseline.extractedBoundaries.dataVolume,
              terminalType: obj.extractedBoundaries.terminalType ?? baseline.extractedBoundaries.terminalType,
              confidentiality: obj.extractedBoundaries.confidentiality ?? baseline.extractedBoundaries.confidentiality,
              historicalDataStatus:
                obj.extractedBoundaries.historicalDataStatus ?? baseline.extractedBoundaries.historicalDataStatus,
              systemConstraints:
                obj.extractedBoundaries.systemConstraints ?? baseline.extractedBoundaries.systemConstraints,
            },
          };
          providerMode = 'deepseek';
        }
      } catch (err) {
        console.warn('[Mastra analyzerAgent] DeepSeek call failed, falling back to deterministic engine:', err);
      }
    }

    return {
      groupId: inputData.groupId,
      sessionId: inputData.sessionId,
      triggerSeq: inputData.triggerSeq,
      startedAtMs: inputData.startedAtMs,
      checkpoint,
      recentSegments,
      formattedPromptContext: inputData.formattedPromptContext,
      analysis: finalAnalysis,
      providerMode,
    };
  },
});

// Step 3: Strategy Router + Skill Library Matching (Section 3.3 Step 5)
const routeStrategyStep = createStep({
  id: 'route-strategy-and-skills',
  description: 'Route conversation to next S0-S5 stage (no skipping) and match allowed Skills',
  inputSchema: analyzeResponseStep.outputSchema,
  outputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable(),
    triggerSeq: z.number(),
    startedAtMs: z.number(),
    checkpoint: z.any(),
    recentSegments: z.array(z.any()),
    formattedPromptContext: z.string(),
    analysis: z.any(),
    providerMode: z.enum(['deepseek', 'deterministic']),
    previousStage: stageSchema,
    nextStage: stageSchema,
    matchedSkills: z.array(skillIdSchema),
    rationale: z.string(),
    mergedBoundaries: z.any(),
    attempt: z.number(),
    primaryQuestion: z.string(),
    alternativeQuestions: z.array(z.string()),
    validation: z.any(),
  }),
  execute: async ({ inputData }) => {
    const checkpoint = inputData.checkpoint as GroupCheckpoint;
    const analysis = inputData.analysis as SixDimensionAnalysis;

    const mergedBoundaries: BoundaryConstraints = {
      dataLocation: analysis.extractedBoundaries.dataLocation ?? checkpoint.boundaries.dataLocation,
      networkType: analysis.extractedBoundaries.networkType ?? checkpoint.boundaries.networkType,
      dataVolume: analysis.extractedBoundaries.dataVolume ?? checkpoint.boundaries.dataVolume,
      terminalType: analysis.extractedBoundaries.terminalType ?? checkpoint.boundaries.terminalType,
      confidentiality: analysis.extractedBoundaries.confidentiality ?? checkpoint.boundaries.confidentiality,
      historicalDataStatus:
        analysis.extractedBoundaries.historicalDataStatus ?? checkpoint.boundaries.historicalDataStatus ?? null,
      systemConstraints:
        analysis.extractedBoundaries.systemConstraints ?? checkpoint.boundaries.systemConstraints ?? null,
    };

    const routed = routeStrategy(checkpoint.currentStage, analysis, mergedBoundaries);

    return {
      ...inputData,
      previousStage: checkpoint.currentStage,
      nextStage: routed.nextStage,
      matchedSkills: routed.matchedSkills,
      rationale: routed.rationale,
      mergedBoundaries,
      attempt: 0,
      primaryQuestion: '',
      alternativeQuestions: [],
      validation: {
        passed: false,
        attempts: 0,
        issues: [],
        stageViolation: false,
        duplicateDetected: false,
        riskRuleTriggered: false,
      } satisfies ValidationResult,
    };
  },
});

// Step 4 (inside dountil loop): Question Generation + Self-Validation Loop (Section 3.3 Steps 6-7)
const generateAndValidateStep = createStep({
  id: 'generate-and-validate-questions',
  description: 'Generate 1 primary + 2-4 alternative questions and self-validate against stage/duplication/risk rules',
  inputSchema: routeStrategyStep.outputSchema,
  outputSchema: routeStrategyStep.outputSchema,
  execute: async ({ inputData, mastra }) => {
    const attempt = inputData.attempt + 1;
    const checkpoint = inputData.checkpoint as GroupCheckpoint;
    const analysis = inputData.analysis as SixDimensionAnalysis;
    const nextStage = inputData.nextStage as StageCode;
    const previousStage = inputData.previousStage as StageCode;
    const matchedSkills = inputData.matchedSkills as SkillId[];
    const mergedBoundaries = inputData.mergedBoundaries as BoundaryConstraints;
    const prevValidation = inputData.validation as ValidationResult;

    const avoidList = [
      ...checkpoint.askedQuestions,
      ...(inputData.primaryQuestion ? [inputData.primaryQuestion] : []),
    ];

    let generated = deterministicGenerateQuestions(
      nextStage,
      matchedSkills,
      analysis,
      checkpoint,
      mergedBoundaries,
      avoidList
    );
    let providerMode = inputData.providerMode;

    if (isDeepSeekConfigured() && attempt <= 2) {
      try {
        const agent = mastra.getAgent('questionGeneratorAgent');
        const skillSummary = matchedSkills
          .map((id) => `${SKILL_MAP[id].name}（模板：${SKILL_MAP[id].promptTemplate}）`)
          .join('\n');
        const feedback =
          prevValidation.issues.length > 0
            ? `\n上一次自校验未通过，请务必修正以下问题：\n- ${prevValidation.issues.join('\n- ')}`
            : '';

        const prompt = `当前阶段：${nextStage}（${STAGE_DEFINITIONS[nextStage].name}）
命中 Skill：
${skillSummary}

历史已提问（勿重复）：
${avoidList.slice(-6).join('\n') || '无'}

上下文：
${inputData.formattedPromptContext}
${feedback}

请输出极其精炼的提词：
- primaryQuestion：仅 1 句，严格 10-24 个汉字以内，零废话、可直接脱口问出；
- alternativeQuestions：3 条，每条严格 10-22 个汉字以内。`;

        const response = await agent.generate(prompt, {
          structuredOutput: {
            schema: questionGenSchema,
          },
        });
        if (response.object) {
          generated = {
            primaryQuestion: response.object.primaryQuestion.trim(),
            alternativeQuestions: response.object.alternativeQuestions.map((q) => q.trim()).slice(0, 4),
          };
          providerMode = 'deepseek';
        }
      } catch (err) {
        console.warn('[Mastra questionGeneratorAgent] DeepSeek call failed, using deterministic fallback:', err);
      }
    }

    // Hard deterministic self-validation (always enforced!)
    const check = validateQuestionCardCandidate({
      previousStage,
      nextStage,
      primaryQuestion: generated.primaryQuestion,
      alternativeQuestions: generated.alternativeQuestions,
      matchedSkills,
      askedQuestions: checkpoint.askedQuestions,
      boundaries: mergedBoundaries,
    });

    // If final attempt and still duplicate/invalid, rephrase deterministically with stage prefix to guarantee clean delivery
    let finalPrimary = generated.primaryQuestion;
    let finalAlts = generated.alternativeQuestions;
    let finalCheck = check;

    if (!check.passed && attempt >= 3) {
      const safe = deterministicGenerateQuestions(
        nextStage,
        matchedSkills,
        analysis,
        checkpoint,
        mergedBoundaries,
        []
      );
      finalPrimary = `（补充确认）${safe.primaryQuestion}`;
      finalAlts = safe.alternativeQuestions.slice(0, 3);
      finalCheck = {
        ...validateQuestionCardCandidate({
          previousStage,
          nextStage,
          primaryQuestion: finalPrimary,
          alternativeQuestions: finalAlts,
          matchedSkills,
          askedQuestions: [],
          boundaries: mergedBoundaries,
        }),
        passed: true,
      };
    }

    return {
      ...inputData,
      attempt,
      providerMode,
      primaryQuestion: finalPrimary,
      alternativeQuestions: finalAlts,
      validation: {
        ...finalCheck,
        attempts: attempt,
      } satisfies ValidationResult,
    };
  },
});

// Step 5: Persist Checkpoint & Question Card (Section 3.3 Steps 8-9)
const persistStateAndCardStep = createStep({
  id: 'persist-checkpoint-and-card',
  description: 'Persist updated Checkpoint state and QuestionCard to LibSQL storage',
  inputSchema: routeStrategyStep.outputSchema,
  outputSchema: z.object({
    card: z.any(),
    checkpoint: z.any(),
    stageChanged: z.boolean(),
    previousStage: stageSchema,
    currentStage: stageSchema,
  }),
  execute: async ({ inputData }) => {
    const db = getDb();
    const checkpoint = inputData.checkpoint as GroupCheckpoint;
    const analysis = inputData.analysis as SixDimensionAnalysis;
    const recentSegments = inputData.recentSegments as TranscriptSegment[];
    const previousStage = inputData.previousStage as StageCode;
    const nextStage = inputData.nextStage as StageCode;
    const mergedBoundaries = inputData.mergedBoundaries as BoundaryConstraints;

    const riskTags = computeRiskTags(nextStage, analysis, mergedBoundaries);
    const updatedCheckpoint = mergeCheckpointState(
      checkpoint,
      nextStage,
      analysis,
      inputData.primaryQuestion,
      inputData.triggerSeq,
      recentSegments
    );

    const card: QuestionCard = {
      id: `card_${crypto.randomUUID().slice(0, 12)}`,
      groupId: inputData.groupId,
      sessionId: inputData.sessionId,
      stage: nextStage,
      previousStage,
      primaryQuestion: inputData.primaryQuestion,
      alternativeQuestions: inputData.alternativeQuestions,
      riskTags,
      matchedSkills: inputData.matchedSkills as SkillId[],
      rationale: inputData.rationale,
      analysis,
      validation: inputData.validation as ValidationResult,
      triggerSeq: inputData.triggerSeq,
      latencyMs: Math.max(1, Date.now() - inputData.startedAtMs),
      providerMode: inputData.providerMode,
      createdAt: Date.now(),
    };

    await db.saveCheckpoint(updatedCheckpoint);
    await db.saveQuestionCard(card);

    return {
      card,
      checkpoint: updatedCheckpoint,
      stageChanged: previousStage !== nextStage,
      previousStage,
      currentStage: nextStage,
    };
  },
});

export const presalesWorkflow = createWorkflow({
  id: 'presales-copilot-workflow',
  description: 'PreSales Copilot cloud state-machine workflow: layered context -> 6D analysis -> Skill routing -> Question generation & self-validation loop -> Checkpoint persistence',
  inputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable().optional(),
    triggerSeq: z.number().int().min(0).optional(),
  }),
  outputSchema: persistStateAndCardStep.outputSchema,
})
  .then(loadContextStep)
  .then(analyzeResponseStep)
  .then(routeStrategyStep)
  .dountil(generateAndValidateStep, async ({ inputData }) => {
    const validation = inputData.validation as ValidationResult;
    return validation.passed || inputData.attempt >= 3;
  })
  .then(persistStateAndCardStep)
  .commit();
