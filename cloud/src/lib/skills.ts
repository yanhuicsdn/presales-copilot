import type {
  BoundaryConstraints,
  SkillDefinition,
  SkillId,
  StageCode,
  StageDefinition,
} from './types';

export const SEVEN_COMMUNICATION_PRINCIPLES: ReadonlyArray<{
  index: number;
  code: string;
  title: string;
  description: string;
}> = [
  {
    index: 1,
    code: 'NO_SOLUTION_FIRST',
    title: '拒绝方案先行',
    description: '客户谈论技术选型、模型参数或工具架构时，强制拉回业务痛点本身。',
  },
  {
    index: 2,
    code: 'SCENE_RESTORATION_FIRST',
    title: '场景还原优先',
    description: '面对空泛评价（如“不好用/很乱/效率低”），必须追问具体操作画面（上传什么→点什么→期望什么→实际什么）。',
  },
  {
    index: 3,
    code: 'DISTINGUISH_ROOT_CAUSE',
    title: '区分问题归属',
    description: '明确区分人的操作/习惯问题、系统技术能力问题、还是流程制度问题。',
  },
  {
    index: 4,
    code: 'CONFIRM_BOUNDARIES_UPFRONT',
    title: '边界前置确认',
    description: '痛点清晰后，进入方案前必须确认五项边界：数据位置、内外网、数据量、终端形态、保密要求。',
  },
  {
    index: 5,
    code: 'PARAPHRASE_LOOP_VERIFY',
    title: '复述闭环验证',
    description: '信息模糊、隐含前提或前后矛盾时，主动复述并请客户确认或纠正。',
  },
  {
    index: 6,
    code: 'REDIRECT_VAGUE_DEMAND',
    title: '模糊需求不硬接',
    description: '面对宏大抽象需求（如“做个企业大脑/全面智能化”），不硬接，要求落地到一个具体真实场景。',
  },
  {
    index: 7,
    code: 'ORDERED_STAGE_PROGRESSION',
    title: '阶段有序推进',
    description: '严格按照 S0→S1→S2→S3→S4→S5 顺序推进，禁止跳步，痛点与边界未闭合前不讨论技术方案。',
  },
];

export const STAGE_ORDER: readonly StageCode[] = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;

export const STAGE_DEFINITIONS: Record<StageCode, StageDefinition> = {
  S0: {
    code: 'S0',
    index: 0,
    name: '破冰开场',
    goal: '建立沟通氛围，请客户简述业务现状与当前核心关注点',
    allowedSkills: ['scene_restoration_probe'],
    exitCriteria: '客户已简述当前业务背景或初步场景',
  },
  S1: {
    code: 'S1',
    index: 1,
    name: '痛点挖掘',
    goal: '收集真实业务卡点，还原操作现场，拦截过早谈方案',
    allowedSkills: ['interrupt_solution_first', 'scene_restoration_probe', 'vague_demand_redirect'],
    exitCriteria: '已收集至少1个具备具体业务场景的清晰痛点（痛点清晰度 >= 65）',
  },
  S2: {
    code: 'S2',
    index: 2,
    name: '根因分析',
    goal: '区分问题归属（人的问题 / 系统技术问题 / 流程制度问题），消除前后矛盾',
    allowedSkills: ['root_cause_distinction', 'paraphrase_loop_confirm'],
    exitCriteria: '已明确主要痛点的问题归属且无未消解矛盾',
  },
  S3: {
    code: 'S3',
    index: 3,
    name: '边界确认',
    goal: '前置确认五项关键约束：数据在哪、内外网、数据量、终端、保密等级',
    allowedSkills: ['boundary_constraints_confirm'],
    exitCriteria: '五项边界条件全部确认',
  },
  S4: {
    code: 'S4',
    index: 4,
    name: '痛点收敛',
    goal: '汇总已识别的痛点与约束，请客户排序优先级并复述确认',
    allowedSkills: ['pain_point_convergence', 'paraphrase_loop_confirm'],
    exitCriteria: '客户已确认痛点清单与优先级排序',
  },
  S5: {
    code: 'S5',
    index: 5,
    name: '方案探讨',
    goal: '围绕高优痛点与已确认边界探讨解决思路，用通俗比喻降维解释技术概念',
    allowedSkills: ['tech_concept_translation', 'stage_progression_control'],
    exitCriteria: '方案方向与下一步行动计划达成共识',
  },
};

