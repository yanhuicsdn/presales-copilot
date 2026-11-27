import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { TWELVE_SKILLS } from './skills';
import { computeTextEmbedding, type EmbeddedSegment } from './vector-recall';
import type {
  CustomerGroup,
  GroupCheckpoint,
  MeetingSummary,
  QuestionCard,
  RecordingSession,
  SkillDefinition,
  TranscriptSegment,
} from './types';

function resolveDbUrl(): string {
  const raw = process.env.DATABASE_URL || 'file:./data/presales-copilot.db';
  if (raw.startsWith('file:') && raw !== 'file::memory:') {
    const filePath = raw.slice('file:'.length);
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    return `file:${absPath}`;
  }
  return raw;
}

export function createInitialCheckpoint(
  groupId: string,
  company?: string,
  industry?: string
): GroupCheckpoint {
  return {
    groupId,
    currentStage: 'S0',
    stageGoalProgress: 0,
    painPoints: [],
    boundaries: {
      dataLocation: null,
      networkType: null,
      dataVolume: null,
      terminalType: null,
      confidentiality: null,
      historicalDataStatus: null,
      systemConstraints: null,
    },
    confirmedItems: [],
    unconfirmedItems: [],
    askedQuestions: [],
    rollingSummary: '',
    lastAnalyzedSeq: 0,
    customerProfile: {
      company,
      industry,
      rolesMentioned: [],
      techMentions: [],
    },
    updatedAt: Date.now(),
    version: 1,
  };
}

export class PresalesDatabase {
  private client: Client;
  private initialized = false;
  public readonly dbUrl: string;

