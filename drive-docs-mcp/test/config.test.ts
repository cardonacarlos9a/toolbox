import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, parseRoots } from '../src/config.js';

const valid = {
  DRIVE_ROOTS: 'xapiems=1AbC_d-9',
  MCP_SECRET: 's'.repeat(32),
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'token',
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig({ ...valid, PORT: '8080' });
    assert.equal(config.port, 8080);
    assert.deepEqual(config.roots, { xapiems: '1AbC_d-9' });
  });

  it('names every missing variable', () => {
    assert.throws(() => loadConfig({ MCP_SECRET: valid.MCP_SECRET }), /DRIVE_ROOTS, GOOGLE_CLIENT_ID/);
  });

  it('refuses a short secret', () => {
    assert.throws(() => loadConfig({ ...valid, MCP_SECRET: 'short' }), /at least 32/);
  });
});

describe('parseRoots', () => {
  it('reads several name=id pairs, ignoring spaces and empty entries', () => {
    assert.deepEqual(parseRoots(' xapiems = 1Ab , finance=2Cd,'), { xapiems: '1Ab', finance: '2Cd' });
  });

  it('refuses bad names, ids, repeats and empty lists', () => {
    assert.throws(() => parseRoots('Xapiems=1Ab'), /Invalid DRIVE_ROOTS entry/);
    assert.throws(() => parseRoots('xapiems=1A/b'), /Invalid DRIVE_ROOTS entry/);
    assert.throws(() => parseRoots('xapiems'), /Invalid DRIVE_ROOTS entry/);
    assert.throws(() => parseRoots('a=1,a=2'), /repeats the name "a"/);
    assert.throws(() => parseRoots(' , '), /at least one/);
  });
});
