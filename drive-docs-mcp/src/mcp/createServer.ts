import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import type { DocsFolder } from '../docs/docsFolder.js';
import { ToolError } from '../docs/errors.js';

export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 2));

const PATH_HELP = 'Path relative to the root folder, with "/" between folders, e.g. "backlog/README.md".';
const VERSION_HELP =
  'Optional. The version returned by read_file. When given, the change is refused if the file changed since then.';

const INSTRUCTIONS = [
  'Reads and edits plain-text files (Markdown, text, JSON, CSV, YAML) inside one Google Drive folder.',
  'Paths are relative to that folder. Edits change the file in place: it keeps its Drive id and history.',
  'Prefer edit_file for small changes; use write_file to create a file or replace all of it.',
].join(' ');

/** Builds one MCP server bound to a docs folder. Cheap enough to build per request. */
export function createMcpServer(folder: DocsFolder, log: Logger): McpServer {
  const server = new McpServer({ name: 'drive-docs', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const run = async (tool: string, target: string, action: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    log.info(`${tool} ${target}`);
    try {
      return await action();
    } catch (error) {
      if (error instanceof ToolError) return { ...text(error.message), isError: true };
      log.error(`${tool} ${target} failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      return { ...text(`Drive request failed: ${message}`), isError: true };
    }
  };

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description: 'Lists files and folders. Leave path empty for the root folder.',
      inputSchema: {
        path: z.string().default('').describe(PATH_HELP),
        recursive: z.boolean().default(false).describe('Also list subfolders (up to 6 levels, 500 entries).'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, recursive }) => run('list_files', path || '/', async () => json(await folder.list(path, recursive))),
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description: 'Returns a text file with its version. Pass the version to write_file or edit_file to avoid overwriting newer changes.',
      inputSchema: { path: z.string().describe(PATH_HELP) },
      annotations: { readOnlyHint: true },
    },
    ({ path }) =>
      run('read_file', path, async () => {
        const file = await folder.read(path);
        return text(`path: ${file.path}\nversion: ${file.version}\n---\n${file.content}`);
      }),
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description:
        'Creates a text file, or replaces the whole content of an existing one in place. Missing folders are created.',
      inputSchema: {
        path: z.string().describe(PATH_HELP),
        content: z.string().describe('The complete new content of the file.'),
        expected_version: z.string().optional().describe(VERSION_HELP),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ path, content, expected_version }) =>
      run('write_file', path, async () => json(await folder.write(path, content, expected_version))),
  );

  server.registerTool(
    'edit_file',
    {
      title: 'Edit file',
      description:
        'Replaces exact text in a file, in place. old_string must appear exactly once unless replace_all is true; include surrounding lines to make it unique.',
      inputSchema: {
        path: z.string().describe(PATH_HELP),
        old_string: z.string().describe('The exact text to replace, including whitespace and line breaks.'),
        new_string: z.string().describe('The replacement. Empty deletes old_string.'),
        replace_all: z.boolean().default(false).describe('Replace every occurrence instead of exactly one.'),
        expected_version: z.string().optional().describe(VERSION_HELP),
      },
      annotations: { destructiveHint: true },
    },
    ({ path, old_string, new_string, replace_all, expected_version }) =>
      run('edit_file', path, async () =>
        json(await folder.edit(path, old_string, new_string, { replaceAll: replace_all, expectedVersion: expected_version })),
      ),
  );

  server.registerTool(
    'move_file',
    {
      title: 'Move or rename',
      description: 'Moves or renames a file or folder inside the root folder. Missing destination folders are created.',
      inputSchema: {
        from: z.string().describe(PATH_HELP),
        to: z.string().describe('The new path. It must not exist yet.'),
      },
      annotations: { destructiveHint: false },
    },
    ({ from, to }) => run('move_file', `${from} -> ${to}`, async () => json(await folder.move(from, to))),
  );

  server.registerTool(
    'trash_file',
    {
      title: 'Move to trash',
      description: 'Moves a file or folder to the Google Drive trash. It can be restored from Drive for 30 days.',
      inputSchema: { path: z.string().describe(PATH_HELP) },
      annotations: { destructiveHint: true },
    },
    ({ path }) => run('trash_file', path, async () => json(await folder.trash(path))),
  );

  server.registerTool(
    'search_files',
    {
      title: 'Search',
      description: 'Finds files under the root folder whose name or content contains the term, with up to 3 matching lines each.',
      inputSchema: {
        term: z.string().describe('Words to search for.'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of files.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ term, limit }) => run('search_files', term, async () => json(await folder.search(term, limit))),
  );

  return server;
}
