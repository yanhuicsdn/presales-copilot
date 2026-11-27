import fs from 'node:fs';
import path from 'node:path';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import {
  analyzerAgent,
  questionGeneratorAgent,
  selfValidatorAgent,
  summaryAgent,
} from './agents';
import { presalesWorkflow } from './workflows/presales-workflow';
import { summaryWorkflow } from './workflows/summary-workflow';
import type { GroupCheckpoint, MeetingSummary, QuestionCard, StageCode } from '@/lib/types';

function resolveMastraStorageUrl(): string {
  const raw = process.env.MASTRA_DATABASE_URL || 'file:./data/mastra-state.db';
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

let mastraInstance: Mastra | null = null;

export function getMastra(): Mastra {
  if (!mastraInstance) {
    const storageUrl = resolveMastraStorageUrl();
    mastraInstance = new Mastra({
      agents: {
        analyzerAgent,
        questionGeneratorAgent,
        selfValidatorAgent,
        summaryAgent,
      },
      workflows: {
        presalesWorkflow,
        summaryWorkflow,
      },
      storage: new LibSQLStore({
        id: 'presales-mastra-store',
        url: storageUrl,
      }),
    });
  }
  return mastraInstance;
}

export function resetMastraForTesting(): void {
  mastraInstance = null;
}

export interface PresalesWorkflowOutput {
  card: QuestionCard;
  checkpoint: GroupCheckpoint;
  stageChanged: boolean;
  previousStage: StageCode;
  currentStage: StageCode;
}

export async function runPresalesAnalysis(input: {
  groupId: string;
  sessionId?: string | null;
  triggerSeq?: number;
}): Promise<PresalesWorkflowOutput> {
  const mastra = getMastra();
  const wf = mastra.getWorkflow('presalesWorkflow');
  const run = await wf.createRun();
  const result = await run.start({
    inputData: {
      groupId: input.groupId,
      sessionId: input.sessionId ?? null,
      triggerSeq: input.triggerSeq,
    },
  });

  if (result.status !== 'success') {
    const errMsg =
      result.status === 'failed' && 'error' in result && result.error
        ? String(result.error)
        : `Workflow ended with status: ${result.status}`;
    throw new Error(`Mastra presalesWorkflow failed: ${errMsg}`);
  }

  return result.result as PresalesWorkflowOutput;
}

export async function runSessionSummary(input: {
  groupId: string;
  sessionId?: string | null;
}): Promise<MeetingSummary> {
  const mastra = getMastra();
  const wf = mastra.getWorkflow('summaryWorkflow');
  const run = await wf.createRun();
  const result = await run.start({
    inputData: {
      groupId: input.groupId,
      sessionId: input.sessionId ?? null,
    },
  });

  if (result.status !== 'success') {
    const errMsg =
      result.status === 'failed' && 'error' in result && result.error
        ? String(result.error)
        : `Summary workflow ended with status: ${result.status}`;
    throw new Error(`Mastra summaryWorkflow failed: ${errMsg}`);
  }

  return (result.result as { summary: MeetingSummary }).summary;
}
