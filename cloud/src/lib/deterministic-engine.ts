import crypto from 'node:crypto';
import {
  areAllBoundariesConfirmed,
  getMissingBoundaries,
  getNextStage,
  isSkillAllowedInStage,
  isValidStageTransition,
  SKILL_MAP,
  STAGE_DEFINITIONS,
  TECH_ANALOGY_LIBRARY,
} from './skills';
import { computeTextEmbedding, cosineSimilarity, updateRollingSummary } from './vector-recall';
import type {
  BoundaryConstraints,
  GroupCheckpoint,
  MeetingSummary,
  PainPointItem,
  RiskTag,
  SixDimensionAnalysis,
  SkillId,
  StageCode,
  TranscriptSegment,
  ValidationResult,
} from './types';

// Keyword detectors for Chinese pre-sales dialogue analysis
const TECH_SOLUTION_KEYWORDS = [
  'deepseek', 'gpt', '大模型', '微调', 'rag', '向量数据库', '知识图谱', 'langchain',
  'langgraph', 'mastra', 'agent', '私有化模型', 'gpu', '算力', '显卡', 'qwen',
  '千问', 'llama', 'dify', 'coze', 'mcp', '工作流引擎', '选型', '模型参数', '用什么模型',
];

const ABSTRACT_EVAL_KEYWORDS = [
  '不好用', '很乱', '效率低', '体验差', '太慢了', '不方便', '很难用', '一言难尽',
  '不太行', '感觉一般', '比较麻烦', '混乱', '不行',
];

const VAGUE_GRAND_KEYWORDS = [
  '企业大脑', '全面智能化', '全公司赋能', '数字化转型', '全能ai', '全能助手',
  '所有部门', '全面替代', '做一个ai平台', '什么都能干', '整体智能化', '全方位升级',
];

const FRUSTRATION_KEYWORDS = [
  '烦死', '崩溃', '受不了', '头疼', '痛苦', '投诉', '骂', '天天加班', '太坑', '气死',
];

const SKEPTICAL_KEYWORDS = [
  '真能行吗', '不靠谱', '怀疑', '之前做过失败', '担心', '怕落地不了', '听起来很虚',
];

const CONTRADICTION_MARKERS = [
  '不过刚才', '不对', '其实不是', '但是又要', '又要', '既要', '同时还得', '刚说错了',
];

const PEOPLE_CAUSE_KEYWORDS = [
  '不愿意用', '不会操作', '懒得填', '员工习惯', '培训不够', '人的问题', '老员工', '不配合', '手工漏填',
];

const SYSTEM_CAUSE_KEYWORDS = [
  '系统不支持', '功能做不到', '没有接口', '老系统', '报错', '卡死', '查不到', '导出不了', '识别不准', '系统能力',
];

const PROCESS_CAUSE_KEYWORDS = [
  '流程', '审批', '跨部门', '制度', '口径不统一', '签字', '权限', '扯皮', '规范没定',
];

const ENGINEERING_CAUSE_KEYWORDS = [
  '重复推送', '全量推送', '状态对比', '快照对比', 'diff', '60秒超时', '接口超时',
  '容器100兆', '存储上限', '没存图片', '程序逻辑', '数据库字段', '没做去重', '同步漏推',
];

const AI_ARCH_CAUSE_KEYWORDS = [
  '单次对话', '单轮prompt', '多模态识别', '多模态做ocr', '切片', '注意力分散',
  '漏审', '审核规则太多', '没接agent', '跑十多分钟', '解析太慢', '提示词太长',
];

const HONEST_DEFER_KEYWORDS = [
  '本体', 'ontology', '字段混乱', '地址不统一', '历史数据清洗', '产业图谱',
  '二栋几零几', '没做过', '不确定需求', '语义统一', '口径清洗', '跨行业图谱',
];

const SAMPLE_ANCHOR_KEYWORDS = [
  '推倒重来', '重做一套', '一案一例', '没有训练数据', '脱敏样例', '存量改造',
  '怎么验证', '小步试跑', '历史模板', '现成系统',
];

const AGREE_ADVANCE_KEYWORDS = [
  '可以', '行', '没问题', '同意', '聊聊方案', '听听思路', '进入下一步', '说得对', '排第一', '优先解决', '认可',
];

const CONCRETE_SCENE_MARKERS = [
  '上传', '导出', '点击', '打开', '录入', '表格', 'excel', 'pdf', 'word', '合同',
  '单据', '工单', '发票', '图纸', '报告', '审批单', '期望', '实际', '结果', '步骤', '每天',
];

