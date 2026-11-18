import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { DocsFolder } from './docs/docsFolder.js';
import { createGoogleDrive } from './drive/googleDrive.js';
import type { Logger } from './mcp/createServer.js';

const log: Logger = {
  info: (message) => console.log(message),
  error: (message, error) => console.error(message, error),
};

const config = loadConfig();
const folder = new DocsFolder(createGoogleDrive(config.google), config.rootFolderId);
const app = createApp({ folder, secret: config.mcpSecret, log });

app.listen(config.port, () => {
  log.info(`drive-docs-mcp listening on port ${config.port}`);
});
