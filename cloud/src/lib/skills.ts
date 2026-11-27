import type {
  BoundaryConstraints,
  SkillDefinition,
  SkillId,
  StageCode,
  StageDefinition,
} from './types';

// 十大 FDE 售前沟通底层原则（V3.0：基于真实政务/审计/财政/经发办客户现场沟通实录深度提炼）
export const TEN_FDE_PRINCIPLES: ReadonlyArray<{
  index: number;
  code: string;
  title: string;
  description: string;
}> = [
  {
    index: 1,
    code: 'SEE_THE_REAL_WORKFLOW_FIRST',
    title: '先看现场不聊文档',
    description: '客户反馈专业文档看不懂时，立刻跳过概念文档，直接看真实业务界面、截图或原始材料。',
  },
  {
    index: 2,
    code: 'NO_SOLUTION_FIRST',
    title: '拒绝方案先行',
    description: '客户谈论 App/小程序/API/大模型选型/显卡数量时，礼貌坚定地拉回真实业务痛点本身。',
  },
  {
    index: 3,
    code: 'SCENE_RESTORATION_AND_IO',
    title: '场景还原与输入输出对齐',
    description: '空泛评价必须追问到底：文件格式、单/多文件、现操作步骤、期望结构化结果、实际错在哪一步。',
  },
  {
    index: 4,
    code: 'FOUR_DIM_ROOT_CAUSE_TRIAGE',
    title: '四维精准归因不拿AI杀鸡',
    description: '区分人的习惯、流程制度、常规程序/数据结构（如快照Diff）、AI架构错配（缺Agent引擎/多模态干OCR/小分类用大模型）。',
  },
  {
    index: 5,
    code: 'BUSINESS_FIRST_PLATFORM_SECOND',
    title: '业务先行平台反哺（FDE思维）',
    description: '先用最合适的轻量工程方案打通客户眼前业务痛点，再反哺基础平台补齐OCR/存储/语音/Agent等公共能力。',
  },
  {
    index: 6,
    code: 'SEVEN_BOUNDARIES_UPFRONT',
    title: '七项硬边界前置排查',
    description: '进入方案前摸清：存储与容器上限（过程图是否留存）、内外网与手机跨端、数据量与变动频次、终端运行时限制（H5息屏/函数超时）、保密与共享权限、历史样例沉淀、既有系统接口。',
  },
  {
    index: 7,
    code: 'PARAPHRASE_AND_STRIP_SOLVED',
    title: '复述闭环与剥离已解决项',
    description: '遇矛盾或绕圈立即复述对齐，主动帮客户剥离已经解决的环节，锁定剩余真卡点。',
  },
  {
    index: 8,
    code: 'HONEST_BOUNDARY_AND_DEFER',
    title: '坦诚划界与验证后置',
    description: '做过的给确定结论；触及深水区（如万级台账本体口径清洗）坦诚说明需先验证并排后；不确定性宏大需求（如宽泛产业图谱）礼貌后置并切回单一场景。',
  },
  {
    index: 9,
    code: 'TECH_ANALOGY_AND_EMPOWER',
    title: '技术降维翻译与赋能提问',
    description: '用汽油(大模型)/发动机(Agent)/改装件(Skill)/注意力分散等比喻消除技术隔阂，并告诉客户如何描述需求（调Skill而非训模型）。',
  },
  {
    index: 10,
    code: 'INCREMENTAL_PROTOTYPE_ORDERED',
    title: '不推倒重来与阶段有序推进',
    description: '肯定客户原有业务逻辑，强调保留存量+嵌入轻量Agent+脱敏样例小步试跑，严格按 S0→S5 顺序推进不跳步。',
  },
];

// Backward-compatible export alias
export const SEVEN_COMMUNICATION_PRINCIPLES = TEN_FDE_PRINCIPLES;

export const STAGE_ORDER: readonly StageCode[] = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;

