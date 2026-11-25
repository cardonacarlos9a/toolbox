# toolbox

Personal utilities and side projects. Each folder is an independent project with its own dependencies, docs and deploy.

## Projects

| Project | What | Status |
|---|---|---|
| [drive-docs-mcp](drive-docs-mcp/README.md) | Remote MCP server: Claude reads and edits text files in one Google Drive folder, in place | Live on Render (`drive-docs-mcp.onrender.com`), connector `drive-docs` in Claude |
| [me-voy-practice](me-voy-practice/README.md) | Static page to rehearse "Me Voy": entry cues, karaoke, singing score | GitHub Pages (`cardonacarlos9a.github.io/toolbox/me-voy-practice/`) |

Planned: an investment agent (Claude proposes, Emi approves, orders go to Interactive Brokers).

## Conventions

- One folder per project; nothing shared between them unless it moves to a `shared/` folder on purpose.
- Docs in English, short. Each project's `README.md` says what it is, how to run it and how to deploy it.
- Deploys: [`render.yaml`](render.yaml) lists every Render service (one Blueprint for the repo). Static pages deploy to GitHub Pages via [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
- Commit straight to `main`.
