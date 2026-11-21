export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string;
  size?: number;
}

/** Result of sending one piece of a resumable upload. */
export type UploadStep = { done: false; received: number } | { done: true; item: DriveItem };

/** The few Drive operations this server needs. Real and fake implementations share it. */
export interface DriveApi {
  listChildren(folderId: string): Promise<DriveItem[]>;
  get(id: string): Promise<DriveItem>;
  downloadText(id: string): Promise<string>;
  /** Replaces the content of an existing file. The file keeps its id and revision history. */
  updateText(id: string, text: string, mimeType: string): Promise<DriveItem>;
  createText(parentId: string, name: string, text: string, mimeType: string): Promise<DriveItem>;
  createFolder(parentId: string, name: string): Promise<DriveItem>;
  /** Opens a resumable upload of a new file of `size` bytes. Returns Google's upload id. */
  startUpload(parentId: string, name: string, mimeType: string, size: number): Promise<string>;
  /** Sends bytes [offset, offset + bytes.length) of a resumable upload of `total` bytes. */
  uploadChunk(uploadId: string, offset: number, bytes: Uint8Array, total: number): Promise<UploadStep>;
  move(id: string, fromParentId: string, toParentId: string, newName: string): Promise<DriveItem>;
  trash(id: string): Promise<void>;
  /** Searches names and contents across the whole Drive; callers filter to the root folder. */
  searchFullText(term: string, limit: number): Promise<DriveItem[]>;
}

export const isFolder = (item: DriveItem): boolean => item.mimeType === FOLDER_MIME;