export const STAGE_DEFINITIONS: Record<StageCode, StageDefinition> = {
  S0: {
    code: 'S0',
    index: 0,
    name: '破冰开场',
    goal: '跳过专业文档，直接看客户真实业务界面/操作流程与核心关注点',
    allowedSkills: ['scene_restoration_probe'],
    exitCriteria: '客户已简述当前业务背景或展示具体工作场景',
  },
  S1: {
    code: 'S1',
    index: 1,
    name: '痛点挖掘',
    goal: '死咬业务痛点、还原文件输入与期望输出、拦截方案先行与宏大空泛需求',
    allowedSkills: [
      'interrupt_solution_first',
      'scene_restoration_probe',
      'vague_demand_redirect',
      'honest_boundary_defer',
    ],
    exitCriteria: '已收集至少1个具备具体输入/步骤/差异的真实业务痛点（痛点清晰度 >= 65）',
  },
  S2: {
    code: 'S2',
    index: 2,
    name: '根因分析',
    goal: '四维精准归因（人/流程/常规程序/AI架构错配），剥离已解决项与消除矛盾',
    allowedSkills: [
      'root_cause_distinction',
      'ai_vs_engineering_triage',
      'paraphrase_loop_confirm',
    ],
    exitCriteria: '已明确核心痛点归属且未拿AI硬扛常规工程问题',
  },
  S3: {
    code: 'S3',
    index: 3,
    name: '边界确认',
    goal: '前置摸清七项现实约束（存储容量/内外网/数据量/终端运行时/保密权限/历史样例/既有接口）',
    allowedSkills: ['boundary_constraints_confirm', 'prototype_and_sample_anchor'],
    exitCriteria: '核心五项边界全部确认，且了解样例与平台限制',
  },
  S4: {
    code: 'S4',
    index: 4,
    name: '痛点收敛',
    goal: '汇总痛点排一期优先级，将高复杂度未验证项坦诚后置二期并复述闭环',
    allowedSkills: [
      'pain_point_convergence',
      'honest_boundary_defer',
      'paraphrase_loop_confirm',
    ],
    exitCriteria: '客户已确认一期优先痛点清单与二期后置项',
  },
  S5: {
    code: 'S5',
    index: 5,
    name: '方案探讨',
    goal: '保留原有业务逻辑，用生活比喻讲清轻量方案（Agent/Skill/OCR/小模型/向量化），锚定脱敏样例试跑与下一步行动',
    allowedSkills: [
      'tech_concept_translation',
      'ai_vs_engineering_triage',
      'prototype_and_sample_anchor',
      'honest_boundary_defer',
      'stage_progression_control',
    ],
    exitCriteria: '一期落地路径、脱敏验证样例与下次对接安排达成共识',
  },
};

export const TECH_ANALOGY_LIBRARY: ReadonlyArray<{
  concept: string;
  analogy: string;
  script: string;
}> = [
  {
    concept: '大模型 / 基座模型',
    analogy: '汽油（92/95/98号油）',
    script: '大模型像汽油，直接点只能简单发热（对话式）；换更强模型相当于换更高标号油。',
  },
  {
    concept: 'Agent 智能体引擎',
    analogy: '发动机',
    script: 'Agent 引擎就是发动机，把油装进去反复循环做功，多轮处理复杂业务。',
  },
  {
    concept: 'Skill / MCP / 业务规则',
    analogy: '轮子、车把与改装件',
    script: 'Skill 就是给发动机装上轮子和车把，不是去训练大模型，而是调你自己的 Skill。',
  },
  {
    concept: '多轮校验与 Attention 原理',
    analogy: '防注意力分散',
    script: '一次塞几十条审核规则模型会分心漏审；用 Agent 拆成一轮专查一条，准确率立马上来。',
  },
  {
    concept: '专用 OCR / 小决策模型',
    analogy: '不拿牛刀杀鸡',
    script: '文字识别用纯CPU 200ms/页的专用OCR，分类用轻量小模型，比多模态大模型快十倍还更稳。',
  },
  {
    concept: 'Embedding 向量检索 / LLM-Wiki',
    analogy: '按语义找相似案例',
    script: '淘汰老式关键词切片 RAG，把历史案例向量化或编译成结构化 Wiki，即使一案一例也能精准找参考。',
  },
  {
    concept: '私有化内网部署',
    analogy: '自家封闭试车场',
    script: '整套车和油都在贵司内网园区里跑，原始数据与过程文件绝不出域。',
  },
];

