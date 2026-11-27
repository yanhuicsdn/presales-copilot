import crypto from 'node:crypto';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  buildSummaryMarkdown,
  deterministicGenerateSummary,
} from '@/lib/deterministic-engine';
import { isDeepSeekConfigured } from '@/lib/llm-provider';
import type { GroupCheckpoint, MeetingSummary, TranscriptSegment } from '@/lib/types';

const summaryLlmSchema = z.object({
  minutes: z.string().min(10),
  unconfirmedItems: z.array(z.string()),
  nextActions: z.array(z.string()).min(1),
});

const generateSummaryStep = createStep({
  id: 'generate-structured-summary',
  description: 'Generate structured meeting minutes, pain point list, confirmed boundaries, unconfirmed items, and next actions',
  inputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({
    summary: z.any(),
  }),
  execute: async ({ inputData, mastra }) => {
    const db = getDb();
    const group = await db.getGroup(inputData.groupId);
    if (!group) {
      throw new Error(`Customer group not found: ${inputData.groupId}`);
    }
    const checkpoint = (await db.getCheckpoint(inputData.groupId)) as GroupCheckpoint;
    const segments = (await db.getSegments(inputData.groupId)) as TranscriptSegment[];

    let summary: MeetingSummary = deterministicGenerateSummary({
      groupId: group.id,
      groupName: group.name,
      sessionId: inputData.sessionId ?? null,
      checkpoint,
      segments,
    });

    if (isDeepSeekConfigured() && segments.length > 0) {
      try {
        const agent = mastra.getAgent('summaryAgent');
        const transcriptExcerpt = segments
          .slice(-40)
          .map((s) => `[#${s.seq}] ${s.text}`)
          .join('\n');
        const prompt = `客户分组：${group.name}（公司：${group.customerCompany || '未填'}，行业：${group.industry || '未填'}）
当前阶段：${checkpoint.currentStage}
已识别痛点：${JSON.stringify(checkpoint.painPoints)}
已确认边界：${JSON.stringify(checkpoint.boundaries)}
待确认事项：${JSON.stringify(checkpoint.unconfirmedItems)}

历史转写摘要与近期原文：
${checkpoint.rollingSummary}

${transcriptExcerpt}

请输出高质量的结构化售前沟通纪要（minutes）、补充或精炼后的待确认事项（unconfirmedItems）以及具体可执行的下一步行动建议（nextActions）。`;

        const res = await agent.generate(prompt, {
          structuredOutput: { schema: summaryLlmSchema },
        });
        if (res.object) {
          const base: Omit<MeetingSummary, 'markdown'> = {
            id: `sum_${crypto.randomUUID().slice(0, 12)}`,
            groupId: group.id,
            sessionId: inputData.sessionId ?? null,
            minutes: res.object.minutes,
            painPoints: checkpoint.painPoints,
            confirmedBoundaries: checkpoint.boundaries,
            unconfirmedItems: res.object.unconfirmedItems,
            nextActions: res.object.nextActions,
            createdAt: Date.now(),
          };
          summary = {
            ...base,
            markdown: buildSummaryMarkdown(base, group.name),
          };
        }
      } catch (err) {
        console.warn('[Mastra summaryAgent] DeepSeek call failed, using deterministic summary:', err);
      }
    }

    await db.saveMeetingSummary(summary);
    return { summary };
  },
});

export const summaryWorkflow = createWorkflow({
  id: 'presales-summary-workflow',
  description: 'End-of-session structured minutes and action plan generator',
  inputSchema: z.object({
    groupId: z.string(),
    sessionId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({
    summary: z.any(),
  }),
})
  .then(generateSummaryStep)
  .commit();
