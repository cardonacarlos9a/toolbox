import { FOLDER_MIME, type DriveApi, type DriveItem } from '../src/drive/types.js';

interface Node extends DriveItem {
  content?: string;
  trashed: boolean;
}

/** In-memory Drive. Times advance one second per change so versions differ. */
export class FakeDrive implements DriveApi {
  private readonly nodes = new Map<string, Node>();
  private nextId = 1;
  private clock = Date.parse('2026-01-01T00:00:00Z');
  readonly calls: string[] = [];

  constructor(readonly rootId = 'root') {
    this.nodes.set(rootId, this.node(rootId, 'Root', FOLDER_MIME, []));
    this.nodes.set('outside', this.node('outside', 'Outside', FOLDER_MIME, []));
  }

  // --- helpers for tests ---

  addFolder(parentId: string, name: string): string {
    const id = `f${this.nextId++}`;
    this.nodes.set(id, this.node(id, name, FOLDER_MIME, [parentId]));
    return id;
  }

  addFile(parentId: string, name: string, content: string, mimeType = 'text/markdown'): string {
    const id = `d${this.nextId++}`;
    this.nodes.set(id, { ...this.node(id, name, mimeType, [parentId]), content, size: Buffer.byteLength(content) });
    return id;
  }

  contentOf(id: string): string | undefined {
    return this.nodes.get(id)?.content;
  }

  isTrashed(id: string): boolean {
    return this.nodes.get(id)?.trashed ?? false;
  }

  /** Simulates someone editing the file elsewhere. */
  touch(id: string): void {
    this.mustGet(id).modifiedTime = this.tick();
  }

  // --- DriveApi ---

  async listChildren(folderId: string): Promise<DriveItem[]> {
    this.calls.push(`list ${folderId}`);
    return [...this.nodes.values()].filter((n) => !n.trashed && n.parents.includes(folderId)).map(this.view);
  }

  async get(id: string): Promise<DriveItem> {
    return this.view(this.mustGet(id));
  }

  async downloadText(id: string): Promise<string> {
    return this.mustGet(id).content ?? '';
  }

  async updateText(id: string, text: string): Promise<DriveItem> {
    this.calls.push(`update ${id}`);
    const node = this.mustGet(id);
    Object.assign(node, { content: text, size: Buffer.byteLength(text), modifiedTime: this.tick() });
    return this.view(node);
  }

  async createText(parentId: string, name: string, text: string, mimeType: string): Promise<DriveItem> {
    this.calls.push(`create ${name}`);
    return this.view(this.mustGet(this.addFile(parentId, name, text, mimeType)));
  }

  async createFolder(parentId: string, name: string): Promise<DriveItem> {
    this.calls.push(`mkdir ${name}`);
    return this.view(this.mustGet(this.addFolder(parentId, name)));
  }

  async move(id: string, fromParentId: string, toParentId: string, newName: string): Promise<DriveItem> {
    const node = this.mustGet(id);
    node.parents = node.parents.map((p) => (p === fromParentId ? toParentId : p));
    Object.assign(node, { name: newName, modifiedTime: this.tick() });
    return this.view(node);
  }

  async trash(id: string): Promise<void> {
    this.mustGet(id).trashed = true;
  }

  async searchFullText(term: string, limit: number): Promise<DriveItem[]> {
    const needle = term.toLowerCase();
    return [...this.nodes.values()]
      .filter((n) => !n.trashed && `${n.name}\n${n.content ?? ''}`.toLowerCase().includes(needle))
      .slice(0, limit)
      .map(this.view);
  }

  // --- internals ---

  private node(id: string, name: string, mimeType: string, parents: string[]): Node {
    return { id, name, mimeType, parents, modifiedTime: this.tick(), trashed: false };
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private mustGet(id: string): Node {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`File not found: ${id}`);
    return node;
  }

  private readonly view = ({ content: _c, trashed: _t, ...item }: Node): DriveItem => ({ ...item, parents: [...item.parents] });
}
