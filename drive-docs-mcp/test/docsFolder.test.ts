import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DocsFolder } from '../src/docs/docsFolder.js';
import { ToolError } from '../src/docs/errors.js';
import { FakeDrive } from './fakeDrive.js';

let drive: FakeDrive;
let folder: DocsFolder;
let backlogId: string;
let readmeId: string;
let archId: string;

beforeEach(() => {
  drive = new FakeDrive();
  backlogId = drive.addFolder('root', 'backlog');
  readmeId = drive.addFile('root', 'README.md', '# Root\n\n- one\n');
  archId = drive.addFile(backlogId, 'architecture.md', '---\nupdated: 2026-11-12\n---\n\n- item A\n- item B\n');
  drive.addFile('outside', 'secret.md', 'item A lives outside too');
  folder = new DocsFolder(drive, 'root');
});

const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => error instanceof ToolError && pattern.test(error.message));

describe('paths', () => {
  it('refuses paths that try to leave the root', async () => {
    await rejects(folder.read('../outside/secret.md'), /Invalid path/);
    await rejects(folder.read('backlog/../README.md'), /Invalid path/);
    await rejects(folder.write('a//b.md', 'x'), /Invalid path/);
  });

  it('accepts leading "./" and "/"', async () => {
    assert.equal((await folder.read('./README.md')).path, 'README.md');
    assert.equal((await folder.read('/backlog/architecture.md')).path, 'backlog/architecture.md');
  });

  it('reports duplicates instead of guessing', async () => {
    drive.addFile(backlogId, 'architecture.md', 'copy');
    await rejects(folder.read('backlog/architecture.md'), /2 items with the same name/);
  });
});

describe('list', () => {
  it('lists the root, then recursively', async () => {
    assert.deepEqual(
      (await folder.list()).map((e) => `${e.type}:${e.path}`),
      ['folder:backlog', 'file:README.md'],
    );
    assert.deepEqual(
      (await folder.list('', true)).map((e) => e.path),
      ['backlog', 'backlog/architecture.md', 'README.md'],
    );
  });

  it('fails on a missing folder', async () => {
    await rejects(folder.list('nope'), /not found/);
  });
});

describe('read and write', () => {
  it('reads content with a version', async () => {
    const file = await folder.read('backlog/architecture.md');
    assert.match(file.content, /item A/);
    assert.ok(file.version);
  });

  it('updates an existing file in place (same id)', async () => {
    const result = await folder.write('README.md', '# New\n');
    assert.equal(result.created, false);
    assert.equal(drive.contentOf(readmeId), '# New\n');
    assert.ok(drive.calls.includes(`update ${readmeId}`));
  });

  it('creates a new file and its missing folders', async () => {
    const result = await folder.write('journal/2026/entry.md', 'hello');
    assert.equal(result.created, true);
    const listed = (await folder.list('journal', true)).map((e) => e.path);
    assert.deepEqual(listed, ['journal/2026', 'journal/2026/entry.md']);
    assert.equal((await folder.read('journal/2026/entry.md')).content, 'hello');
  });

  it('refuses a stale expected_version', async () => {
    const { version } = await folder.read('README.md');
    drive.touch(readmeId);
    await rejects(folder.write('README.md', 'x', version), /changed since version/);
    assert.equal(drive.contentOf(readmeId), '# Root\n\n- one\n');
  });

  it('accepts the current expected_version', async () => {
    const { version } = await folder.read('README.md');
    const result = await folder.write('README.md', 'x', version);
    assert.notEqual(result.version, version);
  });

  it('refuses non-text files and folders', async () => {
    drive.addFile('root', 'photo.png', 'binary', 'image/png');
    await rejects(folder.read('photo.png'), /only plain-text files/);
    await rejects(folder.read('backlog'), /is a folder/);
  });

  it('refuses writing through a file as if it were a folder', async () => {
    await rejects(folder.write('README.md/inner.md', 'x'), /is a file, not a folder/);
  });
});

describe('edit', () => {
  it('replaces one exact occurrence in place', async () => {
    const result = await folder.edit('backlog/architecture.md', 'updated: 2026-11-12', 'updated: 2026-11-18');
    assert.equal(result.replacements, 1);
    assert.match(drive.contentOf(archId) ?? '', /updated: 2026-11-18/);
  });

  it('appends after an anchor line', async () => {
    await folder.edit('backlog/architecture.md', '- item B\n', '- item B\n- item C\n');
    assert.match(drive.contentOf(archId) ?? '', /- item B\n- item C\n$/);
  });

  it('refuses ambiguous or missing old_string', async () => {
    await rejects(folder.edit('backlog/architecture.md', '- item', '* item'), /appears 2 times/);
    await rejects(folder.edit('backlog/architecture.md', 'nothing like this', 'x'), /not found/);
  });

  it('replaces all when asked', async () => {
    const result = await folder.edit('backlog/architecture.md', '- item', '* item', { replaceAll: true });
    assert.equal(result.replacements, 2);
    assert.doesNotMatch(drive.contentOf(archId) ?? '', /- item/);
  });

  it('keeps "$" sequences in the replacement literally', async () => {
    await folder.edit('README.md', '- one', '- costs $& and $1');
    assert.match(drive.contentOf(readmeId) ?? '', /- costs \$& and \$1/);
  });
});

describe('move and trash', () => {
  it('moves into a new folder', async () => {
    await folder.move('README.md', '_superseded/README.md');
    await rejects(folder.read('README.md'), /not found/);
    assert.equal((await folder.read('_superseded/README.md')).content, '# Root\n\n- one\n');
  });

  it('refuses to overwrite or to move a folder into itself', async () => {
    await rejects(folder.move('README.md', 'backlog/architecture.md'), /already exists/);
    await rejects(folder.move('backlog', 'backlog/inner'), /inside itself/);
  });

  it('trashes a file', async () => {
    await folder.trash('backlog/architecture.md');
    assert.equal(drive.isTrashed(archId), true);
  });

  it('never trashes the root', async () => {
    await rejects(folder.trash(''), /file path is required/);
  });
});

describe('search', () => {
  it('returns only matches under the root, with lines', async () => {
    const hits = await folder.search('item A');
    assert.deepEqual(hits, [{ path: 'backlog/architecture.md', lines: ['- item A'] }]);
  });
});
