import { auth, drive, type drive_v3 } from '@googleapis/drive';
import type { Config } from '../config.js';
import { FOLDER_MIME, type DriveApi, type DriveItem, type UploadStep } from './types.js';

const FIELDS = 'id, name, mimeType, parents, modifiedTime, size';
const PAGE_SIZE = 1000;
const SHARED = { supportsAllDrives: true } as const;
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
/** Google answers 308 to a resumable-upload piece while more bytes are expected. */
const RESUME_INCOMPLETE = 308;

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Only the upload id travels through the model; the URL is always rebuilt here,
 * so a tool call can never point the server at another host.
 */
const sessionUrl = (uploadId: string): string =>
  `${UPLOAD_ENDPOINT}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}&upload_id=${encodeURIComponent(uploadId)}`;

/** "bytes=0-524287" → 524288; no header means nothing was stored yet. */
const receivedFrom = (range: string | null): number => {
  const end = range?.match(/^bytes=0-(\d+)$/)?.[1];
  return end === undefined ? 0 : Number(end) + 1;
};

const refused = async (what: string, res: Response): Promise<Error> =>
  new Error(`Drive refused ${what} (${res.status}): ${(await res.text()).slice(0, 300)}`);

function toItem(file: drive_v3.Schema$File): DriveItem {
  if (!file.id || !file.name || !file.mimeType) {
    throw new Error('Drive returned a file without id, name or mimeType');
  }
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents ?? [],
    modifiedTime: file.modifiedTime ?? '',
    size: file.size ? Number(file.size) : undefined,
  };
}

export function createGoogleDrive(google: Config['google']): DriveApi {
  const oauth = new auth.OAuth2(google.clientId, google.clientSecret);
  oauth.setCredentials({ refresh_token: google.refreshToken });
  const files = drive({ version: 'v3', auth: oauth }).files;

  const accessToken = async (): Promise<string> => {
    const { token } = await oauth.getAccessToken();
    if (!token) throw new Error('Google did not return an access token; check GOOGLE_REFRESH_TOKEN');
    return token;
  };

  const list = async (q: string, limit = PAGE_SIZE): Promise<DriveItem[]> => {
    const items: DriveItem[] = [];
    let pageToken: string | undefined;
    do {
      const res = await files.list({
        q,
        pageSize: Math.min(limit, PAGE_SIZE),
        pageToken,
        fields: `nextPageToken, files(${FIELDS})`,
        includeItemsFromAllDrives: true,
        ...SHARED,
      });
      items.push(...(res.data.files ?? []).map(toItem));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && items.length < limit);
    return items.slice(0, limit);
  };

  return {
    listChildren: (folderId) => list(`${quote(folderId)} in parents and trashed = false`),

    async get(id) {
      const res = await files.get({ fileId: id, fields: FIELDS, ...SHARED });
      return toItem(res.data);
    },

    async downloadText(id) {
      const res = await files.get({ fileId: id, alt: 'media', ...SHARED }, { responseType: 'text' });
      return String(res.data);
    },

    async updateText(id, text, mimeType) {
      const res = await files.update({ fileId: id, media: { mimeType, body: text }, fields: FIELDS, ...SHARED });
      return toItem(res.data);
    },

    async createText(parentId, name, text, mimeType) {
      const res = await files.create({
        requestBody: { name, parents: [parentId], mimeType },
        media: { mimeType, body: text },
        fields: FIELDS,
        ...SHARED,
      });
      return toItem(res.data);
    },

    async createFolder(parentId, name) {
      const res = await files.create({
        requestBody: { name, parents: [parentId], mimeType: FOLDER_MIME },
        fields: FIELDS,
        ...SHARED,
      });
      return toItem(res.data);
    },

    async startUpload(parentId, name, mimeType, size) {
      const res = await fetch(`${UPLOAD_ENDPOINT}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({ name, parents: [parentId] }),
      });
      if (!res.ok) throw await refused('the upload', res);
      const uploadId = new URL(res.headers.get('location') ?? UPLOAD_ENDPOINT).searchParams.get('upload_id');
      if (!uploadId) throw new Error('Drive did not return an upload id');
      return uploadId;
    },

    // The session URL itself authorizes the upload, so no token is sent with the pieces.
    async uploadChunk(uploadId, offset, bytes, total): Promise<UploadStep> {
      const res = await fetch(sessionUrl(uploadId), {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${total}` },
        body: new Uint8Array(bytes), // a copy typed on a plain ArrayBuffer, as fetch's BodyInit wants
      });
      if (res.status === RESUME_INCOMPLETE) return { done: false, received: receivedFrom(res.headers.get('range')) };
      if (!res.ok) throw await refused('the upload piece', res);
      return { done: true, item: toItem((await res.json()) as drive_v3.Schema$File) };
    },

    async move(id, fromParentId, toParentId, newName) {
      const sameParent = fromParentId === toParentId;
      const res = await files.update({
        fileId: id,
        addParents: sameParent ? undefined : toParentId,
        removeParents: sameParent ? undefined : fromParentId,
        requestBody: { name: newName },
        fields: FIELDS,
        ...SHARED,
      });
      return toItem(res.data);
    },

    async trash(id) {
      await files.update({ fileId: id, requestBody: { trashed: true }, ...SHARED });
    },

    searchFullText: (term, limit) => list(`fullText contains ${quote(term)} and trashed = false`, limit),
  };
}
