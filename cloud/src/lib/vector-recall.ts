import type { GroupCheckpoint, TranscriptSegment } from './types';

const VECTOR_DIM = 128;

/**
 * Compute a deterministic lightweight semantic embedding using Chinese character
 * unigrams/bigrams and alphanumeric word tokens via feature hashing.
 * Runs locally with zero external API latency and supports offline/test execution.
 */
export function computeTextEmbedding(text: string): number[] {
  const vec = new Array<number>(VECTOR_DIM).fill(0);
  const normalized = text
    .toLowerCase()
    .replace(/[\s，。！？、；：“”‘’（）()【】\[\],.!?;:'"\-_]/g, ' ')
    .trim();

  if (!normalized) return vec;

  const tokens: string[] = [];
  // Word tokens (English/numbers)
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w.length > 0) tokens.push(w);
    // Chinese / CJK character bigrams and unigrams
    const chars = Array.from(w);
    for (let i = 0; i < chars.length; i++) {
      if (/[\u4e00-\u9fff]/.test(chars[i])) {
        tokens.push(chars[i]);
        if (i + 1 < chars.length && /[\u4e00-\u9fff]/.test(chars[i + 1])) {
          tokens.push(chars[i] + chars[i + 1]);
        }
      }
    }
  }

  for (const tok of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      hash ^= tok.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % VECTOR_DIM;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(5));
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface EmbeddedSegment {
  segment: TranscriptSegment;
  embedding: number[];
}

export interface LayeredContext {
  recentSegments: TranscriptSegment[];
  recalledSegments: TranscriptSegment[];
  rollingSummary: string;
  keySlotsText: string;
  formattedPromptContext: string;
  totalSegmentCount: number;
}

/**
 * Layered context injection (Section 3.3 & 4.2 & 10):
 * - Full raw transcript is archived in DB.
 * - Model receives: (1) Recent dialogue window, (2) Rolling summary,
 *   (3) Top-K vector-recalled historical segments outside the recent window,
 *   (4) Structured key slots (stage, pain points, confirmed/unconfirmed boundaries).
 */
export function assembleLayeredContext(
  allSegments: EmbeddedSegment[],
  checkpoint: GroupCheckpoint,
  options: { recentWindowSize?: number; recallTopK?: number } = {}
): LayeredContext {
  const recentWindowSize = options.recentWindowSize ?? 8;
  const recallTopK = options.recallTopK ?? 4;

  const sorted = [...allSegments].sort((a, b) => a.segment.seq - b.segment.seq);
  const recentEntries = sorted.slice(-recentWindowSize);
  const olderEntries = sorted.slice(0, Math.max(0, sorted.length - recentWindowSize));

  let recalledSegments: TranscriptSegment[] = [];
  if (olderEntries.length > 0 && recentEntries.length > 0) {
    const queryText = recentEntries
      .slice(-3)
      .map((e) => e.segment.text)
      .join(' ');
    const queryVec = computeTextEmbedding(queryText);

    recalledSegments = olderEntries
      .map((entry) => ({
        segment: entry.segment,
        score: cosineSimilarity(queryVec, entry.embedding),
      }))
      .filter((item) => item.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, recallTopK)
      .sort((a, b) => a.segment.seq - b.segment.seq)
      .map((item) => item.segment);
  }

  const b = checkpoint.boundaries;
  const keySlotsLines = [
    `当前阶段: ${checkpoint.currentStage} (完成度 ${checkpoint.stageGoalProgress}%)`,
    `已识别痛点 (${checkpoint.painPoints.length}个): ${
      checkpoint.painPoints.length > 0
        ? checkpoint.painPoints
            .map(
              (p, idx) =>
                `${idx + 1}. ${p.title} [归属:${p.rootCauseCategory}${p.priority ? `, P${p.priority}` : ''}]`
            )
            .join('；')
        : '暂无'
    }`,
    `五项边界状态: 数据位置=${b.dataLocation ?? '未确认'} | 网络=${b.networkType ?? '未确认'} | 数据量=${b.dataVolume ?? '未确认'} | 终端=${b.terminalType ?? '未确认'} | 保密=${b.confidentiality ?? '未确认'}`,
    `待确认事项: ${checkpoint.unconfirmedItems.length > 0 ? checkpoint.unconfirmedItems.join('；') : '无'}`,
    `已问过的问题数: ${checkpoint.askedQuestions.length}`,
  ];
  const keySlotsText = keySlotsLines.join('\n');

  const recentText = recentEntries
    .map((e) => `[#${e.segment.seq}${e.segment.edited ? '(已修正)' : ''}] ${e.segment.text}`)
    .join('\n');

  const recalledText =
    recalledSegments.length > 0
      ? recalledSegments.map((s) => `[#${s.seq}] ${s.text}`).join('\n')
      : '（无额外历史召回片段）';

  const formattedPromptContext = [
    '=== 关键槽位与状态快照 ===',
    keySlotsText,
    '',
    '=== 历史滚动摘要 ===',
    checkpoint.rollingSummary || '（尚无历史摘要）',
    '',
    '=== 向量召回的相关历史片段 ===',
    recalledText,
    '',
    '=== 近期实时转写对话 ===',
    recentText || '（暂无转写内容）',
  ].join('\n');

  return {
    recentSegments: recentEntries.map((e) => e.segment),
    recalledSegments,
    rollingSummary: checkpoint.rollingSummary,
    keySlotsText,
    formattedPromptContext,
    totalSegmentCount: sorted.length,
  };
}

export function updateRollingSummary(
  previousSummary: string,
  latestTexts: string[],
  maxLength = 600
): string {
  const addition = latestTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('；');
  if (!addition) return previousSummary;

  const combined = previousSummary ? `${previousSummary}\n- ${addition}` : `- ${addition}`;
  if (combined.length <= maxLength) return combined;

  // Keep the earliest anchor sentence and the most recent tail within budget
  const lines = combined.split('\n').filter(Boolean);
  if (lines.length <= 2) {
    return combined.slice(-maxLength);
  }
  const head = lines[0].slice(0, 140);
  let tail = '';
  for (let i = lines.length - 1; i >= 1; i--) {
    const candidate = tail ? `${lines[i]}\n${tail}` : lines[i];
    if (head.length + candidate.length + 12 > maxLength) break;
    tail = candidate;
  }
  return `${head}\n...(已压缩)...\n${tail}`;
}