export function extractBoundariesFromText(text: string): Partial<BoundaryConstraints> {
  const result: Partial<BoundaryConstraints> = {};
  const t = text;

  // Data location
  if (/(本地机房|政务云|私有云|阿里云|华为云|腾讯云|本地服务器|erp里|oa里|nas|文件服务器|数据库里|存在本地)/i.test(t)) {
    const match = t.match(/(本地机房|政务云|私有云|阿里云|华为云|腾讯云|本地服务器|ERP|OA|NAS|文件服务器|数据库|本地)/i);
    result.dataLocation = match ? `位于${match[0]}` : '客户自有环境';
  }

  // Network type
  if (/(纯内网|物理隔离|离线|政务外网|专网|局域网|不能连外网|断网)/.test(t)) {
    const match = t.match(/(纯内网|物理隔离|离线|政务外网|专网|局域网|不能连外网)/);
    result.networkType = match ? match[0] : '纯内网隔离';
  } else if (/(可以连外网|公网|互联网|混合云|云端可访问|外网)/.test(t)) {
    const match = t.match(/(公网|互联网|混合云|可连外网|外网)/);
    result.networkType = match ? match[0] : '可访问外网';
  }

  // Data volume
  if (/(万份|百万|千万|几百g|tb|gb|每天.*?(单|份|条)|存量.*?(万|千|g|t))/i.test(t)) {
    const match = t.match(/([0-9一二三四五六七八九十百千万亿.]+\s*(?:万份|千份|份|条|单|GB|TB|G|T|万条|百万))/i);
    result.dataVolume = match ? match[0] : '中大规模业务数据';
  }

  // Terminal type
  if (/(pc端|电脑|浏览器|web端|钉钉|企微|企业微信|飞书|手机|移动端|pad|平板|桌面端|客户端)/i.test(t)) {
    const matches = t.match(/(PC端|电脑|浏览器|Web端|钉钉|企业微信|企微|飞书|手机|移动端|平板|客户端)/gi);
    if (matches) {
      result.terminalType = Array.from(new Set(matches)).join('/');
    }
  }

  // Confidentiality
  if (/(涉密|机密|绝密|秘密|等保三级|等保二级|不可出域|数据不出内网|脱敏|合规|非涉密|公开数据|商密)/.test(t)) {
    const match = t.match(/(绝密|机密|涉密|商密|等保三级|等保二级|数据不出内网|不可出域|非涉密|公开数据|脱敏)/);
    result.confidentiality = match ? match[0] : '高保密/数据不出域';
  }

  // Historical data & sample status (V3.0 Boundary 6)
  if (/(脱敏样例|样本|历史记录|数据很乱|口径不统一|没留底|没保存图片|电子台账|纸质|一案一例|历史数据)/.test(t)) {
    const match = t.match(/(脱敏样例|历史数据|数据很乱|口径不统一|没留底|没保存图片|电子台账|纸质|一案一例)/);
    result.historicalDataStatus = match ? match[0] : '已提及历史数据/样例现状';
  }

  // Existing system & runtime constraints (V3.0 Boundary 7)
  if (/(60秒超时|超时限制|容器.*100|h5.*锁屏|锁屏中断|老系统接口|不能改原系统|对象存储|存量小程序|api限制)/i.test(t)) {
    const match = t.match(/(60秒超时|超时限制|容器[^，。；]{0,8}|H5[^，。；]{0,8}|锁屏中断|老系统接口|不能改原系统|对象存储|存量小程序)/i);
    result.systemConstraints = match ? match[0] : '存在现网系统/运行限制';
  }

  return result;
}

