import type { DriveApi } from '../drive/types.js';
import { ToolError } from './errors.js';

/** Drive needs every piece except the last to be a multiple of 256 KiB. */
export const UPLOAD_QUANTUM = 256 * 1024;
/** 2 MiB: its base64 (~2.8 MB) fits one MCP request and Claude's per-call limit (~4.2 MB). */
export const UPLOAD_CHUNK_BYTES = 8 * UPLOAD_QUANTUM;
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const fileUrl = (id: string): string => `https://drive.google.com/file/d/${id}/view`;

export interface UploadStart {
  path: string;
  upload_id: string;
  size: number;
  chunk_size: number;
  mime_type: string;
}

export type ChunkResult =
  | { done: false; next_offset: number }
  | { done: true; id: string; name: string; size?: number; url: string };

export function assertUploadSize(size: number): void {
  if (Number.isSafeInteger(size) && size >= 1 && size <= MAX_UPLOAD_BYTES) return;
  throw new ToolError(`size must be a whole number of bytes between 1 and ${MAX_UPLOAD_BYTES}`);
}

/** Strict decoding: Buffer.from(…, 'base64') would silently skip bad characters. */
export function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) throw new ToolError('base64Content is not valid base64');
  return Buffer.from(compact, 'base64');
}

/** Checks one piece against Drive's rules before sending it, so mistakes come back as clear tool errors. */
export async function sendChunk(
  drive: DriveApi,
  uploadId: string,
  offset: number,
  total: number,
  base64Content: string,
): Promise<ChunkResult> {
  if (uploadId.trim() === '') throw new ToolError('upload_id is required (from start_upload)');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ToolError('offset must be a whole number of bytes, from 0');
  assertUploadSize(total);

  const bytes = decodeBase64(base64Content);
  if (bytes.length === 0) throw new ToolError('The piece is empty');
  if (bytes.length > UPLOAD_CHUNK_BYTES) throw new ToolError(`A piece can be at most ${UPLOAD_CHUNK_BYTES} bytes (got ${bytes.length})`);

  const end = offset + bytes.length;
  if (end > total) throw new ToolError(`The piece ends at byte ${end}, past total_size ${total}`);
  if (end < total && bytes.length % UPLOAD_QUANTUM !== 0) {
    throw new ToolError(`Every piece except the last must be a multiple of ${UPLOAD_QUANTUM} bytes (got ${bytes.length})`);
  }

  const step = await drive.uploadChunk(uploadId, offset, bytes, total);
  if (!step.done) return { done: false, next_offset: step.received };
  const { id, name, size } = step.item;
  return { done: true, id, name, size, url: fileUrl(id) };
}
