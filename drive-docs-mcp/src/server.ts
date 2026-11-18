import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { DocsLibrary } from './docs/docsLibrary.js';
import { createGoogleDrive } from './drive/googleDrive.js';
import type { Logger } from './mcp/createServer.js';

const log: Logger = {
  info: (message) => console.log(message),
  error: (message, error) => console.error(message, error),
};

const config = loadConfig();
const library = new DocsLibrary(createGoogleDrive(config.google), config.roots);
const app = createApp({ library, secret: config.mcpSecret, log });

app.listen(config.port, () => {
  log.info(`drive-docs-mcp listening on port ${config.port}; roots: ${library.rootNames.join(', ')}`);
});
