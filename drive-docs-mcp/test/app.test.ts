import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../src/app.js';
import { DocsLibrary } from '../src/docs/docsLibrary.js';
import { FakeDrive } from './fakeDrive.js';

// Base64 with "/", "+" and "=", like Render's generated values.
const SECRET = 'Ab3/9+xYz0Qw8/Lk2+Mn7Pq5Rs1Tu6Vw4Xy0Za9Bc8D=';
const quiet = { info: () => {}, error: () => {} };

let server: Server;
let base: string;
let drive: FakeDrive;

before(async () => {
  drive = new FakeDrive();
  const backlog = drive.addFolder('root', 'backlog');
  drive.addFile(backlog, 'architecture.md', '---\nupdated: 2026-11-12\n---\n\n- item A\n');
  const finance = drive.addFolder('outside', 'Finance');
  drive.addFile(finance, 'plan.md', '# Plan\n');
  const app = createApp({ library: new DocsLibrary(drive, { xapiems: 'root', finance }), secret: SECRET, log: quiet });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const connect = async (): Promise<Client> => {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${SECRET}`)));
  return client;
};

const textOf = (result: unknown): string => {
  const first = (result as CallToolResult).content[0];
  return first?.type === 'text' ? first.text : '';
};

describe('HTTP', () => {
  it('serves /health without the secret', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
  });

  it('answers 404 to a wrong or partial secret', async () => {
    const post = (path: string) => fetch(`${base}${path}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal((await post('/mcp/wrong')).status, 404);
    assert.equal((await post(`/mcp/${SECRET.split('/')[0]}`)).status, 404);
    assert.equal((await post(`/mcp/${SECRET}/extra`)).status, 404);
    assert.equal((await post('/mcp/')).status, 404);
  });

  it('answers 405 to GET with the right secret', async () => {
    const res = await fetch(`${base}/mcp/${SECRET}`);
    assert.equal(res.status, 405);
  });
});

describe('MCP over HTTP', () => {
  it('lists the seven tools and names the roots in its instructions', async () => {
    const client = await connect();
    assert.match(client.getInstructions() ?? '', /roots"\): xapiems, finance/);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['edit_file', 'list_files', 'move_file', 'read_file', 'search_files', 'trash_file', 'write_file'],
    );
    await client.close();
  });

  it('reads, edits and writes through tool calls', async () => {
    const client = await connect();

    const read = textOf(await client.callTool({ name: 'read_file', arguments: { path: 'xapiems/backlog/architecture.md' } }));
    const version = /version: (.+)/.exec(read)?.[1];
    assert.ok(version);

    const edited = await client.callTool({
      name: 'edit_file',
      arguments: { path: 'xapiems/backlog/architecture.md', old_string: '- item A\n', new_string: '- item A\n- item B\n', expected_version: version },
    });
    assert.equal(edited.isError, undefined);

    const stale = await client.callTool({
      name: 'write_file',
      arguments: { path: 'xapiems/backlog/architecture.md', content: 'x', expected_version: version },
    });
    assert.equal(stale.isError, true);
    assert.match(textOf(stale), /changed since version/);

    const created = await client.callTool({ name: 'write_file', arguments: { path: 'xapiems/journal/new.md', content: 'hi' } });
    assert.match(textOf(created), /"created": true/);

    const listed = textOf(await client.callTool({ name: 'list_files', arguments: { recursive: true } }));
    assert.match(listed, /xapiems\/journal\/new.md/);
    assert.match(listed, /finance\/plan.md/);
    await client.close();
  });

  it('returns tool errors instead of failing the request', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'xapiems/../outside/secret.md' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Invalid path/);
    await client.close();
  });
});
