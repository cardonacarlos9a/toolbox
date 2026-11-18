import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DocsLibrary } from '../src/docs/docsLibrary.js';
import { ToolError } from '../src/docs/errors.js';
import { FakeDrive } from './fakeDrive.js';

let drive: FakeDrive;
let library: DocsLibrary;
let financeId: string;

beforeEach(() => {
  drive = new FakeDrive();
  const backlog = drive.addFolder('root', 'backlog');
  drive.addFile(backlog, 'architecture.md', '- item A\n- item B\n');
  financeId = drive.addFolder('outside', 'Finance');
  drive.addFile(financeId, 'plan.md', '# Plan\n- item A for finance\n');
  // Under "outside" but not under a configured root: must stay unreachable.
  drive.addFile('outside', 'secret.md', 'item A lives outside too');
  library = new DocsLibrary(drive, { xapiems: 'root', finance: financeId });
});

const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => error instanceof ToolError && pattern.test(error.message));

describe('roots', () => {
  it('lists the roots at the top, then each root recursively with prefixes', async () => {
    assert.deepEqual((await library.list()).map((e) => e.path), ['xapiems', 'finance']);
    assert.deepEqual(
      (await library.list('', true)).map((e) => e.path),
      ['xapiems', 'xapiems/backlog', 'xapiems/backlog/architecture.md', 'finance', 'finance/plan.md'],
    );
  });

  it('routes reads and writes by the first path part', async () => {
    assert.match((await library.read('finance/plan.md')).content, /Plan/);
    const written = await library.write('xapiems/journal/new.md', 'hi');
    assert.equal(written.path, 'xapiems/journal/new.md');
    assert.equal((await library.read('xapiems/journal/new.md')).content, 'hi');
  });

  it('edits inside a root and reports the full path', async () => {
    const result = await library.edit('xapiems/backlog/architecture.md', '- item B\n', '- item B\n- item C\n');
    assert.equal(result.path, 'xapiems/backlog/architecture.md');
  });

  it('refuses unknown roots, missing roots and the root itself as a file', async () => {
    await rejects(library.read('backlog/architecture.md'), /Unknown root "backlog". Available roots: xapiems, finance/);
    await rejects(library.read(''), /Start the path with a root/);
    await rejects(library.trash('finance'), /file path is required/);
    await rejects(library.read('finance/../xapiems/backlog/architecture.md'), /Invalid path/);
  });

  it('moves within a root but not across roots', async () => {
    const moved = await library.move('finance/plan.md', 'finance/2026/plan.md');
    assert.deepEqual(moved, { from: 'finance/plan.md', to: 'finance/2026/plan.md' });
    await rejects(library.move('finance/2026/plan.md', 'xapiems/plan.md'), /between roots/);
  });
});

describe('search', () => {
  it('returns hits from every root, never from outside them', async () => {
    const hits = await library.search('item A');
    assert.deepEqual(hits, [
      { path: 'xapiems/backlog/architecture.md', lines: ['- item A'] },
      { path: 'finance/plan.md', lines: ['- item A for finance'] },
    ]);
  });

  it('respects the limit', async () => {
    assert.equal((await library.search('item A', 1)).length, 1);
  });
});
