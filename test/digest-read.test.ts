import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const n = readNight('runs', '2026-10-28')!;
    expect(n.night).toBe('2026-10-28');
    expect(n.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(n.badLines).toBe(1);
    expect(n.counts).toEqual({ ok: 10, retry: 4, fail: 1 });

    const row = (job: string) => n.rows.find((r) => r.job === job)!;
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      first: '2026-10-28T23:00:06+01:00',
      last: '2026-10-29T05:00:04+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('digest/render').owner).toBeNull();
  });

  it('reads 2026-10-27: 4 jobs, all ok', () => {
    const n = readNight('runs', '2026-10-27')!;
    expect(n.rows).toHaveLength(4);
    expect(n.badLines).toBe(0);
    expect(n.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-read-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const lines = [
    '{"at":"2026-10-29T01:00:00+01:00","job":"a","status":"retry","owner":"rook","error":"x"}',
    '{"at":"2026-10-29T02:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
    '',
    'not json',
  ];

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a bad night string', () => {
    expect(readNight(dir, '../x')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    const n = readNight(dir, '2026-01-02')!;
    expect(n.rows).toEqual([]);
    expect(n.badLines).toBe(0);
  });

  it('reads LF and CRLF the same', () => {
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\r\n') + '\r\n');
    const lf = readNight(dir, '2026-01-03')!;
    const crlf = readNight(dir, '2026-01-04')!;
    expect({ ...crlf, night: lf.night }).toEqual(lf);
    expect(lf.badLines).toBe(1);
    expect(lf.rows[0]).toMatchObject({ runs: 2, lastStatus: 'ok', lastError: 'x' });
  });
});
