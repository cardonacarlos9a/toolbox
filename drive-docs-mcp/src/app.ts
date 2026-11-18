import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import type { DocsLibrary } from './docs/docsLibrary.js';
import { createMcpServer, type Logger } from './mcp/createServer.js';

export interface AppDeps {
  library: DocsLibrary;
  /** The MCP endpoint is /mcp/<secret>; the secret may contain "/", "+" and "=" (base64). Anything else gets 404. */
  secret: string;
  log: Logger;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time comparison; hashing first makes both sides the same length. */
const secretMatches = (given: string, expected: string): boolean => timingSafeEqual(digest(given), digest(expected));

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

export function createApp({ library, secret, log }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // "*secret" captures the rest of the path, so base64 secrets (as Render generates them) work as is.
  const guard = (req: Request<{ secret: string[] }>, res: Response, next: () => void): void => {
    if (secretMatches(req.params.secret.join('/'), secret)) return next();
    res.status(404).end();
  };

  // Stateless Streamable HTTP: every POST gets its own server and transport, so restarts lose nothing.
  app.post('/mcp/*secret', guard, express.json({ limit: '2mb' }), async (req, res) => {
    const server = createMcpServer(library, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error('MCP request failed', error);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal server error'));
    }
  });

  app.all('/mcp/*secret', guard, (_req, res) => {
    res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Method not allowed'));
  });

  app.use((_req, res) => {
    res.status(404).end();
  });

  return app;
}