export function deterministicAnalyze(
  recentSegments: TranscriptSegment[],
  checkpoint: GroupCheckpoint
): SixDimensionAnalysis {
  const newSinceLast = recentSegments.filter((s) => s.seq > checkpoint.lastAnalyzedSeq);
  const currentTurnSegments =
    newSinceLast.length > 0 ? newSinceLast : recentSegments.slice(-1);
  const latestText = currentTurnSegments.map((s) => s.text).join(' ');
  const fullRecent = recentSegments.map((s) => s.text).join(' ');
  const lower = latestText.toLowerCase();

  const mentionsTech = TECH_SOLUTION_KEYWORDS.some((kw) => lower.includes(kw));
  const offTopic = mentionsTech && checkpoint.currentStage !== 'S5';

  const hasAbstract = ABSTRACT_EVAL_KEYWORDS.some((kw) => latestText.includes(kw));
  const concreteHits = CONCRETE_SCENE_MARKERS.filter((kw) => lower.includes(kw)).length;
  const vagueGrandDemand = VAGUE_GRAND_KEYWORDS.some((kw) => lower.includes(kw));

  const abstractness: 'low' | 'medium' | 'high' =
    vagueGrandDemand || (hasAbstract && concreteHits < 2)
      ? 'high'
      : concreteHits >= 3
      ? 'low'
      : 'medium';

  const completeness: 'low' | 'medium' | 'high' =
    latestText.length >= 45 && concreteHits >= 2
      ? 'high'
      : latestText.length >= 20
      ? 'medium'
      : 'low';

  // Contradiction detection: explicit markers OR intranet + external mobile conflict
  const hasExplicitContradiction = CONTRADICTION_MARKERS.some((kw) => latestText.includes(kw));
  const boundaryConflict =
    (/(纯内网|不能连外网|物理隔离)/.test(fullRecent) && /(手机随时|公网直接|外网访问|微信直接发)/.test(fullRecent));
  const contradiction = hasExplicitContradiction || boundaryConflict;
  const contradictionDetail = boundaryConflict
    ? '既要求纯内网隔离，又希望外网/手机端随时访问，存在部署边界冲突'
    : hasExplicitContradiction
    ? '客户前后表述存在口径变化或同时提出冲突约束'
    : undefined;

  let emotion: SixDimensionAnalysis['emotion'] = 'neutral';
  if (FRUSTRATION_KEYWORDS.some((kw) => latestText.includes(kw))) {
    emotion = 'frustrated';
  } else if (SKEPTICAL_KEYWORDS.some((kw) => latestText.includes(kw))) {
    emotion = 'skeptical';
  } else if (/(太好了|不错|期待|有帮助|赞成)/.test(latestText)) {
    emotion = 'positive';
  } else if (/(着急|马上|下个月就要|领导催|压力大)/.test(latestText)) {
    emotion = 'anxious';
  }

  let rootCauseIdentified: SixDimensionAnalysis['rootCauseIdentified'] = 'unknown';
  const hitEngineering = ENGINEERING_CAUSE_KEYWORDS.some((kw) => lower.includes(kw));
  const hitAiArch = AI_ARCH_CAUSE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hitEngineering) {
    rootCauseIdentified = 'engineering';
  } else if (hitAiArch) {
    rootCauseIdentified = 'ai_architecture';
  } else if (SYSTEM_CAUSE_KEYWORDS.some((kw) => latestText.includes(kw))) {
    rootCauseIdentified = 'system';
  } else if (PROCESS_CAUSE_KEYWORDS.some((kw) => latestText.includes(kw))) {
    rootCauseIdentified = 'process';
  } else if (PEOPLE_CAUSE_KEYWORDS.some((kw) => latestText.includes(kw))) {
    rootCauseIdentified = 'people';
  }

  const needsEngineeringTriage = hitEngineering || hitAiArch;
  const needsHonestDefer = HONEST_DEFER_KEYWORDS.some((kw) => lower.includes(kw));
  const needsSampleAnchor = SAMPLE_ANCHOR_KEYWORDS.some((kw) => lower.includes(kw));

  // Pain point extraction
  const extractedPainPoints: SixDimensionAnalysis['extractedPainPoints'] = [];
  if (concreteHits >= 2 || /(耗时|人工|核对|漏|错|慢|重复|积压|检索困难|写材料|审核)/.test(latestText)) {
    const snippet = latestText.replace(/\s+/g, ' ').slice(0, 48);
    let title = '业务处理效率瓶颈';
    if (/(合同|审核|法务|比对)/.test(latestText)) title = '合同/文档人工审核耗时易漏';
    else if (/(检索|查找|知识库|文档|资料)/.test(latestText)) title = '内部资料检索困难与口径分散';
    else if (/(填报|表格|excel|对账|统计|报表)/i.test(latestText)) title = '手工表格汇总核对重复劳动重';
    else if (/(工单|客服|回复|派单|投诉)/.test(latestText)) title = '工单/客户问题响应与分派慢';
    else if (/(审批|流程|流转|签字)/.test(latestText)) title = '跨部门审批流转卡顿';
    else if (/(标书|报告|写材料|公文)/.test(latestText)) title = '标书/业务材料编写周期长';

    extractedPainPoints.push({
      title,
      description: snippet,
      rootCauseCategory: rootCauseIdentified,
    });
  }

  const extractedBoundaries = extractBoundariesFromText(fullRecent);
  const mergedBoundaries: BoundaryConstraints = {
    dataLocation: extractedBoundaries.dataLocation ?? checkpoint.boundaries.dataLocation,
    networkType: extractedBoundaries.networkType ?? checkpoint.boundaries.networkType,
    dataVolume: extractedBoundaries.dataVolume ?? checkpoint.boundaries.dataVolume,
    terminalType: extractedBoundaries.terminalType ?? checkpoint.boundaries.terminalType,
    confidentiality: extractedBoundaries.confidentiality ?? checkpoint.boundaries.confidentiality,
    historicalDataStatus:
      extractedBoundaries.historicalDataStatus ?? checkpoint.boundaries.historicalDataStatus ?? null,
    systemConstraints:
      extractedBoundaries.systemConstraints ?? checkpoint.boundaries.systemConstraints ?? null,
  };

  let painPointClarity = checkpoint.painPoints.length > 0 ? 55 : 20;
  painPointClarity += concreteHits * 12;
  if (extractedPainPoints.length > 0) painPointClarity += 18;
  if (abstractness === 'high') painPointClarity -= 20;
  if (offTopic) painPointClarity -= 15;
  painPointClarity = Math.max(5, Math.min(100, painPointClarity));

  const customerAgreedToAdvance = AGREE_ADVANCE_KEYWORDS.some((kw) => latestText.includes(kw));
  const needsTechTranslation =
    checkpoint.currentStage === 'S5' &&
    (mentionsTech || /(听不懂|什么意思|原理|怎么实现|区别)/.test(latestText));

  // Evaluate whether current stage goal is met
  let stageGoalMet = false;
  switch (checkpoint.currentStage) {
    case 'S0':
      stageGoalMet = latestText.length >= 12 && !vagueGrandDemand;
      break;
    case 'S1':
      stageGoalMet =
        !offTopic &&
        !vagueGrandDemand &&
        abstractness !== 'high' &&
        (painPointClarity >= 65 || (checkpoint.painPoints.length >= 1 && concreteHits >= 2));
      break;
    case 'S2':
      stageGoalMet =
        !contradiction &&
        (rootCauseIdentified !== 'unknown' ||
          checkpoint.painPoints.some((p) => p.rootCauseCategory !== 'unknown'));
      break;
    case 'S3':
      stageGoalMet = areAllBoundariesConfirmed(mergedBoundaries);
      break;
    case 'S4':
      stageGoalMet =
        !contradiction &&
        (customerAgreedToAdvance || /(第一|优先|先做|p0|最重要|排序)/i.test(latestText));
      break;
    case 'S5':
      stageGoalMet = customerAgreedToAdvance;
      break;
  }

  return {
    offTopic,
    offTopicReason: offTopic ? '客户在非方案阶段提前谈论模型/技术选型，需按原则1拉回业务痛点' : undefined,
    abstractness,
    completeness,
    contradiction,
    contradictionDetail,
    emotion,
    painPointClarity,
    rootCauseIdentified,
    vagueGrandDemand,
    needsEngineeringTriage,
    needsHonestDefer,
    needsSampleAnchor,
    needsTechTranslation,
    stageGoalMet,
    customerAgreedToAdvance,
    extractedPainPoints,
    extractedBoundaries,
    summaryDelta: latestText.slice(0, 120),
  };
}

/**
 * Strategy Router (Section 3.3 Step 5 & Section 6.2/6.3):
 * Strictly constrains matched skills to the allowed skills of the active stage (no skipping!).
 */
