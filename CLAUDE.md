# toolbox

Emi's personal utilities. Not part of xapiems. Start at [README.md](README.md), then open only the project you work on.

## Working
- One folder per project, each self-contained (`package.json`, tests, `README.md`).
- TypeScript, ESM, Node 24. Guard clauses and early returns; lookup maps instead of `switch`; no deep nesting.
- Tests with `node:test`; `npm test` must pass before a push.
- Commit and push straight to `main`; no branches.
- A new project: add its folder, a row in the README table, and its service in `render.yaml` if it deploys.
- Docs in English, short lists over prose.
