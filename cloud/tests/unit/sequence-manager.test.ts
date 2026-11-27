import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PresalesDatabase } from '@/lib/db';
import { ingestOrderedSegments } from '@/lib/sequence-manager';

describe('Sequence Manager: Out-of-order Reordering, Gap Buffer, Dedup & Edits', () => {
  let db: PresalesDatabase;
  let groupId: string;

  beforeEach(async () => {
    db = new PresalesDatabase('file::memory:');
    await db.init();
    const created = await db.createGroup({
      name: '某大型制造集团',
      customerCompany: '某制造集团',
      industry: '智能制造',
    });
    groupId = created.group.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('buffers out-of-order segments and flushes contiguously once missing seq arrives', async () => {
    // seq 1 arrives normally
    const r1 = await ingestOrderedSegments(db, groupId, [
      { sessionId: 'ses_1', seq: 1, text: '第一句开场白' },
    ]);
    expect(r1.acceptedSeqs).toEqual([1]);
    expect(r1.bufferedSeqs).toEqual([]);
    expect(r1.nextExpectedSeq).toBe(2);

    // seq 3 and seq 4 arrive before seq 2 (network jitter)
    const r2 = await ingestOrderedSegments(db, groupId, [
      { sessionId: 'ses_1', seq: 4, text: '第四句内容' },
      { sessionId: 'ses_1', seq: 3, text: '第三句内容' },
    ]);
    expect(r2.acceptedSeqs).toEqual([]);
    expect(r2.bufferedSeqs).toEqual([3, 4]);
    expect(r2.nextExpectedSeq).toBe(2);

    // seq 2 finally arrives -> flushes 2, 3, 4 in exact order!
    const r3 = await ingestOrderedSegments(db, groupId, [
      { sessionId: 'ses_1', seq: 2, text: '第二句内容' },
    ]);
    expect(r3.acceptedSeqs).toEqual([2, 3, 4]);
    expect(r3.bufferedSeqs).toEqual([]);
    expect(r3.nextExpectedSeq).toBe(5);

    const stored = await db.getSegments(groupId);
    expect(stored.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    expect(stored.map((s) => s.text)).toEqual(['第一句开场白', '第二句内容', '第三句内容', '第四句内容']);
  });

  it('deduplicates retransmitted segments and supports multi-session continuation', async () => {
    await ingestOrderedSegments(db, groupId, [
      { sessionId: 'ses_1', seq: 1, text: '第一次会议内容' },
      { sessionId: 'ses_1', seq: 2, text: '第一次会议中断前' },
    ]);

    // Resend seq 2 + continue with new session ses_2 at seq 3
    const r = await ingestOrderedSegments(db, groupId, [
      { sessionId: 'ses_1', seq: 2, text: '第一次会议中断前' },
      { sessionId: 'ses_2', seq: 3, text: '隔天第二次会议续接内容' },
    ]);
    expect(r.duplicateSeqs).toEqual([2]);
    expect(r.acceptedSeqs).toEqual([3]);
    expect(r.nextExpectedSeq).toBe(4);

    const all = await db.getSegments(groupId);
    expect(all).toHaveLength(3);
    expect(all[2].sessionId).toBe('ses_2');
  });

  it('supports manual transcript editing while preserving original text', async () => {
    const r = await ingestOrderedSegments(db, groupId, [
      { segmentId: 'seg_fix_1', sessionId: 'ses_1', seq: 1, text: '我们每天审核50份和同' },
    ]);
    expect(r.acceptedSegments[0].id).toBe('seg_fix_1');

    const edited = await db.editSegment(groupId, 'seg_fix_1', '我们每天审核50份合同');
    expect(edited).not.toBeNull();
    expect(edited!.edited).toBe(true);
    expect(edited!.text).toBe('我们每天审核50份合同');
    expect(edited!.originalText).toBe('我们每天审核50份和同');
  });
});
