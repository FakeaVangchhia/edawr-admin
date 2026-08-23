---
name: run-project
description: Start eDawr locally and hand back the URLs — Django API on 8000, storefront on 3000, admin console on 3001, Expo for the rider app — including the PostgreSQL the API now requires, the sign-in credentials for the console and the rider app, and the store-hours setting that silently blocks checkout outside 07:00–22:00. Use when asked to run, start, serve or demo the project, when a package starts but shows no data, or when checkout refuses an order that looks fine.
argument-hint: "[api | store | console | rider | all]"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

Start `$ARGUMENTS`. **Empty means all three web services** — the API, the
storefront and the admin console — because "run the project" means a browsable
project, and either front end without the API behind it renders an empty shell.
The rider app is the exception: `npm start` in `mobile/` only prints a QR code
for a phone that may not be nearby, so start it when it is asked for, or when
the task is about the rider.

Whatever you start, **finish with the report at the bottom of this file** — the
URLs and the sign-in credentials. A dev server that is running and unannounced
is a dev server the user cannot open.

## State right now

```!
echo "── ports ──"
for p in 8000 3000 3001; do
  printf "  %-5s %s\n" "$p" "$(netstat -ano 2>/dev/null | grep -c ":$p .*LISTENING" | grep -q '^0$' && echo free || echo in-use)"
done
echo "── postgres ──"
powershell -NoProfile -Command "(Get-Service postgresql-x64-18 -ErrorAction SilentlyContinue).Status" 2>/dev/null || echo "  service not found"
echo "── env files ──"
for f in backend/.env frontend/.env admin/.env; do
  printf "  %-16s %s\n" "$f" "$([ -f "${CLAUDE_PROJECT_DIR}/$f" ] && echo present || echo MISSING)"
done
```

## Services

| What | Directory | Command | URL |
|---|---|---|---|
| API | `backend/` | `uv run manage.py runserver 8000` | http://localhost:8000 |
| Storefront | `frontend/` | `npm run dev` | http://localhost:3000 |
| Admin console | `admin/` | `npm run dev` | http://localhost:3001 |
| Rider app | `mobile/` | `npm start` | Expo Go on the phone |

Run each in the background so the session stays usable. **Start the API first** —
the other three serve no API routes of their own and render empty without it.

Wait on readiness rather than sleeping. All three answer within about ten
seconds, and `curl --retry-connrefused` is the entire wait — no `sleep` loop,
and it fails loudly instead of hanging forever when a server dies during boot:

```bash
for u in http://127.0.0.1:8000/api/health http://127.0.0.1:3000 http://127.0.0.1:3001/login; do
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused "$u")
  printf '  %-36s %s\n' "$u" "${code:-no answer}"
done
```

`%{http_code}` and nothing else in `-w`: a `\n` inside that format string gets
rewritten to `/n` by MSYS path translation and every line runs together, so the
newline belongs in `printf` on the shell side.

If one does not come up, read its background log before restarting it. The two
usual causes are a port already held — run `/stop-project` first — and a missing
`.env`, and both say so plainly in the first few lines.

`/api/health` is liveness and deliberately checks nothing external.
`/api/health/ready` is the one that proves the database and cache are reachable
— use it when the question is "is this actually working", not "is the process
up".

## PostgreSQL is required

**SQLite is no longer supported, in development either.** The
`select_for_update()` in `api/checkout.py` — the thing that stops the last unit
of stock being sold twice — is a **no-op** on SQLite, so a suite that passes
there leaves the invariant it exists to protect entirely unverified.

On this machine PostgreSQL 18 runs as the Windows service
`postgresql-x64-18` on port 5432, and `backend/.env` already points at a
dedicated `edawr` role. On a fresh machine:

```bash
psql -U postgres -c "CREATE ROLE edawr LOGIN PASSWORD 'choose-one';"
psql -U postgres -c "CREATE DATABASE edawr OWNER edawr ENCODING 'UTF8';"
psql -U postgres -c "ALTER ROLE edawr CREATEDB;"   # manage.py test builds test_edawr
```

`psql` is not on `PATH` here; it lives at
`C:\Program Files\PostgreSQL\18\bin\psql.exe`.

The role is deliberately not `postgres` — an application that owns only its own
database cannot drop anyone else's.

## First run

```bash
cd backend
uv sync                      # never `pip install`; deps are uv-managed
uv run manage.py migrate
uv run manage.py seed        # DESTRUCTIVE — deletes every row, dev only
```

`seed` gives you 8 categories, 33 products, 5 orders spread across the
lifecycle, two riders and one console account:

- Console: `admin@edawr.local` / `admin1234` — seeded with the **Admin** role,
  so `/accounts` and `/audit` are reachable. It used to seed a Manager, which
  left two of the console's ten screens unreachable in every fresh dev
  environment.
- Rider: `+919000000002` / PIN `4813`.

`seed` wipes hand-added accounts, so it is a fresh-database command only. On a
database you care about use `seed_admin` and `demo_clear --dry-run`:

```bash
uv run manage.py seed_admin --email you@example.com --password '...' --role admin
uv run manage.py demo_clear --dry-run     # then without the flag
```

