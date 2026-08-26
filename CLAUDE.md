# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Overview

eDawr is a **quick-commerce** grocery platform for Aizawl, Mizoram: customers
order from a web storefront and a rider delivers on a 15-minute promise.

- `frontend/` — Next.js 16 (App Router, React 19, Tailwind v4). The customer
  storefront. **UI only — it serves no API routes.**
- `admin/` — Next.js 16, the **staff console** for Admins and Managers. A
  separate package with its own design system and its own deployment. UI only.
- `backend/` — Django 6 + DRF + **PostgreSQL**. **This is the API.**
- `mobile/` — Expo / React Native (SDK 54), the rider app.

`frontend/` used to contain a single-route admin screen at `/admin` with no role
checks. It was removed in the storefront rebuild; `admin/` is the console.

Supabase and the WhatsApp ordering module were removed. The backend was migrated
from FastAPI/SQLAlchemy/Pydantic to Django/DRF; no FastAPI code remains. Do not
reintroduce a client-side database, and do not reintroduce FastAPI.

**`backend/` is a separate git repository** with its own remote
(`edawr-backend`), ignored by the root repo. Commit backend changes from inside
`backend/`. Do not `git add backend` at the root — that records a gitlink which
clones as an empty directory.

## Commands

Backend (from `backend/`). **Dependencies are managed with uv, not pip** — there
is no `requirements.txt`. Never run `pip install`; use `uv add`, which updates
`pyproject.toml` and `uv.lock` together.
```bash
uv sync                                  # install from uv.lock
uv run manage.py migrate                 # create/update the schema
uv run manage.py seed                    # load sample data (deletes all rows)
uv run manage.py runserver 8000          # use 0.0.0.0:8000 for the phone
uv run manage.py makemigrations          # after editing api/models.py
uv run manage.py test                    # 446 tests, ~10s on Postgres
uv run manage.py check --deploy          # before shipping
```

Frontend (from `frontend/`): `npm run dev` · `npm run build` · `npm run lint` ·
`npm test` (vitest)
Console (from `admin/`): the same four, on **port 3001**. It has
`@testing-library/react` installed, so unlike `frontend/` it can render
components in tests.
Mobile (from `mobile/`): `npm start` · `npx expo-doctor`

Two extra management commands exist because `seed` is destructive and cannot be
re-run on a live database:
```bash
uv run manage.py seed_admin --email you@example.com --password '...' --role admin
uv run manage.py demo_clear --dry-run     # then without the flag
```

**The mobile app has no tests and no test runner.** `frontend/` has no
`@testing-library/react`, so its tests are pure logic plus two files that render
by hand — `ImageFallback.test.tsx` through `react-dom/server`, and
`useDraft.test.tsx` through `react-dom/client` and React's own `act`, driving
the hook via real DOM events because the compiler's lint rules forbid a
component writing to anything outside itself during render. That covers a hook
and a presentational component; it does not scale to `CheckoutPage`. `admin/`
does install Testing Library and does render components. End-to-end
coverage is still missing everywhere; if you touch a package substantially,
consider whether you can leave a test behind.

CI (`.github/workflows/ci.yml`) runs the two web suites plus lint and a
production build on every push, and fails if any Next.js route starts
prerendering — see the CSP note below. The backend's identical job lives in the
`edawr-backend` repository and runs against a Postgres service container.

**Deployment lives in one place: `PRODUCTION.md` at the root.** It replaced
`DEPLOYMENT-HANDOFF.md`, `BACKLOG.md` and `backend/docs/deployment.md`, which
described overlapping parts of the same deploy and had begun to contradict each
other about what was already built. Part 4 of it is the current gap list — read
that before proposing something as "missing".

## The rules that matter

### Money is Decimal, and it is never computed on the client
Every price, fee and total is `DecimalField` server-side and quantised
ROUND_HALF_UP in `api/pricing.py`. A float cannot represent 0.1, so a basket
totalled in floats drifts — that is a rounding error handed to a customer on a
bill.

The checkout request carries **product ids and quantities only**. It carries no
price, no fee and no total, and the server reads none from it. `/api/store/quote`
exists so the cart drawer shows the same arithmetic that will charge the
customer. Do not add up line totals in TypeScript — that is a second pricing
engine, and it will disagree with the server the first time a fee changes.

