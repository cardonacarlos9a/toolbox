import { isFolder, type DriveApi, type DriveItem } from '../drive/types.js';
import { ToolError } from './errors.js';
import { isTextFile, joinPath, mimeForName, splitPath } from './paths.js';

const MAX_TEXT_BYTES = 1_000_000;
const MAX_LIST_ENTRIES = 500;
const MAX_LIST_DEPTH = 6;

export interface Entry {
  path: string;
  type: 'file' | 'folder';
  size?: number;
  modified: string;
}

export interface FileContent {
  path: string;
  version: string;
  content: string;
}

export interface WriteResult {
  path: string;
  version: string;
  created: boolean;
}

export interface EditResult {
  path: string;
  version: string;
  replacements: number;
}

interface Located {
  item: DriveItem;
  parentId: string;
}

/** Children of each folder, fetched once per operation. */
type Listing = Map<string, Promise<DriveItem[]>>;

/**
 * Files under one Drive folder, addressed by paths relative to it.
 * Every path is resolved by walking down from the root, so nothing outside the root is reachable.
 */
export class DocsFolder {
  constructor(
    private readonly drive: DriveApi,
    private readonly rootId: string,
    /** Root name shown before paths in error messages ("xapiems/backlog/…"). */
    private readonly label = '',
  ) {}

  async list(path = '', recursive = false): Promise<Entry[]> {
    const listing: Listing = new Map();
    const names = splitPath(path);
    const folderId = await this.folderIdAt(names, listing);
    const entries: Entry[] = [];
    await this.collect(folderId, names, recursive ? MAX_LIST_DEPTH : 1, entries, listing);
    return entries;
  }

  async read(path: string): Promise<FileContent> {
    const names = this.filePath(path);
    const { item } = await this.locateExisting(names, new Map());
    this.assertEditableText(item, path);
    const content = await this.drive.downloadText(item.id);
    return { path: joinPath(names), version: item.modifiedTime, content };
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<WriteResult> {
    const names = this.filePath(path);
    this.assertSize(content, path);
    const listing: Listing = new Map();
    const existing = await this.locate(names, listing);

    if (existing) {
      this.assertEditableText(existing.item, path);
      this.assertVersion(existing.item, expectedVersion, path);
      const updated = await this.drive.updateText(existing.item.id, content, existing.item.mimeType);
      return { path: joinPath(names), version: updated.modifiedTime, created: false };
    }

    if (expectedVersion) throw new ToolError(`${this.show(path)} does not exist, so it cannot match expected_version`);
    const name = names.at(-1) as string;
    const parentId = await this.ensureFolders(names.slice(0, -1), listing);
    const created = await this.drive.createText(parentId, name, content, mimeForName(name));
    return { path: joinPath(names), version: created.modifiedTime, created: true };
  }

  async edit(
    path: string,
    oldString: string,
    newString: string,
    options: { replaceAll?: boolean; expectedVersion?: string } = {},
  ): Promise<EditResult> {
    if (oldString === '') throw new ToolError('old_string must not be empty');
    if (oldString === newString) throw new ToolError('old_string and new_string are the same');

    const names = this.filePath(path);
    const { item } = await this.locateExisting(names, new Map());
    this.assertEditableText(item, path);
    this.assertVersion(item, options.expectedVersion, path);

    const current = await this.drive.downloadText(item.id);
    const count = current.split(oldString).length - 1;
    if (count === 0) throw new ToolError(`old_string was not found in ${this.show(path)}`);
    if (count > 1 && !options.replaceAll) {
      throw new ToolError(`old_string appears ${count} times in ${this.show(path)}; add surrounding text or set replace_all`);
    }

    const next = options.replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, () => newString);
    this.assertSize(next, path);
    const updated = await this.drive.updateText(item.id, next, item.mimeType);
    return { path: joinPath(names), version: updated.modifiedTime, replacements: options.replaceAll ? count : 1 };
  }

  async move(from: string, to: string): Promise<{ from: string; to: string }> {
    const fromNames = this.filePath(from);
    const toNames = this.filePath(to);
    const listing: Listing = new Map();
    const source = await this.locateExisting(fromNames, listing);

    const isInsideItself = toNames.length > fromNames.length && joinPath(toNames).startsWith(`${joinPath(fromNames)}/`);
    if (isInsideItself) throw new ToolError(`Cannot move ${this.show(from)} inside itself`);
    if (await this.locate(toNames, listing)) throw new ToolError(`${this.show(to)} already exists`);

    const targetParentId = await this.ensureFolders(toNames.slice(0, -1), listing);
    await this.drive.move(source.item.id, source.parentId, targetParentId, toNames.at(-1) as string);
    return { from: joinPath(fromNames), to: joinPath(toNames) };
  }

