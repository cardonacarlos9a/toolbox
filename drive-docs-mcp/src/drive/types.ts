export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string;
  size?: number;
}

/** The few Drive operations this server needs. Real and fake implementations share it. */
export interface DriveApi {
  listChildren(folderId: string): Promise<DriveItem[]>;
  get(id: string): Promise<DriveItem>;
  downloadText(id: string): Promise<string>;
  /** Replaces the content of an existing file. The file keeps its id and revision history. */
  updateText(id: string, text: string, mimeType: string): Promise<DriveItem>;
  createText(parentId: string, name: string, text: string, mimeType: string): Promise<DriveItem>;
  createFolder(parentId: string, name: string): Promise<DriveItem>;
  move(id: string, fromParentId: string, toParentId: string, newName: string): Promise<DriveItem>;
  trash(id: string): Promise<void>;
  /** Searches names and contents across the whole Drive; callers filter to the root folder. */
  searchFullText(term: string, limit: number): Promise<DriveItem[]>;
}

export const isFolder = (item: DriveItem): boolean => item.mimeType === FOLDER_MIME;
