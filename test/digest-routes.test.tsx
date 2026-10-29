import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// runs/ is read-only, so these three nights are written into a temp dir for each run.
const NORMAL = '2026-10-28';
const EMPTY = '2026-10-27';
const BAD_LINE = '2026-10-26';
const MISSING = '2026-10-25';

const normalLines = [
  '{"at":"2026-10-28T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-28T23:01:10+01:00","job":"lane/index","status":"fail","owner":null,"error":"disk full"}',
  '{"at":"2026-10-28T23:02:00+01:00","job":"lane/backup","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-28T23:04:00+01:00","job":"lane/backup","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-28T23:06:00+01:00","job":"lane/backup","status":"retry","owner":"rook"}',
  '{"at":"2026-10-28T23:08:00+01:00","job":"lane/backup","status":"ok","owner":"rook"}',
];

const badLineLines = [
  '{"at":"2026-10-26T23:00:02+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  'this line is not json',
  '{"at":"2026-10-26T23:01:10+01:00","job":"lane/index","status":"ok","owner":null}',
];

// Job names in the order the page and the JSON must both list them.
const JOBS = ['lane/backup', 'lane/index', 'lane/sync'];

// The page writes apostrophes as entities; decode them so text checks read the way a person would.
const decode = (html: string) => html.replace(/&#39;|&#x27;|&apos;/g, "'");

// Job names in the order they appear in the page.
const pageOrder = (html: string) =>
  JOBS.filter((job) => html.includes(job)).sort((a, b) => html.indexOf(a) - html.indexOf(b));

// The markup of one table row, found by the job name it contains.
const rowFor = (html: string, job: string) => html.split('<tr').find((row) => row.includes(job));

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normalLines.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD_LINE}.jsonl`), badLineLines.join('\n') + '\n');
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest page', () => {
  it('renders the normal night with one sorted row per job', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = decode(await res.text());
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>digest · 2026-10-28</h1>');
    expect(pageOrder(html)).toEqual(JOBS);
  });

  it('marks the 3-retry row and the failed row as warn, and leaves the ok row alone', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    expect(rowFor(html, 'lane/backup')).toContain('class="warn"');
    expect(rowFor(html, 'lane/index')).toContain('class="warn"');
    expect(rowFor(html, 'lane/sync')).not.toContain('class="warn"');
  });

  it('returns 404 for a night with no run log', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    const html = decode(await res.text());
    expect(res.status).toBe(404);
    expect(html).toContain(`no run log for ${MISSING}`);
  });

  it('says "nothing ran" with no table for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('renders the good jobs and the bad-line count for a night with a bad line', async () => {
    const res = await app.request(`/digest/${BAD_LINE}`);
    const html = decode(await res.text());
    expect(res.status).toBe(200);
    expect(html).toContain("1 line didn't parse");
    expect(pageOrder(html)).toEqual(['lane/index', 'lane/sync']);
  });
});

describe('digest JSON', () => {
  it('returns the normal night with rows sorted by job', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(NORMAL);
    expect(body.rows.map((row) => row.job)).toEqual(JOBS);
    expect(body.rows.find((row) => row.job === 'lane/backup')).toEqual({
      job: 'lane/backup',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'timeout',
      first: '2026-10-28T23:02:00+01:00',
      last: '2026-10-28T23:08:00+01:00',
    });
    expect(body.rows.find((row) => row.job === 'lane/index')?.owner).toBeNull();
    expect(body.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
    expect(body.badLines).toBe(0);
  });

  it('returns 404 with an error body for a night with no run log', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows).toEqual([]);
    expect(body.counts).toEqual({ ok: 0, retry: 0, fail: 0 });
    expect(body.badLines).toBe(0);
  });

  it('counts the bad line and keeps the good jobs for a night with a bad line', async () => {
    const res = await app.request(`/api/digest/${BAD_LINE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['lane/index', 'lane/sync']);
  });
});

describe('digest page and JSON agree', () => {
  it('list the same jobs in the same order for the normal night', async () => {
    const html = decode(await (await app.request(`/digest/${NORMAL}`)).text());
    const body = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as Night;
    expect(pageOrder(html)).toEqual(body.rows.map((row) => row.job));
  });
});
