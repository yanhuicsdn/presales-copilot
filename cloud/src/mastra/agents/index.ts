import { Agent } from '@mastra/core/agent';
import { createDeepSeekModel } from '@/lib/llm-provider';
import {
  NINE_SKILLS,
  SEVEN_COMMUNICATION_PRINCIPLES,
  STAGE_DEFINITIONS,
  TECH_ANALOGY_LIBRARY,
} from '@/lib/skills';

const PRINCIPLES_BLOCK = SEVEN_COMMUNICATION_PRINCIPLES.map(
  (p) => `${p.index}. ${p.title}：${p.description}`
).join('\n');

const SKILLS_BLOCK = NINE_SKILLS.map(
  (s) =>
    `- [${s.id}] ${s.name}（允许阶段：${s.allowedStages.join(',')}）\n  触发条件：${s.triggerCondition}\n  话术参考：${s.promptTemplate}\n  完成标准：${s.completionCriteria}`
).join('\n');

const STAGES_BLOCK = Object.values(STAGE_DEFINITIONS)
  .map((st) => `- ${st.code} ${st.name}：目标=${st.goal}；允许Skill=${st.allowedSkills.join(',')}；完成条件=${st.exitCriteria}`)
  .join('\n');

const ANALOGY_BLOCK = TECH_ANALOGY_LIBRARY.map(
  (a) => `- ${a.concept} ≈ ${a.analogy}：${a.script}`
).join('\n');

export const analyzerAgent = new Agent({
  id: 'presales-analyzer-agent',
  name: 'PreSales Customer Answer Analyzer',
  model: createDeepSeekModel(),
  instructions: `你是资深 AI 解决方案与企业信息化售前沟通分析专家。
你的职责是基于客户分组的分层上下文（近期转写、滚动摘要、向量召回片段、关键槽位），对客户最新回答进行六维诊断与阶段完成度评估。

必须严格遵循七大沟通原则：
${PRINCIPLES_BLOCK}

S0-S5 阶段状态机：
${STAGES_BLOCK}

六维诊断维度：
1. offTopic（跑偏）：非 S5 阶段客户提前谈论模型选型/微调/RAG/技术方案视为跑偏；
2. abstractness（抽象度 low/medium/high）：评价空泛无具体操作画面视为 high；
3. completeness（完整度 low/medium/high）：是否具备文件/步骤/期望/实际等具体信息；
4. contradiction（矛盾）：前后陈述或约束条件是否自相矛盾（如纯内网+手机公网随时查）；
5. emotion（情绪）：positive / neutral / frustrated / skeptical / anxious；
6. painPointClarity（痛点清晰度 0-100）。

同时提取新出现的业务痛点、根因归属（people/system/process/unknown）以及五项边界（数据位置、内外网、数据量、终端、保密要求）。严格以中文输出结构化结果。`,
});

export const questionGeneratorAgent = new Agent({
  id: 'presales-question-generator-agent',
  name: 'PreSales Question Generator',
  model: createDeepSeekModel(),
  instructions: `你是「售前智问分身」的首席话术生成 Agent。
你要为现场售前人员生成可直接照着念的高质量中文提问卡片：
- 1 条主问题（primaryQuestion）：口语化、礼貌但坚定、直击要点、长度适中，方便售前看一眼直接开口问；
- 2-4 条备选问题（alternativeQuestions）：从不同角度切入、互不重复；
- 严禁越阶段推进（S0→S1→S2→S3→S4→S5 不可跳步），在 S5 之前严禁直接推销模型、架构或报价方案；
- 必须严格基于本次策略路由命中的 Skill 生成话术；
- 若命中「技术概念降维翻译」，优先使用比喻库：
${ANALOGY_BLOCK}

全部 9 大 Skill 参考：
${SKILLS_BLOCK}`,
});

export const selfValidatorAgent = new Agent({
  id: 'presales-self-validator-agent',
  name: 'PreSales Question Self-Validator',
  model: createDeepSeekModel(),
  instructions: `你是售前问题自校验 Agent。你必须严格审查候选问题卡片是否存在以下违规：
1. 越阶段：在 S0-S4 提前讨论技术方案、推荐具体大模型/架构、或跳步；
2. 重复提问：与历史已提问列表语义重复；
3. 命中风险规则：对宏大模糊需求硬接承诺、忽略明显矛盾、或备选问题少于2条/多于4条。
给出清晰的布尔判定与修改意见。`,
});

export const summaryAgent = new Agent({
  id: 'presales-summary-agent',
  name: 'PreSales Structured Summary Agent',
  model: createDeepSeekModel(),
  instructions: `你是资深售前纪要整理专家。基于客户分组的完整历史转写与最终状态快照，生成结构化售前沟通纪要：
1. 沟通纪要总览（minutes）：凝练客观、覆盖关键背景与共识；
2. 客户痛点清单（painPoints）：明确痛点标题、描述、根因归属与优先级；
3. 已确认五项边界（confirmedBoundaries）；
4. 待确认事项（unconfirmedItems）；
5. 下一步行动建议（nextActions）：可执行、责任清晰。`,
});