export function routeStrategy(
  stage: StageCode,
  analysis: SixDimensionAnalysis,
  boundaries: BoundaryConstraints
): {
  nextStage: StageCode;
  matchedSkills: SkillId[];
  rationale: string;
} {
  let targetStage: StageCode = stage;

  // Ordered progression S0 -> S1 -> S2 -> S3 -> S4 -> S5 (strictly +1 max, never skip!)
  if (analysis.stageGoalMet && !analysis.offTopic && !analysis.contradiction) {
    const candidateNext = getNextStage(stage);
    if (candidateNext && isValidStageTransition(stage, candidateNext)) {
      targetStage = candidateNext;
    }
  }

  const allowed = STAGE_DEFINITIONS[targetStage].allowedSkills;
  const matched: SkillId[] = [];
  const reasons: string[] = [];

  if (targetStage === 'S0') {
    matched.push('scene_restoration_probe');
    reasons.push('处于 S0 破冰开场阶段，引导客户简述具体业务现状与操作场景');
  } else if (targetStage === 'S1') {
    if (analysis.offTopic && allowed.includes('interrupt_solution_first')) {
      matched.push('interrupt_solution_first');
      reasons.push('检测到客户提前讨论技术选型/方案，触发「打断方案先行」拉回业务痛点');
    }
    if (analysis.vagueGrandDemand && allowed.includes('vague_demand_redirect')) {
      matched.push('vague_demand_redirect');
      reasons.push('检测到宏大抽象需求，触发「模糊需求拒接引导」聚焦单一真实场景');
    }
    if (analysis.needsHonestDefer && allowed.includes('honest_boundary_defer')) {
      matched.push('honest_boundary_defer');
      reasons.push('检测到高不确定性/跨行业复杂需求，触发「坦诚划界与验证后置」');
    }
    if (matched.length === 0 || analysis.abstractness !== 'low') {
      if (allowed.includes('scene_restoration_probe')) {
        matched.push('scene_restoration_probe');
        reasons.push('痛点细节尚不完整，触发「场景还原追问」获取输入/步骤/期望/实际四要素');
      }
    }
  } else if (targetStage === 'S2') {
    if (analysis.contradiction && allowed.includes('paraphrase_loop_confirm')) {
      matched.push('paraphrase_loop_confirm');
      reasons.push('检测到前后表述矛盾，触发「复述闭环确认」对齐事实');
    }
    if (
      (analysis.needsEngineeringTriage ||
        analysis.rootCauseIdentified === 'engineering' ||
        analysis.rootCauseIdentified === 'ai_architecture') &&
      allowed.includes('ai_vs_engineering_triage')
    ) {
      matched.push('ai_vs_engineering_triage');
      reasons.push('检测到常规软件工程或AI架构失配问题，触发「AI与常规工程分诊」避免拿AI杀鸡');
    }
    if (allowed.includes('root_cause_distinction')) {
      matched.push('root_cause_distinction');
      reasons.push('处于 S2 根因分析阶段，触发「根因深挖区分」区分人/常规工程/AI架构/流程归属');
    }
  } else if (targetStage === 'S3') {
    if (analysis.needsSampleAnchor && allowed.includes('prototype_and_sample_anchor')) {
      matched.push('prototype_and_sample_anchor');
      reasons.push('客户关注改造方式/验证路径，触发「脱敏样例与存量改造锚定」');
    }
    matched.push('boundary_constraints_confirm');
    const missing = getMissingBoundaries(boundaries).map((m) => m.label);
    reasons.push(
      missing.length > 0
        ? `处于 S3 边界确认阶段，尚缺 ${missing.join('、')}，触发「边界约束确认」`
        : '关键边界核对中，确认无遗漏约束'
    );
  } else if (targetStage === 'S4') {
    if (analysis.contradiction && allowed.includes('paraphrase_loop_confirm')) {
      matched.push('paraphrase_loop_confirm');
      reasons.push('收敛前存在歧义，触发「复述闭环确认」');
    }
    if (analysis.needsHonestDefer && allowed.includes('honest_boundary_defer')) {
      matched.push('honest_boundary_defer');
      reasons.push('存在高复杂度/待验证项，触发「坦诚划界与验证后置」切分一二期');
    }
    if (allowed.includes('pain_point_convergence')) {
      matched.push('pain_point_convergence');
      reasons.push('处于 S4 痛点收敛阶段，触发「痛点验证收口」请客户排优先级');
    }
  } else if (targetStage === 'S5') {
    if (analysis.needsEngineeringTriage && allowed.includes('ai_vs_engineering_triage')) {
      matched.push('ai_vs_engineering_triage');
      reasons.push('方案阶段触发「AI与常规工程分诊」，拆清代码逻辑与Agent能力边界');
    }
    if (analysis.needsHonestDefer && allowed.includes('honest_boundary_defer')) {
      matched.push('honest_boundary_defer');
      reasons.push('方案阶段触发「坦诚划界与验证后置」，不硬包未验证难题');
    }
    if (analysis.needsSampleAnchor && allowed.includes('prototype_and_sample_anchor')) {
      matched.push('prototype_and_sample_anchor');
      reasons.push('方案阶段触发「脱敏样例与存量改造锚定」，先小步试跑不推倒重来');
    }
    if (analysis.needsTechTranslation && allowed.includes('tech_concept_translation')) {
      matched.push('tech_concept_translation');
      reasons.push('涉及技术概念，触发「技术概念降维翻译」（发动机/汽油/改装件比喻库）');
    }
    if (allowed.includes('stage_progression_control')) {
      matched.push('stage_progression_control');
      reasons.push('处于 S5 方案探讨阶段，触发「阶段推进控制」围绕高优痛点对齐方案与下一步行动');
    }
  }

  // Safety guarantee: every matched skill must be allowed in targetStage
  const filtered = Array.from(new Set(matched)).filter((s) => isSkillAllowedInStage(s, targetStage));
  if (filtered.length === 0) {
    filtered.push(allowed[0]);
  }

  return {
    nextStage: targetStage,
    matchedSkills: filtered,
    rationale: reasons.join('；') || `按 ${targetStage} 阶段目标匹配 ${SKILL_MAP[filtered[0]].name}`,
  };
}

