import crypto from 'node:crypto';
import type { PresalesDatabase } from './db';
import type {
  IncomingSegmentPayload,
  SequenceIngestResult,
  TranscriptSegment,
} from './types';

/**
 * Handles customer-group transcript segment sequencing (Section 3.3 & 4.2):
 * - Deduplicates already-ingested sequence numbers.
 * - Buffers out-of-order future segments (空洞暂存) until missing preceding seqs arrive.
 * - Flushes contiguous buffered segments automatically in strict seq order.
 * - Supports multi-session continuation under the same customer group.
 */
export async function ingestOrderedSegments(
  db: PresalesDatabase,
  groupId: string,
  incoming: IncomingSegmentPayload[]
): Promise<SequenceIngestResult> {
  const group = await db.getGroup(groupId);
  if (!group) {
    throw new Error(`Customer group not found: ${groupId}`);
  }

  // Sort incoming batch by seq ascending for clean processing
  const sortedIncoming = [...incoming]
    .filter((item) => item.text && item.text.trim().length > 0 && Number.isInteger(item.seq) && item.seq >= 1)
    .sort((a, b) => a.seq - b.seq);

  let nextExpectedSeq = group.nextExpectedSeq;
  const acceptedSegments: TranscriptSegment[] = [];
  const acceptedSeqs: number[] = [];
  const duplicateSeqs: number[] = [];

  for (const item of sortedIncoming) {
    const now = Date.now();
    const seg: TranscriptSegment = {
      id: item.segmentId || `seg_${groupId}_${item.seq}_${crypto.randomUUID().slice(0, 6)}`,
      groupId,
      sessionId: item.sessionId || 'ses_default',
      seq: item.seq,
      text: item.text.trim(),
      originalText: null,
      edited: false,
      speakerLabel: item.speakerLabel ?? null,
      startedAt: item.startedAt ?? now,
      endedAt: item.endedAt ?? now,
      isFinal: item.isFinal ?? true,
      createdAt: now,
    };

    // Already accepted previously?
    if (seg.seq < nextExpectedSeq) {
      const exists = await db.hasSegmentSeq(groupId, seg.seq);
      if (exists) {
        duplicateSeqs.push(seg.seq);
        continue;
      }
      // Late backfill for an earlier seq if somehow missing
      await db.insertOrderedSegment(seg);
      acceptedSegments.push(seg);
      acceptedSeqs.push(seg.seq);
      continue;
    }

    if (seg.seq === nextExpectedSeq) {
      await db.insertOrderedSegment(seg);
      acceptedSegments.push(seg);
      acceptedSeqs.push(seg.seq);
      nextExpectedSeq += 1;

      // Flush any contiguous segments sitting in the gap buffer
      const buffered = await db.getGapBufferSegments(groupId);
      const flushedSeqs: number[] = [];
      for (const bufSeg of buffered) {
        if (bufSeg.seq === nextExpectedSeq) {
          await db.insertOrderedSegment(bufSeg);
          acceptedSegments.push(bufSeg);
          acceptedSeqs.push(bufSeg.seq);
          flushedSeqs.push(bufSeg.seq);
          nextExpectedSeq += 1;
        } else if (bufSeg.seq > nextExpectedSeq) {
          break;
        }
      }
      if (flushedSeqs.length > 0) {
        await db.deleteGapBufferSeqs(groupId, flushedSeqs);
      }
    } else {
      // Out of order (seq > nextExpectedSeq): park in gap buffer (空洞暂存)
      await db.putGapBufferSegment(seg);
    }
  }

  if (nextExpectedSeq !== group.nextExpectedSeq) {
    await db.updateGroup(groupId, { nextExpectedSeq });
  }

  const remainingBuffer = await db.getGapBufferSegments(groupId);
  const bufferedSeqs = remainingBuffer.map((b) => b.seq);

  return {
    groupId,
    acceptedSegments,
    acceptedSeqs,
    bufferedSeqs,
    duplicateSeqs,
    nextExpectedSeq,
  };
}