DRF is configured with `COERCE_DECIMAL_TO_STRING = False` so money arrives as a
JSON number, because the clients display it rather than recompute it.

### Order status is a state machine
Legal moves are declared in `Order.TRANSITIONS` and enforced by
`Order.advance_status()`, which also stamps the matching timestamp exactly once.
**Never assign `order.status` directly.** An illegal move raises `ValueError`,
which views turn into a 409 — a conflict with the order's state, not a bad
request.

```
Placed → Packing → Ready → Dispatched → Delivered
   └────────┴────────┴──────────────────→ Cancelled
                       Dispatched → Ready    (rider hands it back)
                       Dispatched → Failed   (attempted, did not happen)
```

Cancelling goes through `checkout.cancel_order()`, never `advance_status` alone,
because it must also restore stock under a lock.

`Failed` is terminal and restores **nothing** — when the rider reports it the
bag is on a bike, and restocking then would list units the store cannot pick.
`checkout.restock_failed_order()` is the separate step, behind
`POST /api/orders/{id}/restock`, made idempotent by `restocked_at`. It requires
a reason: that sentence is what the store reads when the customer rings.

### Two product serializers, on purpose
`ProductSerializer` (admin) carries cost price, supplier and shelf location.
`StoreProductSerializer` (public) carries none of them and reduces `stock` to
`in_stock` + `low_stock`. They are separate classes so exposing margin data would
need a deliberate edit rather than a forgotten exclusion. Same reasoning splits
`OrderSerializer` from `OrderTrackingSerializer`.

### Checkout is one transaction, with rows locked in primary-key order
`api/checkout.py` locks product rows with `select_for_update()`, ordered by id so
two baskets containing the same products cannot deadlock. Stock check, item
insert and stock decrement all land together or not at all. The lock is a no-op
on SQLite — which is why `DATABASE_URL` must point at Postgres before real
traffic.

### Checkout is idempotent on `Idempotency-Key`
A retried POST used to create a second order and decrement stock twice, and on
Aizawl mobile data a retry is the normal case. The key arrives as a **header**,
never a body field — the checkout body is the money boundary and stays ids and
quantities only — and is deduped by a unique constraint on
`Order.idempotency_key`. A replay answers **200**, not 201: it created nothing.

`place_order` is a thin non-atomic wrapper around `_place_order`. The ordering
is load-bearing: the dedupe read is *outside* the transaction, or every retry
holds product locks while it looks; and the `IntegrityError` recovery is in the
wrapper, because a rolled-back atomic block cannot run another query.

The storefront's key is derived from the basket (`lib/checkout-attempt.ts`) and
persisted. A key that outlived its basket would be worse than none: the server
would recognise it and hand back the *previous* order, so a second order would
silently never be placed.

### Reaching Delivered records the cash
`payment_method = "cod"` is an intention. `paid_at`, `amount_collected` and
`collected_by` are what happened, and `advance_status()` stamps the first two on
the move to Delivered — in the model, not in a view, so no route there can omit
them. `amount_collected` defaults to `grand_total`; a rider revises it down when
the customer paid short, and above the total is a 400 (that is change owed back,
not revenue).

`GET /api/analytics/cash` is the only endpoint in `analytics.py` that buckets by
`paid_at` rather than `created_at`, because it answers "what is in the till
tonight" and an order placed at 23:50 and delivered at 00:05 is tomorrow's cash.

### A notification is a prompt, never the delivery mechanism
`api/push.py` wakes a rider's phone when an order is assigned to them or lands
in the pull feed; `mobile/src/push.ts` registers the handset. The rider app's
fifteen-second poll remains the source of truth — every path here is
best-effort, off unless `PUSH_ENABLED`, and silent on every failure, because it
runs inside the transaction that assigns an order and must never be able to fail
it. That is the same contract `api/audit.py` has, for the same reason.

Two consequences worth knowing before editing it. **The send is deferred to
`transaction.on_commit` and then to a daemon thread**: never buzz a phone about
an assignment a rollback undid, and never hold `select_for_update` locks across
a call to a third party. **The commit hook has its own `try`** — hooks run after
the caller returned, inline on the connection, so anything raised there is a 500
on a request whose work already committed.

`RiderDevice.expo_token` is unique across the table, not per rider: a handset
that changes hands at shift change must belong to whoever signed in last, or one
order buzzes two riders. Notifications carry the address and the amount only —
they render on a lock screen, so the customer's name and number stay in the app.