export const TECH_ANALOGY_LIBRARY: ReadonlyArray<{
  concept: string;
  analogy: string;
  script: string;
}> = [
  {
    concept: '大模型 / 基座模型',
    analogy: '发动机',
    script: '大模型就像汽车的发动机，提供通用动力；单有发动机跑不起来，还得配底盘和方向盘。',
  },
  {
    concept: '企业数据 / 知识库',
    analogy: '汽油',
    script: '你们内部的业务文档和数据就像汽油，油品越干净、标号越准，发动机输出的动力才越稳。',
  },
  {
    concept: '微调 / 插件 / 工作流 / Agent',
    analogy: '改装件与导航系统',
    script: 'Agent 编排和插件就像给车装上的专用改装件和导航，让它严格按你们的业务路线自动跑。',
  },
  {
    concept: '私有化部署 / 内网隔离',
    analogy: '自家封闭试车场',
    script: '内网部署就像把整套车和油都锁在你们自己的封闭园区里跑，数据一滴都不会流到外面。',
  },
];

export const NINE_SKILLS: readonly SkillDefinition[] = [
  {
    id: 'interrupt_solution_first',
    name: '打断方案先行',
    triggerCondition: '客户提前谈论技术工具、大模型选型、RAG/微调/私有化架构等方案细节',
    promptTemplate: '先不说解决方案和技术选型，我们先拉回到业务本身：您现在日常工作里最卡壳的问题到底是什么？',
    completionCriteria: '客户停止讨论技术方案，开始描述具体业务困难',
    allowedStages: ['S1'],
    priority: 100,
    examples: [
      '先不急着定用哪个大模型或做不做微调，能先说说现在业务团队每天最头疼的具体环节是什么吗？',
      '技术路线我们后面一定一起看，现在先请您带我看下：如果不谈工具，业务上最耽误事的一步在哪？',
    ],
    enabled: true,
  },
  {
    id: 'scene_restoration_probe',
    name: '场景还原追问',
    triggerCondition: '客户回答空泛抽象（如“不好用”、“很乱”、“效率低”、“体验差”）',
    promptTemplate: '能否带我还原一次具体操作画面：业务员当时上传/拿到了什么材料→点了什么步骤→原本期望什么结果→实际出来的是什么？',
    completionCriteria: '客户给出具体文件/输入、操作步骤、期望结果、实际结果四项要素',
    allowedStages: ['S0', 'S1'],
    priority: 90,
    examples: [
      '您刚才提到现在流程“很乱、不好用”，能拿昨天发生的一单具体举例吗？员工先上传什么、点哪一步、原本期望出什么、实际卡在哪了？',
      '为了不理解偏差，能帮我回放一个最典型的操作片段吗？输入文件是什么，最后哪里让您觉得不满意？',
    ],
    enabled: true,
  },
  {
    id: 'root_cause_distinction',
    name: '根因深挖区分',
    triggerCondition: '客户将问题笼统归咎于系统或团队，但未说清根本原因',
    promptTemplate: '听下来这个问题很典型，想跟您一起拆一下：这主要是人员操作习惯/培训问题、现有系统功能确实做不到，还是跨部门流程制度卡住了？',
    completionCriteria: '明确问题归属于人、系统技术或流程制度中的具体维度',
    allowedStages: ['S2'],
    priority: 95,
    examples: [
      '您说的审批慢和数据对不上，本质上是现有系统能力做不到，还是各部门填报口径/制度没统一，或者是员工操作习惯问题？',
      '如果把现有系统换掉，这个问题会自动消失吗，还是背后有流程审批权限的限制？',
    ],
    enabled: true,
  },
  {
    id: 'boundary_constraints_confirm',
    name: '边界约束确认',
    triggerCondition: '业务痛点与根因已清晰，但缺少五项关键落地约束中的任意一项',
    promptTemplate: '痛点很清楚了，在想方案前先核对五个硬边界：数据目前存在哪？运行在内网还是外网？大概多大数据量？一线在什么终端使用？保密合规有什么硬要求？',
    completionCriteria: '数据位置、网络环境、数据量级、终端类型、保密要求五项边界全部确认',
    allowedStages: ['S3'],
    priority: 95,
    examples: [
      '为了后面给的方案能真正落地，先向您确认下硬约束：这些业务数据目前存在哪，是纯内网还是能连外网？',
      '除了网络和数据位置，还想确认下日均/存量数据规模大概多大？一线员工主要用电脑还是手机，涉密等级有什么要求？',
    ],
    enabled: true,
  },
  {
    id: 'paraphrase_loop_confirm',
    name: '复述闭环确认',
    triggerCondition: '客户前后表述矛盾、信息含糊或阶段收口前需要对齐认知',
    promptTemplate: '我快速复述一下刚听到的要点，您看我理解得对不对：核心情况是【XX】，但刚才您提到【YY】，这两处我们以哪个为准？',
    completionCriteria: '客户明确确认理解无误，或指出偏差并完成纠正',
    allowedStages: ['S2', 'S4'],
    priority: 88,
    examples: [
      '我复述确认一下，看有没有理解偏：您刚才说数据不能出内网，同时又希望外勤手机随时查，这两点我们实际落地时优先按哪个口径来？',
      '我把刚才对齐的几个核心点复述一遍，您帮我把把关，看看有没有漏掉或理解错的地方？',
    ],
    enabled: true,
  },
  {
    id: 'vague_demand_redirect',
    name: '模糊需求拒接引导',
    triggerCondition: '客户提出宏大抽象目标（如“做一个全能AI大脑”、“全面数字化赋能”、“所有部门都接上”）',
    promptTemplate: '这个愿景方向太大了，咱们一口吃不成胖子；您先给我切一个最痛、最真实、明天就想解决的单一业务场景行吗？',
    completionCriteria: '客户收敛范围，给出一个具体的单一真实业务场景',
    allowedStages: ['S1'],
    priority: 98,
    examples: [
      '“全公司智能化升级”范围太大，咱们一期如果只打透一个部门、一个高频动作，您最想先解决哪一个具体场景？',
      '大蓝图我们记下来了，但为了项目能落地见效，能先挑一个目前最耗人力、最具体的单一环节切入吗？',
    ],
    enabled: true,
  },
  {
    id: 'pain_point_convergence',
    name: '痛点验证收口',
    triggerCondition: '已收集多个痛点且边界已基本清楚，进入收敛排序阶段',
    promptTemplate: '目前我们梳理出几个核心痛点，如果一期资源有限只能先解决 1-2 个，您会怎么排优先级？',
    completionCriteria: '客户确认痛点清单并明确 P0/P1 优先级顺序',
    allowedStages: ['S4'],
    priority: 95,
    examples: [
      '刚才我们一共挖出了这些核心痛点，加上刚确认的内外网与保密边界，您看哪个痛点最紧急、最值得放进一期最优先解决？',
      '如果这三个痛点必须排个第一、第二、第三，从业务价值和领导关注度来看，您怎么排序？',
    ],
    enabled: true,
  },
  {
    id: 'tech_concept_translation',
    name: '技术概念降维翻译',
    triggerCondition: 'S5 方案探讨阶段涉及专业技术术语，需要让非技术业务方听懂',
    promptTemplate: '用通俗比喻解释：大模型是“发动机”，贵司业务数据是“汽油”，智能体工作流是“专用改装件和导航”，三者配合才能把业务跑顺。',
    completionCriteria: '客户表示听懂技术机制并能围绕业务价值继续讨论',
    allowedStages: ['S5'],
    priority: 85,
    examples: [
      '其实不用被那些技术词绕晕：大模型就像发动机，你们的制度文档是汽油，我们做的 Agent 就像装上定制改装件和导航，确保车按你们的规矩开。这样说您觉得清楚吗？',
      '换个好理解的说法：内网部署就是把发动机和汽油都放进你们自己的封闭园区里跑，既安全又能提效。',
    ],
    enabled: true,
  },
  {
    id: 'stage_progression_control',
    name: '阶段推进控制',
    triggerCondition: '当前阶段目标已经达成，需获得客户认可平滑过渡到下一阶段或收尾定行动项',
    promptTemplate: '前面几块的痛点和约束已经非常清晰了，如果您这边没有补充，我们接下来就正式聊聊对应的解决思路和落地方案，可以吗？',
    completionCriteria: '客户明确同意进入下一阶段或确认下一步行动计划',
    allowedStages: ['S5'],
    priority: 80,
    examples: [
      '痛点、根因和五项边界咱们都已经对齐了，接下来我基于这几个高优痛点讲一下整体解决思路和一期切入点，您看可以吗？',
      '方案大方向达成共识了，接下来我们把下一步 POC 验证范围和时间节点定一下，您看下周方便安排一次技术对接吗？',
    ],
    enabled: true,
  },
];

export const SKILL_MAP: Record<SkillId, SkillDefinition> = NINE_SKILLS.reduce(
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
  // Stay in same stage OR advance by strictly 1 step (no skipping!)
  return toIdx === fromIdx || toIdx === fromIdx + 1;
}

export function getMissingBoundaries(boundaries: BoundaryConstraints): Array<{
  key: keyof BoundaryConstraints;
  label: string;
}> {
  const items: Array<{ key: keyof BoundaryConstraints; label: string }> = [
    { key: 'dataLocation', label: '数据存放位置' },
    { key: 'networkType', label: '内网/外网环境' },
    { key: 'dataVolume', label: '数据量级' },
    { key: 'terminalType', label: '使用终端' },
    { key: 'confidentiality', label: '保密合规要求' },
  ];
  return items.filter((item) => !boundaries[item.key] || boundaries[item.key]?.trim() === '');
}

export function areAllBoundariesConfirmed(boundaries: BoundaryConstraints): boolean {
  return getMissingBoundaries(boundaries).length === 0;
}

export function isSkillAllowedInStage(skillId: SkillId, stage: StageCode): boolean {
  return STAGE_DEFINITIONS[stage].allowedSkills.includes(skillId);
}