export function computeRiskTags(
  stage: StageCode,
  analysis: SixDimensionAnalysis,
  boundaries: BoundaryConstraints
): RiskTag[] {
  const tags: RiskTag[] = [];

  if (analysis.offTopic) {
    tags.push({
      code: 'SOLUTION_FIRST_RISK',
      label: '方案先行风险',
      level: 'high',
      reason: '客户在业务痛点与边界未收敛前讨论技术/模型选型，易导致方案跑偏。',
    });
  }
  if (analysis.vagueGrandDemand) {
    tags.push({
      code: 'VAGUE_SCOPE_RISK',
      label: '范围过大/需求空泛',
      level: 'high',
      reason: '需求过于宏大抽象，切忌直接承诺，需收敛到单一真实场景。',
    });
  }
  if (analysis.contradiction) {
    tags.push({
      code: 'CONTRADICTION_RISK',
      label: '口径矛盾需澄清',
      level: 'high',
      reason: analysis.contradictionDetail || '客户前后表述存在矛盾，建议立即复述确认。',
    });
  }
  if (analysis.needsEngineeringTriage || analysis.rootCauseIdentified === 'engineering') {
    tags.push({
      code: 'ENGINEERING_NOT_AI',
      label: '先辨常规工程/AI架构',
      level: 'medium',
      reason: '该问题可能属于普通代码逻辑（如快照对比/超时限制）或AI用法不对，勿盲目堆大模型。',
    });
  }
  if (analysis.needsHonestDefer) {
    tags.push({
      code: 'HIGH_UNCERTAINTY_SCOPE',
      label: '高复杂度需验证后置',
      level: 'high',
      reason: '涉及历史脏数据语义清洗或跨行业图谱等不确定需求，切忌硬包承诺，建议放二期验证。',
    });
  }
  if (analysis.abstractness === 'high' && !analysis.vagueGrandDemand) {
    tags.push({
      code: 'ABSTRACT_FEEDBACK',
      label: '描述空泛缺现场',
      level: 'medium',
      reason: '缺少具体操作画面（文件、步骤、期望与实际差异），需追问还原。',
    });
  }
  if (analysis.emotion === 'frustrated' || analysis.emotion === 'skeptical') {
    tags.push({
      code: 'CUSTOMER_EMOTION',
      label: analysis.emotion === 'frustrated' ? '客户情绪焦躁' : '客户存在疑虑',
      level: 'medium',
      reason: '注意先共情认可痛点，再逐步引导追问。',
    });
  }
  const missing = getMissingBoundaries(boundaries);
  if ((stage === 'S3' || stage === 'S4') && missing.length > 0) {
    tags.push({
      code: 'MISSING_BOUNDARIES',
      label: `缺失${missing.length}项边界约束`,
      level: stage === 'S4' ? 'high' : 'medium',
      reason: `尚未确认：${missing.map((m) => m.label).join('、')}`,
    });
  }
  if (tags.length === 0) {
    tags.push({
      code: 'ON_TRACK',
      label: '节奏正常',
      level: 'low',
      reason: `当前处于 ${stage}（${STAGE_DEFINITIONS[stage].name}），可按推荐话术稳步推进。`,
    });
  }

  return tags;
}

