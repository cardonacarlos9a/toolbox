# drive-docs-mcp

A remote MCP server that lets Claude read and edit plain-text files (Markdown, text, JSON, CSV, YAML) inside **one Google Drive folder**, from any Claude app (web, phone, desktop), with no computer on.

Edits change files **in place**: same Drive id, revision history kept, and Google Drive for desktop syncs them as usual. The Google Drive connector in the directory cannot do this; it can only create new files.

## Tools

| Tool | What it does |
|---|---|
| `list_files` | List a folder, optionally recursive |
| `read_file` | Read a text file; returns its `version` |
| `write_file` | Create a file (and missing folders) or replace a file's whole content |
| `edit_file` | Replace exact text in a file (once, or every occurrence) |
| `move_file` | Move or rename a file or folder |
| `trash_file` | Move to the Drive trash (restorable for 30 days) |
| `search_files` | Find files by name or content, with matching lines |

- Paths are relative to the root folder (`backlog/README.md`). `..` is refused, and every path is resolved by walking down from the root, so nothing outside it is reachable.
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
├── docs/docsFolder.ts   paths, reads, edits, moves, search (all the rules)
└── drive/               DriveApi interface and the Google implementation
test/                    node:test suites with an in-memory FakeDrive
scripts/get-refresh-token.ts
```

## Environment

| Variable | Value |
|---|---|
| `DRIVE_ROOT_FOLDER_ID` | Id of the Drive folder to expose (the part after `/folders/` in its URL) |
| `MCP_SECRET` | 32+ characters, letters and digits only (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` | OAuth client (Desktop app) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | From `npm run token` |
| `PORT` | Set by Render; 3000 locally |

## Setup

### 1. Google Cloud (once)

1. [console.cloud.google.com](https://console.cloud.google.com): create a project (e.g. `toolbox`).
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **Google Auth Platform → Branding / Audience**: user type **External**, fill the app name and emails, then **Publish app** (status *In production*).
   - Required: in *Testing*, refresh tokens expire after 7 days.
   - The app stays unverified. At sign-in Google warns about it: **Advanced → Go to … (unsafe)**. Fine for personal use.
4. **Clients → Create client**: type **Desktop app**. Copy the client id and secret.

### 2. Refresh token (once, on a computer with a browser)

```bash
cd drive-docs-mcp
npm ci
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run token
```

Sign in with the account that owns the folder, allow access, and copy the printed `GOOGLE_REFRESH_TOKEN`.

### 3. Render

**New → Blueprint**, pick this repo; `render.yaml` at the repo root defines the service. Fill the variables it asks for and deploy. Check `https://<service>.onrender.com/health`.

The free plan sleeps after 15 minutes idle; the first call after that can take up to a minute and may time out once. The Starter plan avoids it.

### 4. Claude

**Customize → Connectors → Add → Custom → Web**, URL `https://<service>.onrender.com/mcp/<MCP_SECRET>`, no authentication. Then turn it on in the chats or project that need it.

## Security

- The URL is the password: anyone with it can edit that folder. Keep it private. To rotate, change `MCP_SECRET` on Render and update the connector URL.
- The refresh token has the `drive` scope (needed to edit files the app did not create). The code only reaches the root folder, but the token itself could reach the whole Drive: keep it in Render's environment only. Revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Every tool call is logged with its name and path (never contents).

## Development

```bash
npm ci
npm test          # build + node:test (no Google access needed)
npm run build && DRIVE_ROOT_FOLDER_ID=... MCP_SECRET=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... npm start
```
