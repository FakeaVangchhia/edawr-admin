# eDawr

Quick-commerce grocery delivery for Aizawl, Mizoram. Customers order from a web
storefront, a store manager fulfils from an admin console, and riders deliver
through a mobile app — on a **15-minute promise**.

## Monorepo layout

| Path        | Stack                                  | Purpose                          |
| ----------- | -------------------------------------- | -------------------------------- |
| `frontend/` | Next.js 16 (App Router, React 19, TW4) | Customer storefront (UI only)    |
| `admin/`    | Next.js 16, its own design system      | Staff console, port 3001 (UI only) |
| `backend/`  | Django 6 + DRF + PostgreSQL            | **The API** — all data access    |
| `mobile/`   | Expo / React Native (SDK 54)           | Delivery rider app               |

The console is a separate package with its own deployment, not a route inside
the storefront. It used to be the latter; that version had no role checks and
was removed.

> `backend/` is its own git repository (`edawr-backend`) with its own remote, so
> the root repo ignores it. Commit backend changes from inside `backend/`.

The frontend serves no API routes; every request goes to Django on port 8000.
See `backend/README.md` for the endpoint table.

## How an order actually flows

```
customer                store manager            rider
────────                ─────────────            ─────
browse ─┐
add to cart
        │  POST /api/store/quote      (server prices the basket)
checkout┴► POST /api/store/orders  ──► Placed
                                        │ "Start packing"
                                        ▼
                                      Packing
                                        │ "Mark ready"
                                        ▼
                                      Ready ────────► appears in every nearby
                                        │              available rider's feed
                                        │              (minus ones they declined)
                                        │                    │ Accept
                                        ▼                    ▼
                                    Dispatched ◄─────── rider has it
                                        │                    │ Mark delivered
                                        ▼                    ▼
                                    Delivered
```

Cancelling is legal from `Placed`, `Packing` or `Ready` — while the goods are
still in the store — and puts the stock back. Once a rider has the order it is
too late, and the tracking page says so.

The legal transitions live in `Order.TRANSITIONS` and are enforced by
`Order.advance_status()`. Nothing anywhere assigns `order.status` directly.

## Local development

Three terminals.

### 1. Backend (the API)

