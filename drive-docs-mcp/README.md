# drive-docs-mcp

A remote MCP server that lets Claude read and edit plain-text files (Markdown, text, JSON, CSV, YAML) inside **chosen Google Drive folders** ("roots"), from any Claude app (web, phone, desktop), with no computer on.

Edits change files **in place**: same Drive id, revision history kept, and Google Drive for desktop syncs them as usual. The Google Drive connector in the directory cannot do this; it can only create new files.

## Tools

| Tool | What it does |
|---|---|
| `list_files` | List a folder, optionally recursive; an empty path lists the roots |
| `read_file` | Read a text file; returns its `version` |
| `write_file` | Create a file (and missing folders) or replace a file's whole content |
| `edit_file` | Replace exact text in a file (once, or every occurrence) |
| `move_file` | Move or rename a file or folder within one root |
| `trash_file` | Move to the Drive trash (restorable for 30 days) |
| `search_files` | Find files by name or content, with matching lines |

- Every path starts with a root name (`xapiems/backlog/README.md`). `..` is refused, and every path is resolved by walking down from its root, so nothing outside the roots is reachable. Search only returns files under a root.
- `write_file` and `edit_file` take an optional `expected_version` (from `read_file`) and refuse the change if the file changed since.
- Two items with the same name in one folder are reported, never guessed.

## How it works

- Express + the MCP TypeScript SDK, Streamable HTTP, **stateless** (each request gets its own server), so restarts and spin-downs lose nothing.
- Google Drive API v3 with an OAuth refresh token of the account that owns the folder.
- Endpoint: `POST /mcp/<MCP_SECRET>`. Any other path answers 404. `GET /health` is open, for Render.

```text
src/
├── server.ts            entry point (reads env, starts Express)
├── app.ts               HTTP routes and the secret check
├── config.ts            environment variables
├── mcp/createServer.ts  tool definitions
├── docs/docsLibrary.ts  roots: routes "root/path" to a folder; search
├── docs/docsFolder.ts   one root: paths, reads, edits, moves (all the rules)
└── drive/               DriveApi interface and the Google implementation
test/                    node:test suites with an in-memory FakeDrive
scripts/get-refresh-token.ts
```

## Environment

| Variable | Value |
|---|---|
| `DRIVE_ROOTS` | `name=folderId` pairs, comma-separated: `xapiems=1k4S…,finance=1XyZ…`. Names: lowercase letters, digits, `-`, `_`. The id is the part after `/folders/` in the folder's URL |
| `MCP_SECRET` | 32+ characters. The Render Blueprint generates it (base64; `/`, `+` and `=` are fine in the URL) |
| `GOOGLE_CLIENT_ID` | OAuth client (Web application) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | From the OAuth Playground (step 2) |
| `PORT` | Set by Render; 3000 locally |

## Setup

Everything happens in the browser; nothing runs on your computer.

### 1. Google Cloud (once)

1. [console.cloud.google.com](https://console.cloud.google.com): create a project (e.g. `toolbox`). No billing account is needed.
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **Google Auth Platform → Branding / Audience**: user type **External**, fill the app name and emails, then **Publish app** (status *In production*).
   - Required: in *Testing*, refresh tokens expire after 7 days.
   - The app stays unverified. At sign-in Google warns about it: **Advanced → Go to … (unsafe)**. Fine for personal use.
4. **Clients → Create client**: type **Web application**, authorized redirect URI `https://developers.google.com/oauthplayground`. Copy the client id and secret.

### 2. Refresh token (once, in the OAuth Playground)

1. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
2. Gear icon (top right): tick **Use your own OAuth credentials**, paste the client id and secret. Keep *OAuth flow: Server-side* and *Access type: Offline*.
3. Step 1: in the box at the bottom type `https://www.googleapis.com/auth/drive`, then **Authorize APIs**. Sign in with the account that owns the folder and allow access.
4. Step 2: **Exchange authorization code for tokens**. Copy the **Refresh token**.

With your own credentials the Playground does not revoke the token after 24 hours (it does with its default ones). Afterwards you can remove the Playground redirect URI from the client.

Alternative on a computer: `GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run token` (needs a **Desktop app** client instead).

### 3. Render

**New → Blueprint**, pick this repo; `render.yaml` at the repo root defines the service. Fill `DRIVE_ROOTS` and the three Google variables; `MCP_SECRET` is generated. Deploy, then check `https://<service>.onrender.com/health`.

The free plan sleeps after 15 minutes idle; the first call after that can take up to a minute and may time out once. A paid instance avoids it.

### 4. Claude

1. On Render, open the service's **Environment** tab and copy the value of `MCP_SECRET`.
2. **Customize → Connectors → Add → Custom → Web**, URL `https://<service>.onrender.com/mcp/<MCP_SECRET>`, no authentication.
3. Turn it on in the chats or project that need it.

### Add a folder later

On Render, append `,name=folderId` to `DRIVE_ROOTS` and save; the service restarts with the new root. The Google account behind the refresh token needs edit access to that folder. No change in Claude.

## Security

- The URL is the password: anyone with it can edit that folder. Keep it private. To rotate, change `MCP_SECRET` on Render and update the connector URL.
- The refresh token has the `drive` scope (needed to edit files the app did not create). The code only reaches the roots, but the token itself could reach the whole Drive: keep it in Render's environment only. Revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Every tool call is logged with its name and path (never contents).

## Current deployment

- Service `drive-docs-mcp` on Render, roots `xapiems` and `investments`.
- The refresh token belongs to **cardonacarlos9a**. New files the connector creates are owned by that account and use its 15 GB; edits keep each file's owner.
- To move new files to **cardonacarlosd** (the 5 TB plan): get a new refresh token in the OAuth Playground signed in as cardonacarlosd (same client), replace `GOOGLE_REFRESH_TOKEN` on Render, then remove `toolbox` at myaccount.google.com/permissions on cardonacarlos9a.

## Development

```bash
npm ci
npm test          # build + node:test (no Google access needed)
npm run build && DRIVE_ROOTS=name=folderId MCP_SECRET=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... npm start
```
