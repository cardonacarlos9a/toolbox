import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

const valid = {
  DRIVE_ROOT_FOLDER_ID: 'root',
  MCP_SECRET: 's'.repeat(32),
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'token',
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig({ ...valid, PORT: '8080' });
    assert.equal(config.port, 8080);
    assert.equal(config.rootFolderId, 'root');
  });

  it('names every missing variable', () => {
    assert.throws(() => loadConfig({ MCP_SECRET: valid.MCP_SECRET }), /DRIVE_ROOT_FOLDER_ID, GOOGLE_CLIENT_ID/);
  });

  it('refuses a short secret', () => {
    assert.throws(() => loadConfig({ ...valid, MCP_SECRET: 'short' }), /at least 32/);
  });
});
