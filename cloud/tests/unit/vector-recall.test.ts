import { describe, expect, it } from 'vitest';
import {
  assembleLayeredContext,
  computeTextEmbedding,
  cosineSimilarity,
  updateRollingSummary,
  type EmbeddedSegment,
} from '@/lib/vector-recall';
import { createInitialCheckpoint } from '@/lib/db';

describe('Layered Context Injection & Vector Recall', () => {
  it('computes higher similarity for semantically overlapping Chinese sentences', () => {
    const v1 = computeTextEmbedding('法务部门每天审核供应商合同条款非常耗时');
    const v2 = computeTextEmbedding('合同条款人工审核容易漏掉风险点');
    const v3 = computeTextEmbedding('公司食堂午饭排长队菜品太咸');

    expect(cosineSimilarity(v1, v2)).toBeGreaterThan(cosineSimilarity(v1, v3));
  });

  it('assembles recent window + vector-recalled historical segments outside window', () => {
    const texts = [
      '今天开场先聊下我们法务合同审核的痛点，合同条款比对每次要两小时',
      '公司总部在上海，有三个分公司',
      '去年上线了一套考勤打卡系统',
      '物业报修平时走微信群沟通',
      '行政采购办公用品每周五汇总',
      '会议室预订有时会冲突',
      '财务报销发票目前用扫码枪',
      '人力资源招聘简历筛选用邮箱',
      '客服热线每天接听两百通电话',
      'IT运维工单主要靠内网论坛',
      '研发部门使用 GitLab 管理代码',
      '刚刚回到最关键的问题：法务合同审核的条款比对到底能不能自动标出风险？',
    ];

    const embedded: EmbeddedSegment[] = texts.map((text, i) => ({
      segment: {
        id: `seg_${i + 1}`,
        groupId: 'grp_vec',
        sessionId: 'ses_1',
        seq: i + 1,
        text,
        originalText: null,
        edited: false,
        speakerLabel: null,
        startedAt: Date.now() + i * 1000,
        endedAt: Date.now() + i * 1000,
        isFinal: true,
        createdAt: Date.now() + i * 1000,
      },
      embedding: computeTextEmbedding(text),
    }));

    const cp = createInitialCheckpoint('grp_vec', '测试企业', '法务');
    cp.rollingSummary = '- 客户介绍了法务合同审核等业务背景';

    const layered = assembleLayeredContext(embedded, cp, { recentWindowSize: 5, recallTopK: 2 });
    expect(layered.recentSegments).toHaveLength(5);
    expect(layered.recentSegments[0].seq).toBe(8);
    // Segment #1 (about 法务合同审核条款) should be recalled from older history!
    expect(layered.recalledSegments.some((s) => s.seq === 1)).toBe(true);
    expect(layered.formattedPromptContext).toContain('关键槽位与状态快照');
    expect(layered.formattedPromptContext).toContain('向量召回的相关历史片段');
  });

  it('compresses rolling summary within budget without losing anchor', () => {
    let summary = '';
    for (let i = 1; i <= 25; i++) {
      summary = updateRollingSummary(summary, [`第${i}轮沟通记录：客户详细说明了审批单据和合同核对中的异常情况与耗时统计`], 350);
    }
    expect(summary.length).toBeLessThanOrEqual(360);
    expect(summary).toContain('第1轮');
    expect(summary).toContain('第25轮');
  });
});
