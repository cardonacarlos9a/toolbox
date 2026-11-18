import { auth, drive, type drive_v3 } from '@googleapis/drive';
import type { Config } from '../config.js';
import { FOLDER_MIME, type DriveApi, type DriveItem } from './types.js';

const FIELDS = 'id, name, mimeType, parents, modifiedTime, size';
const PAGE_SIZE = 1000;
const SHARED = { supportsAllDrives: true } as const;

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

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
