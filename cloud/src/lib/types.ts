export type StageCode = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export type SkillId =
  | 'interrupt_solution_first'     // 打断方案先行
  | 'scene_restoration_probe'      // 场景还原追问
  | 'root_cause_distinction'       // 根因深挖区分
  | 'boundary_constraints_confirm' // 边界约束确认
  | 'paraphrase_loop_confirm'      // 复述闭环确认
  | 'vague_demand_redirect'        // 模糊需求拒接引导
  | 'pain_point_convergence'       // 痛点验证收口
  | 'tech_concept_translation'     // 技术概念降维翻译
  | 'stage_progression_control';   // 阶段推进控制

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskTag {
  code: string;
  label: string;
  level: RiskLevel;
  reason: string;
}

export interface BoundaryConstraints {
  dataLocation: string | null;    // 数据在哪
  networkType: string | null;     // 内网还是外网
  dataVolume: string | null;      // 数据量
  terminalType: string | null;    // 终端类型
  confidentiality: string | null; // 保密级别
}

export interface SceneSlot {
  uploadInput?: string;
  actionStep?: string;
  expectedResult?: string;
  actualResult?: string;
}

export interface PainPointItem {
  id: string;
  title: string;
  description: string;
  rootCauseCategory: 'people' | 'system' | 'process' | 'unknown';
  priority: number | null; // 1 = highest
  scene?: SceneSlot;
  confirmed: boolean;
}

export interface GroupCheckpoint {
  groupId: string;
  currentStage: StageCode;
  stageGoalProgress: number; // 0..100
  painPoints: PainPointItem[];
  boundaries: BoundaryConstraints;
  confirmedItems: string[];
  unconfirmedItems: string[];
  askedQuestions: string[];
  rollingSummary: string;
  lastAnalyzedSeq: number;
  customerProfile: {
    company?: string;
    industry?: string;
    rolesMentioned: string[];
    techMentions: string[];
  };
  updatedAt: number;
  version: number;
}

export interface CustomerGroup {
  id: string;
  name: string;
  customerCompany: string;
  industry: string;
  notes: string;
  status: 'active' | 'archived';
  nextExpectedSeq: number;
  createdAt: number;
  updatedAt: number;
}

export interface RecordingSession {
  id: string;
  groupId: string;
  status: 'recording' | 'paused' | 'ended';
  startedAt: number;
  endedAt: number | null;
  segmentCount: number;
}

export interface TranscriptSegment {
  id: string;
  groupId: string;
  sessionId: string;
  seq: number;
  text: string;
  originalText: string | null;
  edited: boolean;
  speakerLabel: string | null;
  startedAt: number;
  endedAt: number;
  isFinal: boolean;
  createdAt: number;
}

export interface IncomingSegmentPayload {
  segmentId?: string;
  sessionId: string;
  seq: number;
  text: string;
  startedAt?: number;
  endedAt?: number;
  isFinal?: boolean;
  speakerLabel?: string | null;
}

export interface SixDimensionAnalysis {
  offTopic: boolean;              // 跑偏（如提前谈模型/技术选型）
  offTopicReason?: string;
  abstractness: 'low' | 'medium' | 'high'; // 抽象/空泛程度
  completeness: 'low' | 'medium' | 'high'; // 完整度
  contradiction: boolean;         // 矛盾
  contradictionDetail?: string;
  emotion: 'positive' | 'neutral' | 'frustrated' | 'skeptical' | 'anxious';
  painPointClarity: number;       // 0..100 痛点清晰度
  rootCauseIdentified: 'people' | 'system' | 'process' | 'unknown';
  vagueGrandDemand: boolean;      // 宏大抽象需求
  needsTechTranslation: boolean;  // 是否需要技术概念降维翻译
  stageGoalMet: boolean;          // 当前阶段目标是否达成
  customerAgreedToAdvance: boolean;
  extractedPainPoints: Array<{
    title: string;
    description: string;
    rootCauseCategory: 'people' | 'system' | 'process' | 'unknown';
  }>;
  extractedBoundaries: Partial<BoundaryConstraints>;
  summaryDelta: string;
}

export interface ValidationResult {
  passed: boolean;
  attempts: number;
  issues: string[];
  stageViolation: boolean;
  duplicateDetected: boolean;
  riskRuleTriggered: boolean;
}

export interface QuestionCard {
  id: string;
  groupId: string;
  sessionId: string | null;
  stage: StageCode;
  previousStage: StageCode;
  primaryQuestion: string;
  alternativeQuestions: string[]; // 2..4 items
  riskTags: RiskTag[];
  matchedSkills: SkillId[];
  rationale: string;
  analysis: SixDimensionAnalysis;
  validation: ValidationResult;
  triggerSeq: number;
  latencyMs: number;
  providerMode: 'deepseek' | 'deterministic';
  createdAt: number;
}

export interface MeetingSummary {
  id: string;
  groupId: string;
  sessionId: string | null;
  minutes: string;
  painPoints: PainPointItem[];
  confirmedBoundaries: BoundaryConstraints;
  unconfirmedItems: string[];
  nextActions: string[];
  markdown: string;
  createdAt: number;
}

export interface SkillDefinition {
  id: SkillId;
  name: string;
  triggerCondition: string;
  promptTemplate: string;
  completionCriteria: string;
  allowedStages: StageCode[];
  priority: number;
  examples: string[];
  enabled: boolean;
}

export interface StageDefinition {
  code: StageCode;
  index: number;
  name: string;
  goal: string;
  allowedSkills: SkillId[];
  exitCriteria: string;
}

export interface SequenceIngestResult {
  groupId: string;
  acceptedSegments: TranscriptSegment[];
  acceptedSeqs: number[];
  bufferedSeqs: number[];
  duplicateSeqs: number[];
  nextExpectedSeq: number;
}

// WebSocket Wire Messages
export type ClientWsMessage =
  | { type: 'subscribe'; groupId: string; sessionId?: string }
  | { type: 'segment'; groupId: string; sessionId: string; segmentId?: string; seq: number; text: string; startedAt?: number; endedAt?: number; isFinal?: boolean }
  | { type: 'segment_batch'; groupId: string; segments: IncomingSegmentPayload[] }
  | { type: 'segment_edit'; groupId: string; segmentId: string; text: string }
  | { type: 'session_control'; groupId: string; sessionId?: string; action: 'start' | 'pause' | 'resume' | 'end' }
  | { type: 'ping'; ts: number };

export type ServerWsMessage =
  | {
      type: 'snapshot';
      group: CustomerGroup;
      checkpoint: GroupCheckpoint;
      segments: TranscriptSegment[];
      latestCard: QuestionCard | null;
      bufferedSeqs: number[];
    }
  | {
      type: 'segment_ack';
      groupId: string;
      acceptedSeqs: number[];
      bufferedSeqs: number[];
      duplicateSeqs: number[];
      nextExpectedSeq: number;
    }
  | { type: 'question_card'; card: QuestionCard }
  | {
      type: 'stage_updated';
      groupId: string;
      previousStage: StageCode;
      currentStage: StageCode;
      checkpoint: GroupCheckpoint;
    }
  | { type: 'session_summary'; summary: MeetingSummary }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'pong'; ts: number };