export function deterministicGenerateQuestions(
  stage: StageCode,
  matchedSkills: SkillId[],
  analysis: SixDimensionAnalysis,
  checkpoint: GroupCheckpoint,
  boundaries: BoundaryConstraints,
  avoidQuestions: string[] = []
): { primaryQuestion: string; alternativeQuestions: string[] } {
  const primarySkill = matchedSkills[0];
  const missingBoundaries = getMissingBoundaries(boundaries);
  const painTitles = checkpoint.painPoints.map((p) => p.title);
  const latestPain = painTitles[painTitles.length - 1] || '刚才提到的业务卡点';

  let candidates: string[] = [];

  switch (primarySkill) {
    case 'interrupt_solution_first':
      candidates = [
        '先不聊模型方案，现在业务上最卡壳的是哪一步？',
        '抛开工具不谈，团队每天最耗人力的事是什么？',
        '技术选型后面定，您最想先解决哪个具体麻烦？',
        '现在业务流程里，最容易出错或返工的是哪儿？',
      ];
      break;
    case 'vague_demand_redirect':
      candidates = [
        '这个范围太大，先切一个明天最想解决的单点场景？',
        '一期如果只打透一个高频动作，您最先选哪个？',
        '能拿昨天最耗人工的一件具体小事举例吗？',
        '哪个部门的哪一步最痛，咱们先从那一点切入？',
      ];
      break;
    case 'scene_restoration_probe':
      candidates =
        stage === 'S0'
          ? [
              '能拿最近一单业务举例，平时大概怎么流转？',
              '这块业务里，目前最耗人工的是哪一步？',
              '平时输入什么材料，最后要交付什么结果？',
              '新人上手这项工作，最容易卡在哪一环？',
            ]
          : [
              '能还原下具体操作：上传什么、点哪步、卡在哪？',
              '拿昨天的一单举例，期望出什么、实际出来什么？',
              '这一步现在靠人工补救大概要花多长时间？',
              '上下游衔接还有哪儿要手工复制粘贴？',
            ];
      break;
    case 'root_cause_distinction':
      candidates = [
        `「${latestPain}」主要是系统做不到，还是流程或人的问题？`,
        '如果只换工具不改审批流程，这问题能解决几成？',
        '大家最常抱怨的是系统缺功能，还是规则没统一？',
        '这里面有没有历史数据质量或填报口径的问题？',
      ];
      break;
    case 'ai_vs_engineering_triage':
      candidates = [
        '这块其实写常规状态对比就行，不用硬上AI？',
        '现在跑得慢是OCR耗太久，还是规则塞一条prompt了？',
        '原系统是接口超时了，还是底层没接Agent拆分步骤？',
        '如果先把工程逻辑改对，真正需要AI判断的是哪一步？',
      ];
      break;
    case 'honest_boundary_defer':
      candidates = [
        '这块脏数据清洗没做过，先放二期小样例验证行吗？',
        '这项跨领域需求复杂度高，一期先不打包可以吗？',
        '我们坦诚说得先拿真实数据跑一遍，不贸然承诺？',
        '一期先保确定见效的痛点，这块列为二期调研项？',
      ];
      break;
    case 'prototype_and_sample_anchor':
      candidates = [
        '不推倒重来，就在您现有界面里嵌一层改造行吗？',
        '不用大训练数据，能先给3-5份脱敏样例试跑吗？',
        '现有系统不动前端，只把慢的解析引擎换掉行吗？',
        '我们先拿20份真实单据跑个小原型看效果行吗？',
      ];
      break;
    case 'paraphrase_loop_confirm':
      candidates = [
        analysis.contradictionDetail
          ? `确认下冲突点：${analysis.contradictionDetail.slice(0, 18)}，以哪个为准？`
          : `复述确认下：核心痛点是「${latestPain}」，对吗？`,
        '刚才两个要求如果不能兼得，您优先保哪一边？',
        '我刚记下的核心结论您看有没有理解偏？',
        '这两处口径我们落地时统一按哪边执行？',
      ];
      break;
    case 'boundary_constraints_confirm': {
      const missingText =
        missingBoundaries.length > 0
          ? missingBoundaries.slice(0, 3).map((m) => m.label).join('、')
          : '数据、网络、数据量、终端、保密';
      candidates = [
        `先核对硬边界（${missingText}）：数据在哪，纯内网吗？`,
        '存量和日均数据量多大？员工用电脑还是手机？',
        '数据是否要求绝对不出内网？保密等级是什么？',
        '日常使用人数大概多少，主要从哪个系统入口进？',
      ];
      break;
    }
    case 'pain_point_convergence': {
      const summaryList =
        painTitles.length > 0 ? painTitles.slice(0, 2).join('、') : '核心痛点';
      candidates = [
        `梳理了「${summaryList}」，一期只能先做1个您怎么排？`,
        '结合刚确认的边界，哪个痛点上线见效最快？',
        '一期先闭环 P0 痛点、二期再扩，符合预期吗？',
        '一期验收您最看重耗时缩短还是准确率提升？',
      ];
      break;
    }
    case 'tech_concept_translation': {
      candidates = [
        '打个比方：大模型是汽油，Agent是发动机，Skill是改装件。',
        '单次问答就像只给油没装车，换成Agent多轮核验才稳。',
        '内网部署就是把车和油锁在自家园区跑，数据不出门。',
        '这种运行方式您觉得贴合咱们的合规边界吗？',
      ];
      break;
    }
    case 'stage_progression_control':
    default:
      candidates = [
        '痛点和边界都齐了，接下来直接聊解决思路行吗？',
        '下周方便选20份脱敏样例做一次快速验证吗？',
        '下次方案评审还需要拉上信息中心或合规老师吗？',
        '稍后我发份结构化纪要给您核对，还有补充吗？',
      ];
      break;
  }

  // Deduplicate against previously asked questions using cosine similarity
  const filtered = candidates.filter((q) => {
    const qVec = computeTextEmbedding(q);
    return !avoidQuestions.some((asked) => cosineSimilarity(qVec, computeTextEmbedding(asked)) > 0.84);
  });

  const pool = filtered.length >= 3 ? filtered : candidates;
  return {
    primaryQuestion: pool[0],
    alternativeQuestions: pool.slice(1, 4), // 2-3 alternatives (always within 2-4)
  };
}

/**
 * Self-Validator (Section 3.3 Step 7):
 * Checks: (1) Stage violation (skipping stage or pitching solution before S5),
 * (2) Duplicate question against checkpoint.askedQuestions,
 * (3) Risk rule violations (e.g., promising implementation / pricing / model selection before S5).
 */
