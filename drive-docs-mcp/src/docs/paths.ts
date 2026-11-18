import { ToolError } from './errors.js';

/**
 * Splits a path relative to the root folder into its names.
 * "" and "/" mean the root. ".." and "." are refused, so a path can never leave the root.
 */
export function splitPath(path: string): string[] {
  const trimmed = path.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return [];
  if (trimmed.includes('\\')) throw new ToolError(`Use "/" between folders: ${path}`);

  const names = trimmed.split('/');
  const bad = names.find((name) => name === '' || name === '.' || name === '..');
  if (bad !== undefined) throw new ToolError(`Invalid path "${path}": no empty, "." or ".." parts allowed`);
  return names;
}

export const joinPath = (names: readonly string[]): string => names.join('/');

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  html: 'text/html',
  css: 'text/css',
  xml: 'application/xml',
  svg: 'image/svg+xml',
};

const TEXT_MIMES = new Set(['application/json', 'application/xml', 'application/x-yaml', 'image/svg+xml']);

const extensionOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

export const mimeForName = (name: string): string => MIME_BY_EXTENSION[extensionOf(name)] ?? 'text/plain';

export const isTextFile = (name: string, mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_MIMES.has(mimeType) || extensionOf(name) in MIME_BY_EXTENSION;