## Checkout refuses a perfectly good order

Three things now reject an order that used to sail through. All three are
features, and all three look like bugs the first time.

**1. The store has opening hours.** `StoreSettings` defaults to **07:00–22:00**
in `STORE_TIMEZONE` (Asia/Kolkata), so a fresh database refuses checkout with
`503 We are closed right now. Orders open at 07:00.` — and anyone demoing late
in the evening hits this immediately. `manage.py seed` clears the pause switch
but does **not** reset the hours.

Check and fix in one call:

```bash
curl -s localhost:8000/api/store/config | python -c "import json,sys;d=json.load(sys.stdin);print(d['is_open'], d['closed_reason'] or 'open')"
```

Equal times mean open around the clock, which is what you want for a demo:

```bash
curl -sX PATCH localhost:8000/api/settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"opens_at":"00:00","closes_at":"00:00"}'
```

Or set it on the console's **Settings** screen, which is where a real operator
would. The API test suite does this in `APITestBase.setUp` for the same reason —
otherwise every checkout test fails after ten at night.

**2. There is a delivery radius**, 8 km from the store's coordinates. An address
outside it is refused with a 400 naming the distance. Widen it on the Settings
screen, or omit the coordinates: an order with no position is still accepted,
because geolocation is opt-in in a browser.

**3. There is a minimum order value** (`MIN_ORDER_VALUE`, ₹49). The cart says so
before checkout; the API says so at it.

## A page renders but has no data

Check this first, before anything else: **`NEXT_PUBLIC_API_URL`**. `src/proxy.ts`
(Next 16 calls middleware "Proxy") derives the CSP `connect-src` and `img-src`
from it. Wrong or missing, and the browser blocks the catalogue and every product
image; the page renders empty with CSP violations in the console. Compare
`frontend/.env` and `admin/.env` against their `.env.example`.

Second: is the API actually up, and can it reach the database?

```bash
curl -s localhost:8000/api/health/ready     # {"database":"ok","cache":"ok"}
```

Third: **CORS**. `backend/.env`'s `CORS_ORIGINS` must list *both* `:3000` and
`:3001`. Miss the console's origin and it renders every screen while every
request inside them is blocked.

## For a real phone

Expo Go cannot reach `localhost` on your laptop. Bind the API to the LAN and let
the app discover the host:

```bash
cd backend && uv run manage.py runserver 0.0.0.0:8000
```

`mobile/src/config.ts` derives the API host from the Expo dev server's
`hostUri`, so nothing needs configuring while running through Expo Go. It
rejects loopback addresses (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`,
`10.0.2.2`) as overrides, because a phone can never reach the computer's own
loopback. A standalone build has no dev server to ask and reads
`EXPO_PUBLIC_API_URL` or `expo.extra.apiUrl` — and **refuses an `http://` URL
outright in a release build**, so use https for anything you actually ship.

`ALLOWED_HOSTS=*` in `backend/.env` is what lets the phone's Host header
through. It is refused outside development by the startup check.

## Stopping

Use **`/stop-project`**. It kills each server's whole process tree rather than
the one process holding the socket — kill only the leaf and Django's
autoreloader or Next's supervisor starts a replacement, so the port never comes
free and the kill looks like it failed — and it verifies the ports afterwards.

Stop before a long test run: a dev server autoreloading mid-suite competes for
the same rows and turns a green suite intermittently red.

## Notes

- Turbopack is the default for `dev` and `build` in Next 16.
- **`next dev` renders every route per request; `next build` does not.** That
  difference hides a whole class of bug — the CSP nonce depends on per-request
  rendering, so a layout that stops calling `await connection()` works perfectly
  in dev and ships a page that paints and never hydrates. If you are about to
  claim a UI change works, run `npm run build` too. CI checks this.
- There is no socket.io server and no socket client any more; both apps and the
  rider app poll over REST, and that is the supported configuration.
- `runserver` is a development tool. It is never what serves a public URL;
  production runs gunicorn (see `backend/Dockerfile` and `PRODUCTION.md`).
- `manage.py seed` is destructive and `manage.py migrate` is not — when in
  doubt about a database with real rows in it, migrate and use `seed_admin`.

## The report you finish with

Print this once everything answers — filled in, not copied blind: drop the rows
you did not start, and if `is_open` came back false say so here rather than
leaving the user to discover it at checkout.

```
  Storefront      http://localhost:3000
  Admin console   http://localhost:3001     admin@edawr.local / admin1234
  API             http://localhost:8000     /docs, /api/health/ready
  Rider app       Expo Go — scan the QR     +919000000002 / PIN 4813

  Store is open — checkout will accept orders.
```

The console URL and its credentials are the two things most often missing from a
"servers are up" message, and they are the two the user cannot guess: the
console is on a **different port** from the storefront, and it opens on
`/login`, which is a dead end without an account.

Do not print a URL you have not just had a 200 from. "Everything is running"
over a server that died in compilation is worse than no report at all. The
interactive API map is at **`/docs`** — not `/api/docs`, which is a 404.