export function validateQuestionCardCandidate(params: {
  previousStage: StageCode;
  nextStage: StageCode;
  primaryQuestion: string;
  alternativeQuestions: string[];
  matchedSkills: SkillId[];
  askedQuestions: string[];
  boundaries: BoundaryConstraints;
}): Omit<ValidationResult, 'attempts'> {
  const issues: string[] = [];
  let stageViolation = false;
  let duplicateDetected = false;
  let riskRuleTriggered = false;

  // 1. Strict S0->S5 ordered transition (no skipping)
  if (!isValidStageTransition(params.previousStage, params.nextStage)) {
    stageViolation = true;
    issues.push(`阶段越级：不允许从 ${params.previousStage} 直接跳至 ${params.nextStage}`);
  }

  // 2. Skill must be permitted in nextStage
  for (const sk of params.matchedSkills) {
    if (!isSkillAllowedInStage(sk, params.nextStage)) {
      stageViolation = true;
      issues.push(`越阶段调用 Skill：${sk} 不允许在 ${params.nextStage} 使用`);
    }
  }

  // 3. No premature technical solution pitching before S5
  const prematureSolutionPattern = /(推荐您用|我们可以用.*模型|直接上rag|建议做微调|报价大概|架构方案如下)/i;
  if (params.nextStage !== 'S5' && prematureSolutionPattern.test(params.primaryQuestion)) {
    riskRuleTriggered = true;
    issues.push(`违反原则1（拒绝方案先行）：在 ${params.nextStage} 阶段过早输出技术方案`);
  }

  // 4. Cannot enter S5 if boundaries are still incomplete when coming from S3/S4
  if (params.nextStage === 'S5' && !areAllBoundariesConfirmed(params.boundaries)) {
    const missing = getMissingBoundaries(params.boundaries);
    if (missing.length >= 4) {
      riskRuleTriggered = true;
      issues.push(`违反原则4（边界前置确认）：尚缺失 ${missing.length} 项关键边界即进入 S5`);
    }
  }

  // 5. Duplicate check against historical asked questions
  const primaryVec = computeTextEmbedding(params.primaryQuestion);
  for (const prev of params.askedQuestions.slice(-15)) {
    if (cosineSimilarity(primaryVec, computeTextEmbedding(prev)) > 0.88) {
      duplicateDetected = true;
      issues.push('主问题与历史已推送问题高度重复');
      break;
    }
  }

  // 6. Alternative questions count must be 2..4
  if (params.alternativeQuestions.length < 2 || params.alternativeQuestions.length > 4) {
    issues.push(`备选问题数量应为 2-4 条，当前为 ${params.alternativeQuestions.length} 条`);
  }

  return {
    passed: issues.length === 0,
    issues,
    stageViolation,
    duplicateDetected,
    riskRuleTriggered,
  };
}

export function mergeCheckpointState(
  prev: GroupCheckpoint,
  nextStage: StageCode,
  analysis: SixDimensionAnalysis,
  primaryQuestion: string,
  latestSeq: number,
  recentSegments: TranscriptSegment[]
): GroupCheckpoint {
  const mergedBoundaries: BoundaryConstraints = {
    dataLocation: analysis.extractedBoundaries.dataLocation ?? prev.boundaries.dataLocation,
    networkType: analysis.extractedBoundaries.networkType ?? prev.boundaries.networkType,
    dataVolume: analysis.extractedBoundaries.dataVolume ?? prev.boundaries.dataVolume,
    terminalType: analysis.extractedBoundaries.terminalType ?? prev.boundaries.terminalType,
    confidentiality: analysis.extractedBoundaries.confidentiality ?? prev.boundaries.confidentiality,
    historicalDataStatus:
      analysis.extractedBoundaries.historicalDataStatus ?? prev.boundaries.historicalDataStatus ?? null,
    systemConstraints:
      analysis.extractedBoundaries.systemConstraints ?? prev.boundaries.systemConstraints ?? null,
  };

  // Merge pain points without duplicates by title
  const painMap = new Map<string, PainPointItem>();
  for (const existing of prev.painPoints) {
    painMap.set(existing.title, { ...existing });
  }
  for (const ep of analysis.extractedPainPoints) {
    const cur = painMap.get(ep.title);
    if (cur) {
      cur.description = ep.description.length > cur.description.length ? ep.description : cur.description;
      if (ep.rootCauseCategory !== 'unknown') {
        cur.rootCauseCategory = ep.rootCauseCategory;
      }
      if (nextStage === 'S4' || nextStage === 'S5') {
        cur.confirmed = true;
      }
    } else {
      painMap.set(ep.title, {
        id: `pp_${crypto.randomUUID().slice(0, 8)}`,
        title: ep.title,
        description: ep.description,
        rootCauseCategory: ep.rootCauseCategory,
        priority: null,
        confirmed: nextStage === 'S4' || nextStage === 'S5',
      });
    }
  }

  // If root cause identified in S2, apply to latest pain point if unknown
  const painPoints = Array.from(painMap.values());
  if (analysis.rootCauseIdentified !== 'unknown' && painPoints.length > 0) {
    const lastUnknown = [...painPoints].reverse().find((p) => p.rootCauseCategory === 'unknown');
    if (lastUnknown) {
      lastUnknown.rootCauseCategory = analysis.rootCauseIdentified;
    }
  }
  // Assign priorities when advancing to S5
  if (nextStage === 'S5') {
    painPoints.forEach((p, idx) => {
      if (p.priority == null) p.priority = idx + 1;
      p.confirmed = true;
    });
  }

  // Unconfirmed items derived from missing boundaries & unresolved contradictions
  const unconfirmedSet = new Set<string>();
  for (const m of getMissingBoundaries(mergedBoundaries)) {
    unconfirmedSet.add(`边界待确认：${m.label}`);
  }
  if (analysis.contradiction && analysis.contradictionDetail) {
    unconfirmedSet.add(`矛盾待澄清：${analysis.contradictionDetail}`);
  }
  if (painPoints.some((p) => p.rootCauseCategory === 'unknown')) {
    unconfirmedSet.add('部分痛点尚未明确根因归属（人/系统/流程）');
  }

  const confirmedItems = new Set<string>(prev.confirmedItems);
  if (mergedBoundaries.dataLocation) confirmedItems.add(`数据位置：${mergedBoundaries.dataLocation}`);
  if (mergedBoundaries.networkType) confirmedItems.add(`网络环境：${mergedBoundaries.networkType}`);
  if (mergedBoundaries.dataVolume) confirmedItems.add(`数据量级：${mergedBoundaries.dataVolume}`);
  if (mergedBoundaries.terminalType) confirmedItems.add(`使用终端：${mergedBoundaries.terminalType}`);
  if (mergedBoundaries.confidentiality) confirmedItems.add(`保密要求：${mergedBoundaries.confidentiality}`);
  if (mergedBoundaries.historicalDataStatus) confirmedItems.add(`历史数据与样例：${mergedBoundaries.historicalDataStatus}`);
  if (mergedBoundaries.systemConstraints) confirmedItems.add(`现网系统限制：${mergedBoundaries.systemConstraints}`);

  const stageGoalProgress =
    nextStage !== prev.currentStage
      ? 20
      : Math.min(100, Math.max(prev.stageGoalProgress, analysis.stageGoalMet ? 95 : analysis.painPointClarity));

  const newTexts = recentSegments
    .filter((s) => s.seq > prev.lastAnalyzedSeq)
    .map((s) => s.text);
  const rollingSummary = updateRollingSummary(
    prev.rollingSummary,
    newTexts.length > 0 ? newTexts : analysis.summaryDelta ? [analysis.summaryDelta] : []
  );

  const askedQuestions = [...prev.askedQuestions, primaryQuestion].slice(-30);

  return {
    ...prev,
    currentStage: nextStage,
    stageGoalProgress,
    painPoints,
    boundaries: mergedBoundaries,
    confirmedItems: Array.from(confirmedItems),
    unconfirmedItems: Array.from(unconfirmedSet),
    askedQuestions,
    rollingSummary,
    lastAnalyzedSeq: Math.max(prev.lastAnalyzedSeq, latestSeq),
    updatedAt: Date.now(),
    version: prev.version + 1,
  };
}

