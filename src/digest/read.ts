import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

const isStatus = (v: unknown): v is RunStatus => STATUSES.includes(v as RunStatus);

// One line in, a RunLine or null out. Never throws.
function parseLine(text: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (!isStatus(o.status)) return null;
  const owner = o.owner ?? null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const line: RunLine = { at: o.at, job: o.job, status: o.status, owner };
  if (o.error !== undefined) line.error = o.error;
  return line;
}

// Lines of one job, in file order, into its row. Ties on time: the later line wins.
function toRow(job: string, lines: RunLine[]): DigestRow {
  const byTime = lines
    .map((line, i) => ({ line, t: Date.parse(line.at), i }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((e) => e.line);
  const earliest = byTime[0]!;
  const latest = byTime[byTime.length - 1]!;
  const withError = byTime.filter((l) => l.error !== undefined);
  return {
    job,
    owner: latest.owner,
    runs: lines.length,
    retries: lines.filter((l) => l.status === 'retry').length,
    lastStatus: latest.status,
    lastError: withError[withError.length - 1]?.error ?? null,
    first: earliest.at,
    last: latest.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const file = join(runsDir, `${night}.jsonl`);
  if (!existsSync(file)) return null;

  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  const jobs = new Map<string, RunLine[]>();
  let badLines = 0;

  for (const text of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (text.trim() === '') continue;
    const line = parseLine(text);
    if (!line) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const list = jobs.get(line.job);
    if (list) list.push(line);
    else jobs.set(line.job, [line]);
  }

  const rows = [...jobs.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((job) => toRow(job, jobs.get(job)!));
  return { night, rows, counts, badLines };
};
