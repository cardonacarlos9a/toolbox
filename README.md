# toolbox

Personal utilities and side projects. Each folder is an independent project with its own dependencies, docs and deploy.

## Projects

| Project | What | Status |
|---|---|---|
| [drive-docs-mcp](drive-docs-mcp/README.md) | Remote MCP server: Claude reads and edits text files in one Google Drive folder, in place | Built; deploy on Render |

Planned: an investment agent (Claude proposes, Emi approves, orders go to Interactive Brokers).

## Conventions

- One folder per project; nothing shared between them unless it moves to a `shared/` folder on purpose.
- Docs in English, short. Each project's `README.md` says what it is, how to run it and how to deploy it.
- Deploys: [`render.yaml`](render.yaml) lists every Render service (one Blueprint for the repo).
- Commit straight to `main`.