  constructor(dbUrl?: string) {
    this.dbUrl = dbUrl ?? resolveDbUrl();
    this.client = createClient({ url: this.dbUrl });
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS customer_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        customer_company TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        next_expected_seq INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recording_sessions (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'recording',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        segment_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        text TEXT NOT NULL,
        original_text TEXT,
        edited INTEGER NOT NULL DEFAULT 0,
        speaker_label TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 1,
        embedding_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(group_id, seq),
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS segment_gap_buffer (
        group_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        segment_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        text TEXT NOT NULL,
        speaker_label TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, seq),
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS group_checkpoints (
        group_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS question_cards (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        session_id TEXT,
        stage TEXT NOT NULL,
        card_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS meeting_summaries (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        session_id TEXT,
        summary_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS skill_configs (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_segments_group_seq ON transcript_segments(group_id, seq);
      CREATE INDEX IF NOT EXISTS idx_cards_group_time ON question_cards(group_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_summaries_group_time ON meeting_summaries(group_id, created_at);
    `);

    // Sync all 12 V3.0 FDE skills (idempotent upgrade from 9-skill DBs)
    const now = Date.now();
    for (const skill of TWELVE_SKILLS) {
      await this.client.execute({
        sql: 'INSERT OR REPLACE INTO skill_configs (id, config_json, updated_at) VALUES (?, ?, ?)',
        args: [skill.id, JSON.stringify(skill), now],
      });
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    this.client.close();
  }

  // ---- Customer Groups ----

  async createGroup(input: {
    id?: string;
    name: string;
    customerCompany?: string;
    industry?: string;
    notes?: string;
  }): Promise<{ group: CustomerGroup; checkpoint: GroupCheckpoint }> {
    await this.init();
    const now = Date.now();
    const id = input.id || `grp_${crypto.randomUUID().slice(0, 12)}`;
    const group: CustomerGroup = {
      id,
      name: input.name.trim(),
      customerCompany: (input.customerCompany || '').trim(),
      industry: (input.industry || '').trim(),
      notes: (input.notes || '').trim(),
      status: 'active',
      nextExpectedSeq: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.execute({
      sql: `INSERT INTO customer_groups (id, name, customer_company, industry, notes, status, next_expected_seq, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        group.id,
        group.name,
        group.customerCompany,
        group.industry,
        group.notes,
        group.status,
        group.nextExpectedSeq,
        group.createdAt,
        group.updatedAt,
      ],
    });

    const checkpoint = createInitialCheckpoint(group.id, group.customerCompany, group.industry);
    await this.saveCheckpoint(checkpoint);
    return { group, checkpoint };
  }

  async listGroups(): Promise<Array<CustomerGroup & { stage: string; segmentCount: number }>> {
    await this.init();
    const res = await this.client.execute(`
      SELECT g.*,
             c.state_json,
             (SELECT COUNT(*) FROM transcript_segments s WHERE s.group_id = g.id) AS seg_count
      FROM customer_groups g
      LEFT JOIN group_checkpoints c ON c.group_id = g.id
      ORDER BY g.updated_at DESC
    `);

    return res.rows.map((row) => {
      let stage = 'S0';
      if (row.state_json) {
        try {
          const parsed = JSON.parse(String(row.state_json)) as GroupCheckpoint;
          stage = parsed.currentStage;
        } catch {
          stage = 'S0';
        }
      }
      return {
        id: String(row.id),
        name: String(row.name),
        customerCompany: String(row.customer_company),
        industry: String(row.industry),
        notes: String(row.notes),
        status: String(row.status) as 'active' | 'archived',
        nextExpectedSeq: Number(row.next_expected_seq),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        stage,
        segmentCount: Number(row.seg_count ?? 0),
      };
    });
  }

  async getGroup(groupId: string): Promise<CustomerGroup | null> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT * FROM customer_groups WHERE id = ?',
      args: [groupId],
    });
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      customerCompany: String(row.customer_company),
      industry: String(row.industry),
      notes: String(row.notes),
      status: String(row.status) as 'active' | 'archived',
      nextExpectedSeq: Number(row.next_expected_seq),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async updateGroup(
    groupId: string,
    patch: Partial<Pick<CustomerGroup, 'name' | 'customerCompany' | 'industry' | 'notes' | 'status' | 'nextExpectedSeq'>>
  ): Promise<CustomerGroup | null> {
    await this.init();
    const existing = await this.getGroup(groupId);
    if (!existing) return null;
    const updated: CustomerGroup = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    await this.client.execute({
      sql: `UPDATE customer_groups
            SET name = ?, customer_company = ?, industry = ?, notes = ?, status = ?, next_expected_seq = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        updated.name,
        updated.customerCompany,
        updated.industry,
        updated.notes,
        updated.status,
        updated.nextExpectedSeq,
        updated.updatedAt,
        groupId,
      ],
    });
    return updated;
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    await this.init();
    await this.client.execute({ sql: 'DELETE FROM segment_gap_buffer WHERE group_id = ?', args: [groupId] });
    await this.client.execute({ sql: 'DELETE FROM transcript_segments WHERE group_id = ?', args: [groupId] });
    await this.client.execute({ sql: 'DELETE FROM question_cards WHERE group_id = ?', args: [groupId] });
    await this.client.execute({ sql: 'DELETE FROM meeting_summaries WHERE group_id = ?', args: [groupId] });
    await this.client.execute({ sql: 'DELETE FROM recording_sessions WHERE group_id = ?', args: [groupId] });
    await this.client.execute({ sql: 'DELETE FROM group_checkpoints WHERE group_id = ?', args: [groupId] });
    const res = await this.client.execute({ sql: 'DELETE FROM customer_groups WHERE id = ?', args: [groupId] });
    return (res.rowsAffected ?? 0) > 0;
  }

  // ---- Sessions ----

  async createOrUpdateSession(
    groupId: string,
    action: 'start' | 'pause' | 'resume' | 'end',
    sessionId?: string
  ): Promise<RecordingSession> {
    await this.init();
    const now = Date.now();
    const id = sessionId || `ses_${crypto.randomUUID().slice(0, 10)}`;

    const existing = await this.client.execute({
      sql: 'SELECT * FROM recording_sessions WHERE id = ?',
      args: [id],
    });

    if (existing.rows.length === 0) {
      const status = action === 'end' ? 'ended' : action === 'pause' ? 'paused' : 'recording';
      const session: RecordingSession = {
        id,
        groupId,
        status,
        startedAt: now,
        endedAt: action === 'end' ? now : null,
        segmentCount: 0,
      };
      await this.client.execute({
        sql: `INSERT INTO recording_sessions (id, group_id, status, started_at, ended_at, segment_count)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [session.id, session.groupId, session.status, session.startedAt, session.endedAt, 0],
      });
      return session;
    }

    const row = existing.rows[0];
    const nextStatus = action === 'end' ? 'ended' : action === 'pause' ? 'paused' : 'recording';
    const endedAt = action === 'end' ? now : row.ended_at ? Number(row.ended_at) : null;
    await this.client.execute({
      sql: 'UPDATE recording_sessions SET status = ?, ended_at = ? WHERE id = ?',
      args: [nextStatus, endedAt, id],
    });

    return {
      id,
      groupId: String(row.group_id),
      status: nextStatus,
      startedAt: Number(row.started_at),
      endedAt,
      segmentCount: Number(row.segment_count ?? 0),
    };
  }

  async listSessions(groupId: string): Promise<RecordingSession[]> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT * FROM recording_sessions WHERE group_id = ? ORDER BY started_at DESC',
      args: [groupId],
    });
    return res.rows.map((row) => ({
      id: String(row.id),
      groupId: String(row.group_id),
      status: String(row.status) as RecordingSession['status'],
      startedAt: Number(row.started_at),
      endedAt: row.ended_at != null ? Number(row.ended_at) : null,
      segmentCount: Number(row.segment_count ?? 0),
    }));
  }

  // ---- Transcript Segments & Gap Buffer ----

  async insertOrderedSegment(segment: TranscriptSegment): Promise<void> {
    await this.init();
    const embedding = computeTextEmbedding(segment.text);
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO transcript_segments
            (id, group_id, session_id, seq, text, original_text, edited, speaker_label, started_at, ended_at, is_final, embedding_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        segment.id,
        segment.groupId,
        segment.sessionId,
        segment.seq,
        segment.text,
        segment.originalText,
        segment.edited ? 1 : 0,
        segment.speakerLabel,
        segment.startedAt,
        segment.endedAt,
        segment.isFinal ? 1 : 0,
        JSON.stringify(embedding),
        segment.createdAt,
      ],
    });
    await this.client.execute({
      sql: 'UPDATE recording_sessions SET segment_count = segment_count + 1 WHERE id = ?',
      args: [segment.sessionId],
    });
  }

  async hasSegmentSeq(groupId: string, seq: number): Promise<boolean> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT 1 FROM transcript_segments WHERE group_id = ? AND seq = ? LIMIT 1',
      args: [groupId, seq],
    });
    return res.rows.length > 0;
  }

  async putGapBufferSegment(segment: TranscriptSegment): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO segment_gap_buffer
            (group_id, seq, segment_id, session_id, text, speaker_label, started_at, ended_at, is_final, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        segment.groupId,
        segment.seq,
        segment.id,
        segment.sessionId,
        segment.text,
        segment.speakerLabel,
        segment.startedAt,
        segment.endedAt,
        segment.isFinal ? 1 : 0,
        segment.createdAt,
      ],
    });
  }

  async getGapBufferSegments(groupId: string): Promise<TranscriptSegment[]> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT * FROM segment_gap_buffer WHERE group_id = ? ORDER BY seq ASC',
      args: [groupId],
    });
    return res.rows.map((row) => ({
      id: String(row.segment_id),
      groupId: String(row.group_id),
      sessionId: String(row.session_id),
      seq: Number(row.seq),
      text: String(row.text),
      originalText: null,
      edited: false,
      speakerLabel: row.speaker_label != null ? String(row.speaker_label) : null,
      startedAt: Number(row.started_at),
      endedAt: Number(row.ended_at),
      isFinal: Number(row.is_final) === 1,
      createdAt: Number(row.created_at),
    }));
  }

  async deleteGapBufferSeqs(groupId: string, seqs: number[]): Promise<void> {
    await this.init();
    for (const seq of seqs) {
      await this.client.execute({
        sql: 'DELETE FROM segment_gap_buffer WHERE group_id = ? AND seq = ?',
        args: [groupId, seq],
      });
    }
  }

  async getSegments(groupId: string): Promise<TranscriptSegment[]> {
    const embedded = await this.getEmbeddedSegments(groupId);
    return embedded.map((e) => e.segment);
  }

  async getEmbeddedSegments(groupId: string): Promise<EmbeddedSegment[]> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT * FROM transcript_segments WHERE group_id = ? ORDER BY seq ASC',
      args: [groupId],
    });
    return res.rows.map((row) => ({
      segment: {
        id: String(row.id),
        groupId: String(row.group_id),
        sessionId: String(row.session_id),
        seq: Number(row.seq),
        text: String(row.text),
        originalText: row.original_text != null ? String(row.original_text) : null,
        edited: Number(row.edited) === 1,
        speakerLabel: row.speaker_label != null ? String(row.speaker_label) : null,
        startedAt: Number(row.started_at),
        endedAt: Number(row.ended_at),
        isFinal: Number(row.is_final) === 1,
        createdAt: Number(row.created_at),
      },
      embedding: JSON.parse(String(row.embedding_json || '[]')) as number[],
    }));
  }

  async editSegment(groupId: string, segmentId: string, newText: string): Promise<TranscriptSegment | null> {
    await this.init();
    const existingRes = await this.client.execute({
      sql: 'SELECT * FROM transcript_segments WHERE group_id = ? AND id = ?',
      args: [groupId, segmentId],
    });
    const row = existingRes.rows[0];
    if (!row) return null;

    const originalText = row.original_text != null ? String(row.original_text) : String(row.text);
    const cleaned = newText.trim();
    const embedding = computeTextEmbedding(cleaned);

    await this.client.execute({
      sql: `UPDATE transcript_segments
            SET text = ?, original_text = ?, edited = 1, embedding_json = ?
            WHERE group_id = ? AND id = ?`,
      args: [cleaned, originalText, JSON.stringify(embedding), groupId, segmentId],
    });

    await this.client.execute({
      sql: 'UPDATE customer_groups SET updated_at = ? WHERE id = ?',
      args: [Date.now(), groupId],
    });

    return {
      id: String(row.id),
      groupId: String(row.group_id),
      sessionId: String(row.session_id),
      seq: Number(row.seq),
      text: cleaned,
      originalText,
      edited: true,
      speakerLabel: row.speaker_label != null ? String(row.speaker_label) : null,
      startedAt: Number(row.started_at),
      endedAt: Number(row.ended_at),
      isFinal: Number(row.is_final) === 1,
      createdAt: Number(row.created_at),
    };
  }

  // ---- Checkpoints ----

  async getCheckpoint(groupId: string): Promise<GroupCheckpoint | null> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT state_json FROM group_checkpoints WHERE group_id = ?',
      args: [groupId],
    });
    const row = res.rows[0];
    if (!row) return null;
    return JSON.parse(String(row.state_json)) as GroupCheckpoint;
  }

  async saveCheckpoint(checkpoint: GroupCheckpoint): Promise<void> {
    await this.init();
    const now = Date.now();
    const nextCheckpoint: GroupCheckpoint = {
      ...checkpoint,
      updatedAt: now,
    };
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO group_checkpoints (group_id, state_json, updated_at, version)
            VALUES (?, ?, ?, ?)`,
      args: [checkpoint.groupId, JSON.stringify(nextCheckpoint), now, nextCheckpoint.version],
    });
    await this.client.execute({
      sql: 'UPDATE customer_groups SET updated_at = ? WHERE id = ?',
      args: [now, checkpoint.groupId],
    });
  }

  // ---- Question Cards ----

  async saveQuestionCard(card: QuestionCard): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `INSERT INTO question_cards (id, group_id, session_id, stage, card_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [card.id, card.groupId, card.sessionId, card.stage, JSON.stringify(card), card.createdAt],
    });
  }

  async getQuestionCards(groupId: string, limit = 20): Promise<QuestionCard[]> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT card_json FROM question_cards WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [groupId, limit],
    });
    return res.rows.map((row) => JSON.parse(String(row.card_json)) as QuestionCard);
  }

  async getLatestQuestionCard(groupId: string): Promise<QuestionCard | null> {
    const cards = await this.getQuestionCards(groupId, 1);
    return cards[0] ?? null;
  }

  // ---- Meeting Summaries ----

  async saveMeetingSummary(summary: MeetingSummary): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `INSERT INTO meeting_summaries (id, group_id, session_id, summary_json, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [summary.id, summary.groupId, summary.sessionId, JSON.stringify(summary), summary.createdAt],
    });
  }

  async getLatestMeetingSummary(groupId: string): Promise<MeetingSummary | null> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT summary_json FROM meeting_summaries WHERE group_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [groupId],
    });
    const row = res.rows[0];
    if (!row) return null;
    return JSON.parse(String(row.summary_json)) as MeetingSummary;
  }

  async getMeetingSummaries(groupId: string): Promise<MeetingSummary[]> {
    await this.init();
    const res = await this.client.execute({
      sql: 'SELECT summary_json FROM meeting_summaries WHERE group_id = ? ORDER BY created_at DESC',
      args: [groupId],
    });
    return res.rows.map((row) => JSON.parse(String(row.summary_json)) as MeetingSummary);
  }

  // ---- Skill Configs ----

  async getSkillConfigs(): Promise<SkillDefinition[]> {
    await this.init();
    const res = await this.client.execute('SELECT config_json FROM skill_configs');
    return res.rows
      .map((r) => JSON.parse(String(r.config_json)) as SkillDefinition)
      .sort((a, b) => b.priority - a.priority);
  }
}

// Singleton accessor (supports test isolation via resetDbSingleton)
let dbSingleton: PresalesDatabase | null = null;

export function getDb(): PresalesDatabase {
  if (!dbSingleton) {
    dbSingleton = new PresalesDatabase();
  }
  return dbSingleton;
}

export function setDbForTesting(db: PresalesDatabase | null): void {
  dbSingleton = db;
}