  /** Moves a file or folder to the Drive trash, where it can be restored for 30 days. */
  async trash(path: string): Promise<{ path: string }> {
    const names = this.filePath(path);
    const { item } = await this.locateExisting(names, new Map());
    await this.drive.trash(item.id);
    return { path: joinPath(names) };
  }

  // --- resolution ---------------------------------------------------------------------------

  private filePath(path: string): string[] {
    const names = splitPath(path);
    if (names.length === 0) throw new ToolError('A file path is required (the root folder itself cannot be used)');
    return names;
  }

  private children(folderId: string, listing: Listing): Promise<DriveItem[]> {
    const cached = listing.get(folderId);
    if (cached) return cached;
    const pending = this.drive.listChildren(folderId);
    listing.set(folderId, pending);
    return pending;
  }

  private async child(folderId: string, name: string, listing: Listing, shownPath: string): Promise<DriveItem | undefined> {
    const matches = (await this.children(folderId, listing)).filter((item) => item.name === name);
    if (matches.length > 1) {
      throw new ToolError(`${this.show(shownPath)} matches ${matches.length} items with the same name; rename or remove the duplicates in Drive`);
    }
    return matches[0];
  }

  /** Walks down from the root. Returns undefined when any part of the path is missing. */
  private async locate(names: readonly string[], listing: Listing): Promise<Located | undefined> {
    let parentId = this.rootId;
    for (const [index, name] of names.entries()) {
      const shown = joinPath(names.slice(0, index + 1));
      const item = await this.child(parentId, name, listing, shown);
      if (!item) return undefined;
      if (index === names.length - 1) return { item, parentId };
      if (!isFolder(item)) throw new ToolError(`${this.show(shown)} is a file, not a folder`);
      parentId = item.id;
    }
    return undefined;
  }

  private async locateExisting(names: readonly string[], listing: Listing): Promise<Located> {
    const found = await this.locate(names, listing);
    if (!found) throw new ToolError(`${this.show(joinPath(names))} was not found`);
    return found;
  }

  private async folderIdAt(names: readonly string[], listing: Listing): Promise<string> {
    if (names.length === 0) return this.rootId;
    const { item } = await this.locateExisting(names, listing);
    if (!isFolder(item)) throw new ToolError(`${this.show(joinPath(names))} is a file, not a folder`);
    return item.id;
  }

  /** Like mkdir -p: returns the id of the folder at `names`, creating missing folders. */
  private async ensureFolders(names: readonly string[], listing: Listing): Promise<string> {
    let parentId = this.rootId;
    for (const [index, name] of names.entries()) {
      const shown = joinPath(names.slice(0, index + 1));
      const existing = await this.child(parentId, name, listing, shown);
      if (existing && !isFolder(existing)) throw new ToolError(`${this.show(shown)} is a file, not a folder`);
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const created = await this.drive.createFolder(parentId, name);
      listing.delete(parentId);
      parentId = created.id;
    }
    return parentId;
  }

  private async collect(folderId: string, prefix: readonly string[], depth: number, out: Entry[], listing: Listing): Promise<void> {
    const items = [...(await this.children(folderId, listing))].sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      if (out.length >= MAX_LIST_ENTRIES) return;
      const names = [...prefix, item.name];
      const folder = isFolder(item);
      out.push({ path: joinPath(names), type: folder ? 'folder' : 'file', size: item.size, modified: item.modifiedTime });
      if (folder && depth > 1) await this.collect(item.id, names, depth - 1, out, listing);
    }
  }

  private show(path: string): string {
    return this.label ? `${this.label}/${path}` : path;
  }

  // --- checks -------------------------------------------------------------------------------

  private assertEditableText(item: DriveItem, path: string): void {
    if (isFolder(item)) throw new ToolError(`${this.show(path)} is a folder`);
    if (!isTextFile(item.name, item.mimeType)) {
      throw new ToolError(`${this.show(path)} is ${item.mimeType}; only plain-text files (Markdown, text, JSON, CSV, YAML…) can be read or edited`);
    }
    if ((item.size ?? 0) > MAX_TEXT_BYTES) throw new ToolError(`${this.show(path)} is larger than ${MAX_TEXT_BYTES} bytes`);
  }

  private assertVersion(item: DriveItem, expected: string | undefined, path: string): void {
    if (!expected || expected === item.modifiedTime) return;
    throw new ToolError(`${this.show(path)} changed since version ${expected} (now ${item.modifiedTime}); read it again before writing`);
  }

  private assertSize(content: string, path: string): void {
    if (Buffer.byteLength(content, 'utf8') <= MAX_TEXT_BYTES) return;
    throw new ToolError(`New content for ${this.show(path)} is larger than ${MAX_TEXT_BYTES} bytes`);
  }
}
