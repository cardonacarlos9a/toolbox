import { isFolder, type DriveApi, type DriveItem } from '../drive/types.js';
import { DocsFolder, type EditResult, type Entry, type FileContent, type WriteResult } from './docsFolder.js';
import { ToolError } from './errors.js';
import { isTextFile, joinPath, splitPath } from './paths.js';

const SEARCH_CANDIDATES = 50;
const MAX_ANCESTRY_DEPTH = 32;
const MATCH_LINES_PER_FILE = 3;
const MATCH_LINE_CHARS = 200;

export interface SearchHit {
  path: string;
  lines: string[];
}

interface Routed {
  root: string;
  folder: DocsFolder;
  /** The path inside the root. */
  rest: string;
}

/**
 * Several named Drive folders ("roots"). Every path starts with a root name,
 * e.g. "xapiems/backlog/README.md"; nothing outside the configured roots is reachable.
 */
export class DocsLibrary {
  private readonly folders = new Map<string, DocsFolder>();
  private readonly rootNameById = new Map<string, string>();

  constructor(
    private readonly drive: DriveApi,
    roots: Record<string, string>,
  ) {
    for (const [name, id] of Object.entries(roots)) {
      this.folders.set(name, new DocsFolder(drive, id, name));
      this.rootNameById.set(id, name);
    }
  }

  get rootNames(): string[] {
    return [...this.folders.keys()];
  }

  async list(path = '', recursive = false): Promise<Entry[]> {
    if (splitPath(path).length > 0) {
      const { root, folder, rest } = this.route(path);
      return this.prefixed(root, await folder.list(rest, recursive));
    }

    const roots: Entry[] = this.rootNames.map((name) => ({ path: name, type: 'folder', modified: '' }));
    if (!recursive) return roots;

    const nested = await Promise.all(this.rootNames.map(async (name) => this.prefixed(name, await this.must(name).list('', true))));
    return roots.flatMap((entry, index) => [entry, ...(nested[index] ?? [])]);
  }

  async read(path: string): Promise<FileContent> {
    const { root, folder, rest } = this.route(path);
    const file = await folder.read(rest);
    return { ...file, path: `${root}/${file.path}` };
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<WriteResult> {
    const { root, folder, rest } = this.route(path);
    const result = await folder.write(rest, content, expectedVersion);
    return { ...result, path: `${root}/${result.path}` };
  }

  async edit(
    path: string,
    oldString: string,
    newString: string,
    options: { replaceAll?: boolean; expectedVersion?: string } = {},
  ): Promise<EditResult> {
    const { root, folder, rest } = this.route(path);
    const result = await folder.edit(rest, oldString, newString, options);
    return { ...result, path: `${root}/${result.path}` };
  }

  async move(from: string, to: string): Promise<{ from: string; to: string }> {
    const source = this.route(from);
    const target = this.route(to);
    if (source.root !== target.root) {
      throw new ToolError(`Moving between roots ("${source.root}" → "${target.root}") is not supported; write the file in the new root and trash the old one`);
    }
    const result = await source.folder.move(source.rest, target.rest);
    return { from: `${source.root}/${result.from}`, to: `${source.root}/${result.to}` };
  }

  async trash(path: string): Promise<{ path: string }> {
    const { root, folder, rest } = this.route(path);
    const result = await folder.trash(rest);
    return { path: `${root}/${result.path}` };
  }

  /** One Drive search, then only the hits under a configured root, each with matching lines. */
  async search(term: string, limit = 20): Promise<SearchHit[]> {
    const query = term.trim();
    if (query === '') throw new ToolError('Search term must not be empty');

    const candidates = await this.drive.searchFullText(query, SEARCH_CANDIDATES);
    const parents = new Map<string, Promise<DriveItem>>();
    const hits: SearchHit[] = [];

    for (const item of candidates) {
      if (hits.length >= limit) break;
      const names = await this.pathOf(item, parents);
      if (!names) continue;
      hits.push({ path: joinPath(names), lines: await this.matchingLines(item, query) });
    }
    return hits;
  }

  // --- internals ----------------------------------------------------------------------------

  private route(path: string): Routed {
    const [root, ...rest] = splitPath(path);
    if (!root) throw new ToolError(`Start the path with a root: ${this.rootNames.join(', ')}`);
    const folder = this.folders.get(root);
    if (!folder) throw new ToolError(`Unknown root "${root}". Available roots: ${this.rootNames.join(', ')}`);
    return { root, folder, rest: joinPath(rest) };
  }

  private must(name: string): DocsFolder {
    const folder = this.folders.get(name);
    if (!folder) throw new Error(`Root ${name} is not configured`);
    return folder;
  }

  private prefixed(root: string, entries: Entry[]): Entry[] {
    return entries.map((entry) => ({ ...entry, path: `${root}/${entry.path}` }));
  }

  /** Path of an item starting with its root name, or undefined when it is under no root. */
  private async pathOf(item: DriveItem, parents: Map<string, Promise<DriveItem>>): Promise<string[] | undefined> {
    const names = [item.name];
    let parentId = item.parents[0];
    for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
      if (!parentId) return undefined;
      const rootName = this.rootNameById.get(parentId);
      if (rootName) return [rootName, ...names];
      const cached = parents.get(parentId) ?? this.drive.get(parentId);
      parents.set(parentId, cached);
      const parent = await cached;
      names.unshift(parent.name);
      parentId = parent.parents[0];
    }
    return undefined;
  }

  private async matchingLines(item: DriveItem, query: string): Promise<string[]> {
    if (isFolder(item) || !isTextFile(item.name, item.mimeType)) return [];
    const needle = query.toLowerCase();
    const text = await this.drive.downloadText(item.id);
    return text
      .split('\n')
      .filter((line) => line.toLowerCase().includes(needle))
      .slice(0, MATCH_LINES_PER_FILE)
      .map((line) => line.trim().slice(0, MATCH_LINE_CHARS));
  }
}