export const TWELVE_SKILLS: readonly SkillDefinition[] = [
  {
    id: 'interrupt_solution_first',
    name: '打断方案先行',
    triggerCondition: '客户提前谈论 App/小程序/API/大模型选型/RAG/显卡数量等具体解决方案',
    promptTemplate: '先不说方案，现在最卡壳的业务问题是什么？',
    completionCriteria: '客户停止讨论工具形态，开始描述具体业务困难',
    allowedStages: ['S1'],
    priority: 100,
    examples: [
      '先不说方案，现在最卡壳的业务问题是什么？',
      '抛开工具不谈，团队每天最耗人力的事是什么？',
    ],
    enabled: true,
  },
  {
    id: 'vague_demand_redirect',
    name: '模糊需求拒接引导',
    triggerCondition: '客户提出宏大抽象或跨行业不确定需求（企业大脑/产业图谱/全面智能化）',
    promptTemplate: '方向太大，先切一个最具体高频的单点场景？',
    completionCriteria: '客户收敛范围，给出一个具体的单一真实业务场景',
    allowedStages: ['S1'],
    priority: 98,
    examples: [
      '方向太大，先切一个最具体高频的单点场景？',
      '一期只打透一个最耗人工的小环节，您先选哪个？',
    ],
    enabled: true,
  },
  {
    id: 'scene_restoration_probe',
    name: '场景还原追问',
    triggerCondition: '客户看不懂专业文档、描述空泛（不好用/很乱/不准）或未说清输入文件与期望输出',
    promptTemplate: '能看下实际界面或举例：传什么文件、卡在哪？',
    completionCriteria: '客户明确文件格式、单/多文件、操作步骤、期望与实际差异',
    allowedStages: ['S0', 'S1'],
    priority: 92,
    examples: [
      '先不看文档，能看下您实际操作界面或样例吗？',
      '能举例说说：传什么格式文件、期望出什么、实际错在哪？',
    ],
    enabled: true,
  },
  {
    id: 'root_cause_distinction',
    name: '四维根因深挖',
    triggerCondition: '客户笼统归咎于系统或 AI 不准，但混杂了人、流程、程序与 AI 架构问题',
    promptTemplate: '这是人没及时录、流程卡住，还是系统或AI没拆步骤？',
    completionCriteria: '明确问题归属（人/流程/常规程序/AI架构）',
    allowedStages: ['S2'],
    priority: 95,
    examples: [
      '这是人没及时录、流程卡住，还是系统本身做不到？',
      '如果只换工具不改流程和填报习惯，能解决几成？',
    ],
    enabled: true,
  },
  {
    id: 'ai_vs_engineering_triage',
    name: 'AI与常规工程分诊',
    triggerCondition: '客户用大模型硬扛纯逻辑比对（如快照Diff）、用多模态干OCR导致超时、或用大模型做简单二分类',
    promptTemplate: '这更像程序比对或专用OCR问题，真要上大模型吗？',
    completionCriteria: '剥离非AI工程问题，明确哪些用规则/OCR/小模型、哪些用Agent',
    allowedStages: ['S2', 'S5'],
    priority: 96,
    examples: [
      '没变化不推送像程序Diff逻辑，真要靠AI判吗？',
      '解析慢是不是用了多模态干OCR？换专用OCR快十倍。',
    ],
    enabled: true,
  },
  {
    id: 'paraphrase_loop_confirm',
    name: '复述闭环确认',
    triggerCondition: '客户前后矛盾（如纯内网+外勤手机查）、业务逻辑绕圈，或需剥离已解决环节',
    promptTemplate: '复述确认下：前面已解决，真卡点在这对吗？',
    completionCriteria: '客户确认或纠正理解，聚焦剩余真问题',
    allowedStages: ['S2', 'S4'],
    priority: 90,
    examples: [
      '复述确认下：条码录入已解决，卡点只在二次核对？',
      '纯内网和手机外勤查冲突，落地先保哪一边？',
    ],
    enabled: true,
  },
  {
    id: 'boundary_constraints_confirm',
    name: '七项边界约束确认',
    triggerCondition: '痛点根因清晰，但缺少存储容量/过程图留存/内外网/数据量/终端运行时/保密共享/接口等硬边界',
    promptTemplate: '核对下硬边界：数据存哪、纯内网吗、过程图留不留？',
    completionCriteria: '核心边界条件明确，排查出容器上限、云端超时、H5息屏断录等隐患',
    allowedStages: ['S3'],
    priority: 95,
    examples: [
      '核对下边界：数据存政务云还是容器，纯内网吗？',
      '照片识别完扔不扔？存量和月变动大概多少条？',
    ],
    enabled: true,
  },
  {
    id: 'pain_point_convergence',
    name: '痛点验证收口',
    triggerCondition: '多个痛点与边界已收集完成，需锁定一期最值得打透的优先级',
    promptTemplate: '这几个痛点里，一期先打透哪一个见效最快？',
    completionCriteria: '客户明确一期 P0 痛点与优先级排序',
    allowedStages: ['S4'],
    priority: 94,
    examples: [
      '这几个痛点里，一期先打透哪一个见效最快？',
      '结合边界限制，哪一块先跑通大家最有体感？',
    ],
    enabled: true,
  },
  {
    id: 'honest_boundary_defer',
    name: '坦诚划界与验证后置',
    triggerCondition: '遇到未验证过的深水区难题（如万级混乱字段Ontology本体清洗）或跨行业不确定需求',
    promptTemplate: '这块复杂度高需先验证，先排到二期行吗？',
    completionCriteria: '坦诚建立信任，将高不确定性需求合理后置，保住一期确定性交付',
    allowedStages: ['S1', 'S4', 'S5'],
    priority: 93,
    examples: [
      '口径清洗涉及本体论，我们没做过得先验证，放二期行吗？',
      '这个方向偏跨行业不确定需求，先往后放行吗？',
    ],
    enabled: true,
  },
  {
    id: 'tech_concept_translation',
    name: '技术概念降维翻译',
    triggerCondition: 'S5 阶段需要向非技术业务方解释 Agent/Skill/多轮校验/向量化/OCR 等概念',
    promptTemplate: '打个比方：模型是汽油，Agent是发动机，Skill是改装件。',
    completionCriteria: '客户听懂并理解“调 Skill 而非训练大模型”',
    allowedStages: ['S5'],
    priority: 86,
    examples: [
      '打个比方：模型是汽油，Agent是发动机，Skill是改装件。',
      '不是去训大模型，而是把您的审核规则调成Skill。',
    ],
    enabled: true,
  },
  {
    id: 'prototype_and_sample_anchor',
    name: '脱敏样例与存量改造锚定',
    triggerCondition: '客户担心推倒重来、没有结构化训练数据、或询问一期如何起步',
    promptTemplate: '不用推倒重来，能先给几份脱敏样例试跑吗？',
    completionCriteria: '打消推倒重来顾虑，锁定脱敏验证样本与轻量化切入方式',
    allowedStages: ['S3', 'S5'],
    priority: 88,
    examples: [
      '不用推倒重来，能先给10份脱敏样例试跑吗？',
      '一案一例也没关系，能先导出历史资料建语义库吗？',
    ],
    enabled: true,
  },
  {
    id: 'stage_progression_control',
    name: '阶段推进控制',
    triggerCondition: '痛点与边界已对齐，推动进入方案讨论或锁定下一步验证行动',
    promptTemplate: '痛点和边界都齐了，接下来聊一期落地思路行吗？',
    completionCriteria: '客户同意推进或确认下一步验证时间与对接人',
    allowedStages: ['S5'],
    priority: 82,
    examples: [
      '痛点和边界都齐了，接下来聊一期落地思路行吗？',
      '下一步先用脱敏样例跑通一个单点，下周方便对接吗？',
    ],
    enabled: true,
  },
];

