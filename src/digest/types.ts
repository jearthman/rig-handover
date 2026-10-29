// Plan morning-digest § 1. Everything in § 2 builds against this file; the reader is read.ts.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once it has parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times are `at` exactly as logged, offset included.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number; // lines for this job
  retries: number; // lines with status retry
  lastStatus: RunStatus;
  lastError: string | null; // the job's latest `error`, if any line had one
  first: string;
  last: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  counts: Record<RunStatus, number>; // lines per status
  badLines: number; // lines that didn't parse
};

// null when runs/<night>.jsonl doesn't exist; an empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
