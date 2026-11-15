# reflect Viewer

A localhost-only Next.js dashboard for the session logs that reflect 0.2 writes.

> **Localhost only.** The Viewer reads files from disk and shows them in your browser. It is not deployed anywhere, makes no API calls and sends nothing over the network.

## What it reads

reflect 0.2 keeps one append-only log per Claude Code session:

```
<project>/.reflect/sessions/<session_id>/events.jsonl
<project>/.reflect/disabled          present while reflect is off for the project
```

Each line is one event: `prompt`, `verdict`, `skip`, `fire`, `guidance`, `delivered` or `error`. The shapes are defined in `src/hook/state.ts` and copied into `lib/types.ts`. The Viewer derives everything else from the log, using the same rules as the hook: turn numbers, the trigger window and cooldown, whether a note is waiting, in force or expired, and the spend for the session.

`<project>` is `REFLECT_PROJECT_DIR` if you set it (an absolute path), otherwise the folder that contains `web/`. If that project has no sessions, the Viewer shows the example data in `fixtures/example-session/`, which has the same layout.

reflect 0.1 files (`state.json`, `recent-calls.jsonl`, `session-log.jsonl`) are not read. reflect 0.2 still writes a copy of the latest note to `.reflect/session-guidance.md` for you to open; the Viewer takes notes from the log instead.

## Quick start

```bash
cd web
npm install
REFLECT_PROJECT_DIR=/path/to/your/project npm run preview   # builds once, serves http://127.0.0.1:3000
```

In PowerShell, set the variable first: `$env:REFLECT_PROJECT_DIR = "C:\path\to\project"; npm run preview`.

`npm run dev` starts the Turbopack dev server instead. It reloads on edits but uses much more memory: on Windows expect up to about 1.5 GB across ten `node` processes, against 100 to 200 MB for `preview`. `npm run clean` removes `.next/`.

From the repository root, `npm run viewer` and `npm run viewer:dev` do the same.

The pages read the log on every request. Reload to see new events.

## Routes

- `/`: one session (the newest, or `/?session=<id>`). Session picker, spend against the cap, the trigger window, the note in force or waiting, every developer turn with its verdict, and the full log in order.
- `/reflections`: every note in the recorded sessions, newest first, with its check, counter-hypothesis, expiry and deliveries. `#<note id>` selects one.
- `/patterns`: notes grouped by shared words across sessions.
- `/install`: how to install reflect 0.2.
- `/roadmap`: what 0.1 did, what 0.2 changed, what is still open.

## Settings it reads

The dashboard shows the trigger policy and the spend cap that apply to a session. It takes `REFLECT_POLICY` and `REFLECT_MAX_USD_PER_SESSION` (and `REFLECT_DISABLED`) from its own environment first, then from the project's `.env`, the same order the hook uses. No other value is read from `.env`. A cap set only in the plugin settings is not visible to the Viewer, so it shows the default ($0.50) in that case. Without `REFLECT_POLICY`, the window uses the policy recorded on the session's last fire, or `k2w6`.

## Security

- Binds to `127.0.0.1` (`next dev -H 127.0.0.1`, `next start -H 127.0.0.1`).
- Security headers: `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Session ids come from a directory listing and must match the hook's id characters; a `?session=` value is used only if the listing contains it. No path is built from request input. Symlinked folders and files are skipped.
- Reads are bounded: the last 4 MB of each log, at most 40 sessions, 64 KB of `.env`.
- Every event goes through the PII redactor (`lib/redact.ts`, a copy of `src/redact.ts`) before it reaches a page.
- Note text is rendered as markdown through `rehype-sanitize`, without `rehype-raw`.
- `robots.ts` disallows every crawler in case the Viewer is ever exposed by mistake.

## Environment

- Node 20 or later
- Next.js 16, React 19, Tailwind v4, TypeScript strict
- No dependencies beyond `package.json`

## Contributing

See the root `CONTRIBUTING.md`. For the Viewer:

- A new route needs an entry in `components/Nav.tsx` and in this README.
- File access stays in `lib/safe-read.ts`; derivation from events stays in `lib/session.ts`, which has no file access.
- Server components do the reading; `'use client'` only for interactive parts.
- When the hook's event format changes, update `lib/types.ts`, `lib/session.ts` and the fixture together.

## License

MIT.