Dependencies are managed with [uv](https://docs.astral.sh/uv/).

The API runs against **PostgreSQL**, not SQLite. The row locks checkout depends
on to stop the last unit of stock being sold twice are a no-op on SQLite, so a
suite that passes there leaves the invariant unverified.

```bash
psql -U postgres -c "CREATE ROLE edawr LOGIN PASSWORD 'choose-one';"
psql -U postgres -c "CREATE DATABASE edawr OWNER edawr ENCODING 'UTF8';"
psql -U postgres -c "ALTER ROLE edawr CREATEDB;"   # for the test database

cd backend
cp .env.example .env          # then set DATABASE_URL and the two secrets
uv sync                       # creates .venv from uv.lock
uv run manage.py migrate
uv run manage.py seed         # 8 categories, 33 products, 5 sample orders
uv run manage.py runserver 8000
```

Interactive API docs: http://localhost:8000/docs
Seeded admin login: `admin@edawr.local` / `admin1234`

### 2. Storefront and console

Two packages, two ports, the same one environment variable.

```bash
cd frontend && cp .env.example .env && npm install && npm run dev   # :3000
cd admin    && cp .env.example .env && npm install && npm run dev   # :3001
```

Scripts in both: `npm run dev` · `npm run build` · `npm run start` ·
`npm run lint` · `npm test`

`backend/.env` must list both origins in `CORS_ORIGINS`, or the console renders
every screen while every request inside them is blocked.

### 3. Mobile (rider app)

```bash
cd mobile
npm install
npm start                     # Expo dev server / QR code
```

On a physical phone the app auto-detects your computer's LAN IP on port 8000.
Start the backend with `uv run manage.py runserver 0.0.0.0:8000` so the phone
can reach it. Seeded rider: `+919000000002` / PIN `4813`.

## Tests

```bash
cd backend  && uv run manage.py test       # 348 tests, ~13s (Postgres)
cd frontend && npm test                    # 131 tests, ~4s
cd admin    && npm test                    # 40 tests, ~7s
```

CI runs all three on every push — see `.github/workflows/ci.yml`.

The backend suite is the substantial one: pricing arithmetic, the state machine,
permissions, what each serializer must never leak, opening hours, the delivery
zone, failed deliveries, and upload type-sniffing. It runs against Postgres,
which is the point — `select_for_update()` is a no-op on SQLite, so the lock
that stops the last unit of stock being sold twice would be unverified there.

The storefront suite is pure logic only, because `@testing-library/react` is not
installed there: the cart store (persistence, cross-tab sync, malformed input,
quota failures), money formatting, and the delivery-zone helper. `admin/` does
install it and does render components.

**The mobile app has no tests and no test runner.** `npx tsc --noEmit` and
`npx expo-doctor` are its only automated checks.

## Architecture

```
  Next.js :3000  ──┐
  the storefront   │
                   │
  Next.js :3001  ──┼──►  Django/DRF :8000  ──►  PostgreSQL
  the console      │      /api/* routes         + /uploads/*
                   │      (Bearer JWT)
  Expo rider app ──┘
```

Three clients, one API, one database. The two web apps deploy separately and
share nothing but the shape of the JSON.

### The rules that hold this together

**Money is never computed on the client.** The storefront sends product ids and
quantities; the server prices the basket in `Decimal` and stores the result.
`/api/store/quote` exists so the cart drawer shows the same arithmetic that will
charge the customer, rather than a parallel implementation in TypeScript that
drifts the first time a fee changes.

**The public API returns a narrower shape.** `StoreProductSerializer` omits cost
price, supplier, shelf location and exact stock. It is a separate class from the
admin `ProductSerializer` so exposing margin data would take a deliberate edit,
not a forgotten exclusion.

**Order tracking is authorised by possession of a token.** A customer has no
account, so `/api/store/orders/{token}` is keyed on a 190-bit random string
rather than the order id. There is no sequence to walk.

**The rider comes from the token, never the request body.** `accept`, `reject`
and `status` take no rider id, and each checks ownership.

**One API base URL per app.** `src/lib/api.ts` is the only place the backend
host appears, and `src/proxy.ts` reads the same variable to name the API origin
in the Content Security Policy. Get it wrong and the browser blocks every
request and every product image; it is the first thing to check when a screen
renders and stays empty.

**401 ends a session; 403 does not.** 401 means the server does not know who you
are — clear the token and go to the login screen. 403 means it knows exactly who
you are and this particular thing is not yours: show the message, keep the
session. Conflating them signs a manager out of pages they merely lack rights
for, and used to sign riders out mid-shift.

## Deploying

**`PRODUCTION.md` is the one deployment document** — the architecture, the
runbook, every environment variable, and an honest list of what is still
missing. It replaced three overlapping files that had started to contradict each
other.

The startup check in `api/apps.py` refuses to boot with insecure configuration,
and each item it rejects is exploitable rather than untidy:

```bash
ENVIRONMENT=production
JWT_SECRET=$(uv run python -c "import secrets; print(secrets.token_urlsafe(48))")
DJANGO_SECRET_KEY=$(uv run python -c "import secrets; print(secrets.token_urlsafe(48))")
ALLOWED_HOSTS=api.your-domain
CORS_ORIGINS=https://your-storefront,https://your-console
CACHE_URL=rediss://your-redis:6379/0
DATABASE_URL=postgres://user:password@host:5432/edawr
```

## Known gaps

The full list, with the reasoning, is Part 4 of `PRODUCTION.md`. The three that
matter most:

- **No automated backups.** The highest-value item in the project. Order history
  *is* the business record for a cash business.
- **Cash is recorded as intent, never as collection.** There is no `paid_at` and
  no reconciliation view, so "how much cash does this rider owe the till?" can
  only be answered by summing order totals and trusting them.
- **No out-of-band notification.** A customer who closes the tracking tab has no
  idea when the rider is coming.

## Regenerating the app icons

`mobile/assets/*.png` are generated rather than drawn, so the brand colour is
defined once:

```bash
python mobile/scripts/make-icons.py
```

No imaging library required — it writes the PNGs directly. Edit `BRAND_TOP`,
`BRAND_BOTTOM` or the `BOLT` polygon at the top of that file and re-run. Replace
it wholesale the moment you have a real logo; this exists so the app is
submittable rather than because a lightning bolt is the final answer.