// Backward-compatible export alias
export const NINE_SKILLS = TWELVE_SKILLS;

export const SKILL_MAP: Record<SkillId, SkillDefinition> = TWELVE_SKILLS.reduce(
  (acc, skill) => {
    acc[skill.id] = skill;
    return acc;
  },
  {} as Record<SkillId, SkillDefinition>
);

export function getNextStage(current: StageCode): StageCode | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function isValidStageTransition(from: StageCode, to: StageCode): boolean {
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx === fromIdx || toIdx === fromIdx + 1;
}

export function getMissingBoundaries(boundaries: BoundaryConstraints): Array<{
  key: keyof BoundaryConstraints;
  label: string;
}> {
  const items: Array<{ key: keyof BoundaryConstraints; label: string }> = [
    { key: 'dataLocation', label: '数据与存储位置' },
    { key: 'networkType', label: '内网/外网与跨端' },
    { key: 'dataVolume', label: '数据量级' },
    { key: 'terminalType', label: '使用终端与运行限制' },
    { key: 'confidentiality', label: '保密与共享要求' },
  ];
  return items.filter((item) => !boundaries[item.key] || boundaries[item.key]?.trim() === '');
}

export function areAllBoundariesConfirmed(boundaries: BoundaryConstraints): boolean {
  return getMissingBoundaries(boundaries).length === 0;
}

export function isSkillAllowedInStage(skillId: SkillId, stage: StageCode): boolean {
  return STAGE_DEFINITIONS[stage].allowedSkills.includes(skillId);
}
