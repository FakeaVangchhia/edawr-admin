---
name: dev-up
description: Start eDawr locally — Django API on 8000, storefront on 3000, admin console on 3001, Expo for the rider app — with the env each one needs and the LAN address a real phone needs. Use when asked to run, start, serve or demo the project, or when a package starts but shows no data.
argument-hint: "[api | store | console | rider | all]"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

Start `$ARGUMENTS` (empty means the API plus whatever the task is about — do not
start all four unless asked).

## Services

| What | Directory | Command | URL |
|---|---|---|---|
| API | `backend/` | `uv run manage.py runserver 8000` | http://localhost:8000 |
| Storefront | `frontend/` | `npm run dev` | http://localhost:3000 |
| Admin console | `admin/` | `npm run dev` | http://localhost:3001 |
| Rider app | `mobile/` | `npm start` | Expo Go on the phone |

Run each in the background so the session stays usable. **Start the API first** —
the other three serve no API routes of their own and render empty without it.

## First run

```bash
cd backend
uv sync                      # never `pip install`; deps are uv-managed
uv run manage.py migrate
uv run manage.py seed        # DESTRUCTIVE — deletes every row, dev only
uv run manage.py seed_admin --email you@example.com --password '...' --role admin
```

`seed` wipes hand-added admins, so it is a fresh-database command only. On a
database you care about, use `seed_admin` and `demo_clear --dry-run`.

## For a real phone

Expo Go cannot reach `localhost` on your laptop. Bind the API to the LAN and let
the app discover the host:

```bash
cd backend && uv run manage.py runserver 0.0.0.0:8000
```

`mobile/src/config.ts` derives the API host from the Expo dev server's
`hostUri`, so nothing needs configuring while running through Expo Go. A
standalone build has no dev server to ask and falls back to `mobile/.env`.
`ALLOWED_HOSTS=*` in `backend/.env` is what lets the phone's Host header through.

## When a page renders but has no data

Check this first, before anything else: **`NEXT_PUBLIC_API_URL`**. `src/proxy.ts`
(Next 16 calls middleware "Proxy") derives the CSP `connect-src` and `img-src`
from it. Wrong or missing, and the browser blocks the catalogue and every product
image; the store renders empty with CSP violations in the console. Compare
`frontend/.env` and `admin/.env` against their `.env.example`.

Second: is the API actually up? `curl http://localhost:8000/api/health`.

## Notes

- Turbopack is the default for `dev` and `build` in Next 16.
- There is no socket.io server in this repo. Leave `NEXT_PUBLIC_SOCKET_URL`
  unset — the console polls over REST, and that is the supported configuration.
- `runserver` is a development tool. It is never what serves a public URL;
  production runs gunicorn (see `backend/Dockerfile`).