### Auth
- `api/authentication.py` answers *who is this?* and never rejects.
- `api/permissions.py` answers *may they?* and rejects.
- Admin and rider tokens share a secret and are told apart by a `typ` claim.
  Each authentication class returns `None` — never raises — for the other's
  token, because DRF stops at the first class that returns a user.
- **The rider comes from the token, never the body.** `accept`/`reject`/`status`
  take no rider id and each checks ownership.
- `is_active` is re-checked on every request, so deactivating a rider revokes
  access immediately rather than when their 12-hour token expires.
- **Tokens carry `ver`, and a bump signs out every device.** `ver` is the
  account's `token_version`, compared against the row the auth class already
  reads; `POST /api/auth/logout` (and the rider's) increments it, as does a
  password or PIN reset. A retired token is **401** — we no longer know who is
  calling — so the client clears its session. Per-device revocation would need a
  blacklist that outlives the token; this is deliberately coarser.
- **`ait` bounds the session, not the token.** `/api/auth/me` mints a fresh
  token on every call, so without a claim that survives refresh a stolen token
  renews itself forever. `ait` records when the session began, is copied forward
  unchanged, and `/me` refuses past `SESSION_MAX_HOURS` (a week). Ordinary
  requests are unaffected — only renewal is capped.
- A valid token of the wrong kind gets **403**, not 401. 401 means "I don't know
  who you are" and is what makes the web app clear its stored session; clearing
  it on 403 would sign an admin out of pages they merely lack rights for.

### Two console roles, decided by the row and never by the token
`AdminUser.role` is `admin` or `manager`. A **Manager** runs the store: products,
categories, orders, riders, prices, settings, every figure in analytics. An
**Admin** adds exactly two things — `/api/admins` (creating accounts and changing
roles) and `/api/audit`.

- `IsAdmin` means "an active AdminUser", i.e. either role. `IsOwnerAdmin` is the
  Admin-only guard. **Do not change `IsAdmin`** — `test_auth.py` asserts the
  401-vs-403 contract through it.
- **The role is not a JWT claim.** `AdminJWTAuthentication` re-reads the row on
  every request, which is what makes `is_active` an immediate revocation; the
  role inherits that, so a demotion takes effect on the next request rather than
  in twelve hours. Adding a role claim would trade that for a stale copy.
- `admins.py` refuses, with **409**, to let you change your own role, deactivate
  yourself, or demote the last active Admin. Without the third, one click leaves
  the console unadministrable.

### Every mutating admin view records who did it
`api/audit.py::record(...)` writes one `AuditLog` row. It never raises — an
audit failure must not fail the request that already committed — and it strips
anything named like a credential, so a PIN reset is logged as `pin_reset` rather
than as a PIN.

### Operational settings are a table, commerce settings are the environment
`StoreSettings` (singleton, `pk=1`) holds opening hours, the accept-orders kill
switch, the delivery radius and the store's coordinates. Fees, thresholds and
the delivery tiers stay in environment variables.

The line is *operational vs commercial*. The first four change within a shift
and the person changing them is behind the counter, so requiring a redeploy to
pause checkout during a power cut means the shop keeps promising 15-minute
delivery it cannot make. Prices are decisions that should change with the care
of a deploy. `GET`/`PATCH /api/settings`, either console role, audited.

`StoreSettings.load()` is a plain SELECT with a `get_or_create` fallback, not
`get_or_create` outright — it is on the checkout path and on every
`/api/store/config`, and the savepoint plus INSERT attempt was measurable.

### Coordinates are nullable, and that is load-bearing
`Order.customer_latitude/longitude` are `null=True` with no default. They used
to default to the *store's own* position, so an order carrying no position
recorded the customer as standing at the counter: every rider measured 0.00 km
away, the radius filter matched everyone, and the rider app showed a confident,
false `0.0 km`. Geolocation is opt-in at checkout and declining it is a
supported outcome — `dispatch._rank` returns every rider at distance `None` for
such an order, sorted last.

### Public endpoints are the security boundary
`api/urls.py` marks which routes are public. Checkout and tracking are
unauthenticated because a customer has no account, so each is throttled and
tracking is keyed on a 190-bit token rather than a sequential id.

## Frontend specifics

### This is not the Next.js you know
Next 16 has breaking changes (`frontend/AGENTS.md`). Consult
`frontend/node_modules/next/dist/docs/` before writing framework code. In
particular:
- **Middleware is called Proxy.** `src/proxy.ts` is the current convention, not
  dead code. It carries the CSP with a per-request nonce.
- `params` in a dynamic route is a **Promise** and must be awaited.
- Turbopack is the default for `dev` and `build`.

### `await connection()` in the root layout is load-bearing
Both apps' root layouts call it. The CSP uses `script-src 'strict-dynamic'`,
which makes a CSP3 browser ignore `'self'` and trust only nonced scripts — and a
prerendered page's script tags were written at build time with no nonce, so the
browser blocks every one and the page never hydrates. **It only breaks in
`next build`**; `next dev` renders per request, so it is invisible locally and
appears first on the deployed site. CI fails the build if any route prerenders.

### The CSP names the API origin
`src/proxy.ts` derives `connect-src` and `img-src` from `NEXT_PUBLIC_API_URL`.
Get that wrong and the browser blocks the catalogue and every product image, and
the store renders empty. It is the first thing to check when nothing loads.

### Never set state synchronously inside an effect
`react-hooks/set-state-in-effect` is an error here, and the fix is structural
rather than a suppression: tag fetched data with the query that produced it and
**derive** the loading flag, and refresh by bumping a token from an event
handler. See `Storefront.tsx` and `ManagerDashboard.tsx`.

### The cart is an external store, not context
`src/lib/cart-store.ts` + `useSyncExternalStore`. No provider, no hydration
mismatch, and two browser tabs share one basket. The cart holds a **display**
snapshot of prices; the bill always comes from the server.

### Failures are reported, same-origin
All three clients POST to `/api/client-errors`, and both CSPs name
`/api/csp-report`. Same-origin rather than a third-party collector because
`proxy.ts` builds `connect-src` from `NEXT_PUBLIC_API_URL` and allows nothing
else — and because a CSP violation is sent by the browser's reporting agent, so
it needs no `connect-src` entry at all. Both endpoints are public, throttled,
and **allowlist every field they log**: an endpoint that logged whatever arrived
would be a PII sink any passer-by could fill.

Every reporter is written so it cannot throw and cannot block. It runs at the
moment the app is already failing, and an error path that can itself fail is one
that gets retried in a loop.

### Conventions
- Path alias `@/*` → `src/*`.
- Product images use plain `<img>`, not `next/image`: the host is only known at
  runtime, so `remotePatterns` cannot be configured at build time without baking
  it in. The lint rule is disabled per-file with that reasoning.
- **Do not run `git push`.** Stage and commit; leave pushing to the user.

## Backend conventions & gotchas

- Error responses are always `{"detail": "..."}` (`api/exceptions.py`). Raise
  `NotFound`/`ValidationError`, or return `Response({"detail": ...}, status=...)`.
  Never return a bare error dict.
- A bad request body is **400**, not 422.
- **DRF `CharField` rejects `""`.** Optional text fields use the shared
  `OPTIONAL_TEXT` kwargs.
- **`default=` is what makes PUT replace.** `required=False` alone leaves an
  omitted field unchanged.
- URLs carry **no trailing slash** and `APPEND_SLASH = False`, because a
  redirected POST loses its body.
- Nest-heavy queries need `.prefetch_related("items")` and
  `.select_related("delivery_boy")`, or listing 50 orders is 101 queries.
- `OrderItem.product` is `on_delete=PROTECT` on purpose; the delete view counts
  references first and returns a 409 telling the caller to deactivate instead.
- Uploads return a **relative** `/uploads/<name>` path; the frontend prefixes it
  via `assetUrl()`.
- Phone numbers are normalised to `+91XXXXXXXXXX` by `api/validators.py` on both
  storage and login. Two spellings of one number would otherwise be two accounts.
- `manage.py seed` deletes and reinserts **rows** only; it never touches the
  schema, but it does wipe hand-added admins.
- Migrations are source code — commit them, and write them to survive existing
  data. `0003_quick_commerce` is the worked example: it renames the old status
  vocabulary, backfills totals, dedupes category names before a unique
  constraint, and populates tracking tokens row by row before making the column
  unique (a single `AddField` with a callable default gives every row the *same*
  value).
- Tests swap in an MD5 password hasher (`settings.TESTING`). PBKDF2 must stay
  slow in production; it turned a 6-second suite into 53 seconds.