export function buildSummaryMarkdown(summary: Omit<MeetingSummary, 'markdown'>, groupName: string): string {
  const b = summary.confirmedBoundaries;
  const lines = [
    `# 售前沟通纪要 — ${groupName}`,
    '',
    `> 生成时间：${new Date(summary.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 一、沟通纪要总览',
    summary.minutes,
    '',
    '## 二、客户痛点清单',
    ...(summary.painPoints.length > 0
      ? summary.painPoints.map(
          (p, i) =>
            `${i + 1}. **${p.title}**${p.priority ? `（P${p.priority}）` : ''} — 根因归属：${p.rootCauseCategory}；描述：${p.description}`
        )
      : ['- 暂未提取到明确业务痛点，建议下轮继续场景还原追问。']),
    '',
    '## 三、已确认边界约束',
    `- **数据位置**：${b.dataLocation ?? '待确认'}`,
    `- **网络环境**：${b.networkType ?? '待确认'}`,
    `- **数据量级**：${b.dataVolume ?? '待确认'}`,
    `- **使用终端**：${b.terminalType ?? '待确认'}`,
    `- **保密要求**：${b.confidentiality ?? '待确认'}`,
    ...(b.historicalDataStatus ? [`- **历史数据与样例**：${b.historicalDataStatus}`] : []),
    ...(b.systemConstraints ? [`- **现网系统限制**：${b.systemConstraints}`] : []),
    '',
    '## 四、待确认事项',
    ...(summary.unconfirmedItems.length > 0
      ? summary.unconfirmedItems.map((item) => `- [ ] ${item}`)
      : ['- 全部关键项已确认']),
    '',
    '## 五、下一步行动建议',
    ...summary.nextActions.map((act, i) => `${i + 1}. ${act}`),
    '',
  ];
  return lines.join('\n');
}

export function deterministicGenerateSummary(params: {
  groupId: string;
  groupName: string;
  sessionId: string | null;
  checkpoint: GroupCheckpoint;
  segments: TranscriptSegment[];
}): MeetingSummary {
  const { groupId, groupName, sessionId, checkpoint, segments } = params;
  const stageDef = STAGE_DEFINITIONS[checkpoint.currentStage];
  const missing = getMissingBoundaries(checkpoint.boundaries);

  const minutesParts = [
    `本次与客户分组「${groupName}」累计完成 ${segments.length} 条现场语音转写记录，当前沟通推进至 **${checkpoint.currentStage} · ${stageDef.name}** 阶段。`,
    checkpoint.rollingSummary
      ? `核心沟通脉络：\n${checkpoint.rollingSummary}`
      : '本次会话尚处于初期信息采集阶段。',
  ];

  const nextActions: string[] = [];
  if (missing.length > 0) {
    nextActions.push(`下轮沟通优先补齐缺失的边界约束：${missing.map((m) => m.label).join('、')}。`);
  }
  if (checkpoint.painPoints.length === 0) {
    nextActions.push('安排业务一线访谈，通过场景还原追问（输入→步骤→期望→实际）锁定核心业务痛点。');
  } else if (checkpoint.currentStage === 'S5') {
    nextActions.push('围绕高优痛点准备 1-2 页轻量化方案与 POC 验证样例清单，约定下次评审时间。');
  } else {
    nextActions.push(`继续按状态机推进至下一阶段（当前 ${checkpoint.currentStage}），收敛痛点优先级后再展开技术方案。`);
  }
  nextActions.push('将本份结构化沟通纪要同步给客户方接口人进行复述确认，形成书面闭环。');

  const base: Omit<MeetingSummary, 'markdown'> = {
    id: `sum_${crypto.randomUUID().slice(0, 12)}`,
    groupId,
    sessionId,
    minutes: minutesParts.join('\n\n'),
    painPoints: checkpoint.painPoints,
    confirmedBoundaries: checkpoint.boundaries,
    unconfirmedItems: checkpoint.unconfirmedItems,
    nextActions,
    createdAt: Date.now(),
  };

  return {
    ...base,
    markdown: buildSummaryMarkdown(base, groupName),
  };
}
