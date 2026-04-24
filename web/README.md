# reflect Viewer

Localhost-only Next.js dashboard for visualizing your reflect session state and history.

> **Localhost only.** The Viewer never deploys to a server. It reads your `.reflect/` directory from disk, displays it, and exits when you close the tab. Your reflection data never leaves your machine. This mirrors reflect's session-local design.

## Quick start

```bash
cd web
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). If `.reflect/` in the parent directory is empty, the Viewer falls back to `fixtures/example-session/` so every route renders.

To install and wire the reflect CLI itself (hooks, path-scoped rule, API key), follow `/install` in the Viewer or the root repository README.

## Routes

- `/` — Dashboard — live session state + tool call timeline + active reflection
- `/reflections` — browse `.reflect/session-log.jsonl` history
- `/patterns` — cross-session drift cluster analysis
- `/install` — install the reflect CLI
- `/roadmap` — v1 / v1.1 / v2 trajectory

## Environment

- Node 20+
- Next.js 16 + React 19 + Tailwind v4
- TypeScript strict
- No runtime deps beyond what's in `package.json`
- No API calls from the Viewer itself — it only reads files

## Security posture

- Viewer binds to `127.0.0.1` by default (`next dev -H 127.0.0.1`)
- Security headers configured (`CSP`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`)
- Reads allowlisted files only (`state.json`, `recent-calls.jsonl`, `session-guidance.md`, `session-log.jsonl`)
- PII redactor runs on every server-side read
- No `rehype-raw` — markdown reflection content is sanitized via `rehype-sanitize`
- `robots.ts` denies every crawler in case the Viewer is ever accidentally exposed

## Contributing

See root `CONTRIBUTING.md`. Viewer-specific:

- New routes require an entry in `components/Nav.tsx` and this README
- Server components for file I/O; `'use client'` only for interactive bits
- No external data fetches — keep the Viewer air-gapped

## License

MIT.
