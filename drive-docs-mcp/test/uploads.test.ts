import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DocsLibrary } from '../src/docs/docsLibrary.js';
import { ToolError } from '../src/docs/errors.js';
import { UPLOAD_CHUNK_BYTES, UPLOAD_QUANTUM } from '../src/docs/uploads.js';
import { FakeDrive } from './fakeDrive.js';

let drive: FakeDrive;
let library: DocsLibrary;

beforeEach(() => {
  drive = new FakeDrive();
  drive.addFile('root', 'README.md', '# Root\n');
  library = new DocsLibrary(drive, { music: 'root' });
});

const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => error instanceof ToolError && pattern.test(error.message));

const bytes = (length: number, seed = 7): Buffer => Buffer.from(Array.from({ length }, (_, i) => (i * 31 + seed) % 256));
const b64 = (data: Buffer): string => data.toString('base64');

describe('start_upload', () => {
  it('creates missing folders and guesses the type from the extension', async () => {
    const start = await library.startUpload('music/songs/papi/loop.mp4', 1000);
    assert.equal(start.path, 'music/songs/papi/loop.mp4');
    assert.equal(start.mime_type, 'video/mp4');
    assert.equal(start.chunk_size, UPLOAD_CHUNK_BYTES);
    assert.ok(start.upload_id);
    assert.deepEqual((await library.list('music/songs', true)).map((e) => e.path), ['music/songs/papi']);
  });

  it('refuses a path that exists, an unknown root and a bad size', async () => {
    await rejects(library.startUpload('music/README.md', 10), /already exists/);
    await rejects(library.startUpload('other/a.mp4', 10), /Unknown root/);
    await rejects(library.startUpload('music/a.mp4', 0), /size must be/);
    await rejects(library.startUpload('music/a.mp4', 1.5), /size must be/);
  });

  it('keeps a given mime type and falls back to octet-stream', async () => {
    assert.equal((await library.startUpload('music/a.bin', 5)).mime_type, 'application/octet-stream');
    assert.equal((await library.startUpload('music/b.bin', 5, 'audio/mpeg')).mime_type, 'audio/mpeg');
  });
});

describe('upload_chunk', () => {
  it('uploads a file in pieces and returns its link', async () => {
    const data = bytes(UPLOAD_QUANTUM * 2 + 123);
    const { upload_id } = await library.startUpload('music/loop.mp4', data.length);

    const first = await library.uploadChunk(upload_id, 0, data.length, b64(data.subarray(0, UPLOAD_QUANTUM * 2)));
    assert.deepEqual(first, { done: false, next_offset: UPLOAD_QUANTUM * 2 });

    const last = await library.uploadChunk(upload_id, UPLOAD_QUANTUM * 2, data.length, b64(data.subarray(UPLOAD_QUANTUM * 2)));
    assert.equal(last.done, true);
    if (!last.done) return;
    assert.equal(last.name, 'loop.mp4');
    assert.equal(last.size, data.length);
    assert.equal(last.url, `https://drive.google.com/file/d/${last.id}/view`);
    assert.ok(drive.bytesOf(last.id)?.equals(data));
  });

  it('reports where to resume when a piece starts at the wrong offset', async () => {
    const data = bytes(UPLOAD_QUANTUM * 2);
    const { upload_id } = await library.startUpload('music/a.mp3', data.length);
    const skipped = await library.uploadChunk(upload_id, UPLOAD_QUANTUM, data.length, b64(data.subarray(UPLOAD_QUANTUM)));
    assert.deepEqual(skipped, { done: false, next_offset: 0 });
  });

  it('checks every piece before sending it', async () => {
    const total = UPLOAD_QUANTUM * 20;
    const { upload_id } = await library.startUpload('music/big.mp4', total);
    await rejects(library.uploadChunk(upload_id, 0, total, b64(bytes(1000))), /multiple of 262144/);
    await rejects(library.uploadChunk(upload_id, 0, total, b64(bytes(UPLOAD_CHUNK_BYTES + UPLOAD_QUANTUM))), /at most/);
    await rejects(library.uploadChunk(upload_id, total - 10, total, b64(bytes(20))), /past total_size/);
    await rejects(library.uploadChunk(upload_id, 0, total, 'not base64!'), /not valid base64/);
    await rejects(library.uploadChunk(upload_id, 0, total, ''), /empty/);
    await rejects(library.uploadChunk(upload_id, -1, total, b64(bytes(4))), /offset/);
    await rejects(library.uploadChunk(' ', 0, total, b64(bytes(4))), /upload_id/);
  });

  it('never treats an uploaded video as editable text', async () => {
    const data = bytes(64);
    const { upload_id } = await library.startUpload('music/clip.mp4', data.length);
    await library.uploadChunk(upload_id, 0, data.length, b64(data));
    await rejects(library.read('music/clip.mp4'), /only plain-text files/);
  });
});
