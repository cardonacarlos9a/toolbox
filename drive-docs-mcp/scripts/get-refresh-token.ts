/**
 * One-time helper: signs in to Google in the browser and prints a refresh token for GOOGLE_REFRESH_TOKEN.
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run token
 *
 * Needs an OAuth client of type "Desktop app" (loopback redirects are allowed on any port).
 */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { auth } from '@googleapis/drive';

const SCOPE = 'https://www.googleapis.com/auth/drive';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const oauth = new auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [SCOPE] });

  server.on('request', async (req, res) => {
    const code = new URL(req.url ?? '/', redirectUri).searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('No code in the request.');
      return;
    }
    try {
      const { tokens } = await oauth.getToken(code);
      res.end('Done. You can close this tab and go back to the terminal.');
      console.log(tokens.refresh_token ? `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n` : '\nNo refresh token returned. Remove the app at https://myaccount.google.com/permissions and run this again.\n');
    } catch (error) {
      res.writeHead(500).end('Token exchange failed; see the terminal.');
      console.error(error);
    } finally {
      server.close();
    }
  });

  console.log(`Opening the Google sign-in page. If it does not open, visit:\n\n${url}\n`);
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
});
