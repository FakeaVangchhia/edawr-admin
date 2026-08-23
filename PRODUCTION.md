# eDawr in production

The single deployment document for this project. It replaces
`DEPLOYMENT-HANDOFF.md`, `BACKLOG.md` and `backend/docs/deployment.md`, all three
of which said overlapping and by the end contradictory things.

Read Part 1 before touching anything. Part 2 is the runbook. Part 3 is the
reference you will come back to. Part 4 is what is still missing, stated plainly
so nobody is surprised by it at the wrong moment.

> **This document contains no secrets and must stay that way.** Every value in
> it is a placeholder. Never paste a real `DATABASE_URL`, `JWT_SECRET`,
> `DJANGO_SECRET_KEY` or `CACHE_URL` into a chat window, an issue, or a
> screenshot. If you already have, rotate it — a leaked `JWT_SECRET` lets
> anyone who knows an admin's email address forge an admin token.

---

# Part 1 — What you are deploying

eDawr is a quick-commerce grocery platform for Aizawl, Mizoram. Customers order
from a web storefront and a rider delivers on a 15-minute promise. Expected load
for the first six months is roughly 500 users total.

| Package | Stack | Role | Deployed to |
|---|---|---|---|
| `backend/` | Django 6 + DRF, Python 3.14 | **The API.** All data access. | Cloud Run |
| `frontend/` | Next.js 16, React 19, Tailwind v4 | Customer storefront. UI only. | Vercel |
| `admin/` | Next.js 16, React 19, Tailwind v4 | Staff console, port 3001. UI only. | Vercel (second project) |
| `mobile/` | Expo / React Native SDK 54 | Rider app. | EAS → app stores |

**`backend/` is a separate git repository** with its own remote
(`edawr-backend`), and the root repo gitignores it. Commit backend changes from
inside `backend/`. Never `git add backend` from the root — that records a
gitlink, which clones as an empty directory.

## The target architecture

```
                     ┌──────────────────────────────┐
  Customer  ────────▶│  Vercel — frontend/          │
  browser            │  the storefront, :3000       │
                     └──────────────┬───────────────┘
                                    │
  Store staff ──────▶┌──────────────┴───────────────┐
  browser            │  Vercel — admin/             │
                     │  the console, :3001          │
                     └──────────────┬───────────────┘
                                    │  HTTPS, CORS-allowed origins
                                    ▼
  Rider app ────────▶┌──────────────────────────────┐
  (Expo, no CORS)    │  Cloud Run, asia-south1      │
                     │  backend/ — Django + DRF     │
                     │  gunicorn, 512Mi, 1 vCPU     │
                     │  scale 0 → 4 instances       │
                     └───┬──────────┬──────────┬────┘
                         │          │          │
           DATABASE_URL  │  CACHE_URL          │  volume mount
                         ▼          ▼          ▼
                  ┌──────────┐ ┌─────────┐ ┌──────────────┐
                  │  Neon    │ │ Upstash │ │ Cloud Storage│
                  │ Postgres │ │  Redis  │ │ edawr-uploads│
                  │ (pooled) │ │throttles│ │ product imgs │
                  └──────────┘ └─────────┘ └──────────────┘
```

| Piece | Why it exists | Cost |
|---|---|---|
| Cloud Run | Runs the container, scales to zero | ₹0 in the free tier |
| Neon | Postgres. **Cloud SQL has no free tier** | ₹0 (free tier) |
| Upstash | Redis for throttle counters | ₹0 up to 10k commands/day |
| Cloud Storage | Product images survive redeploys | ~₹10/mo |
| Vercel | Both Next.js apps | ₹0 (Hobby) |

**The core constraint: Cloud Run is stateless and this app has state.** The
container filesystem is wiped on every deploy and is not shared between
instances, so a SQLite file and a local `uploads/` directory both stop working
silently the moment you deploy a second revision or scale to a second instance.
Auditing this app found exactly three pieces of state, and the three external
services above are each one of them:

| State | Was | Is |
|---|---|---|
| Relational data | SQLite file on disk | Neon Postgres |
| Throttle counters | Per-process memory | Upstash Redis |
| Product images | `backend/uploads/` on disk | Cloud Storage bucket |

## Invariants — do not break these

Each of these exists because the alternative caused a real bug. They are not
style preferences.

**1. Money is `Decimal`, and it is never computed on the client.**
Every price, fee and total is a `DecimalField`, quantised ROUND_HALF_UP in
`api/pricing.py`. A float cannot represent `0.1`, so a basket totalled in floats
drifts — a rounding error handed to a customer on a bill. The checkout request
carries **product ids and quantities only**: no price, no fee, no total, and the
server reads none from the body. `/api/store/quote` exists so the cart shows the
same arithmetic that will charge the customer, and it returns per-line totals
(`lines`) precisely so no client has to multiply a price by a quantity.

**2. Order status is a state machine.** Legal moves live in `Order.TRANSITIONS`
and are enforced by `Order.advance_status()`, which stamps the matching
timestamp exactly once. **Never assign `order.status` directly.** An illegal
move raises `ValueError`, which views turn into **409** — a conflict with the
order's state, not a bad request.

```
Placed → Packing → Ready → Dispatched → Delivered
   └────────┴────────┴──────────────────→ Cancelled
                       Dispatched → Ready    (rider hands it back)
                       Dispatched → Failed   (attempted, did not happen)
```

`Cancelled` restores stock immediately, because the goods never left the shop.
`Failed` is terminal and restores **nothing** — the bag is on a bike.
`POST /api/orders/{id}/restock` is the separate step a manager takes when the
goods are physically back on the shelf, made idempotent by `restocked_at`.

**3. Two serializers per resource, on purpose.** `ProductSerializer` (admin)
carries cost price, supplier and shelf location. `StoreProductSerializer`
(public) carries none of them and reduces `stock` to `in_stock` + `low_stock`.
Separate classes so exposing margin data needs a deliberate edit rather than a
forgotten exclusion. `OrderSerializer` and `OrderTrackingSerializer` split for
the same reason — note `restocked_at` is on the first and not the second.

**4. Checkout is one transaction, rows locked in primary-key order.**
`api/checkout.py` locks product rows with `select_for_update()`, ordered by id
so two baskets containing the same products cannot deadlock. **The lock is a
no-op on SQLite**, which is precisely why production must be Postgres and why
CI runs against a Postgres service container.

**5. Auth boundaries.** `api/authentication.py` answers *who is this?* and never
rejects. `api/permissions.py` answers *may they?* and rejects. Admin and rider
tokens share a secret and are told apart by a `typ` claim; each auth class
returns `None` (never raises) for the other's token, because DRF stops at the
first class that returns a user. **The rider comes from the token, never the
body.** A valid token of the wrong kind gets **403, not 401** — 401 means "I do
not know who you are" and is what makes a client clear its stored session.

**6. Two console roles, decided by the row and never by the token.**
`AdminUser.role` is `admin` or `manager`. A Manager runs the store. An Admin adds
exactly two things: `/api/admins` and `/api/audit`. The role is deliberately not
a JWT claim — `AdminJWTAuthentication` re-reads the row on every request, which
is what makes `is_active` an immediate revocation, and the role inherits that.

**7. Conventions that bite.** Errors are always `{"detail": "..."}`. A bad body
is **400, not 422**. URLs carry **no trailing slash** and `APPEND_SLASH = False`,
because a redirected POST silently loses its body. DRF `CharField` rejects `""`
— optional text uses the shared `OPTIONAL_TEXT` kwargs. Dependencies are managed
with **uv, not pip**; there is no `requirements.txt`, so never run
`pip install`, use `uv add`.

## Next.js 16 is not the Next.js you know

`frontend/AGENTS.md` says this and it is worth repeating here, because one of
these will cost you a production outage rather than an afternoon.

- **Middleware is called Proxy.** `src/proxy.ts` is the current convention, not
  dead code. It carries the CSP with a per-request nonce.
- **`await connection()` in the root layout is load-bearing.** The CSP uses
  `script-src 'strict-dynamic'`, which tells a CSP3 browser to ignore `'self'`
  entirely and trust only scripts carrying the nonce. A statically prerendered
  page ships HTML whose `<script>` tags were written at build time and carry no
  nonce, so the browser blocks every one: the page paints and never hydrates.
  **This only breaks in `next build`** — `next dev` renders per request — so it
  is invisible in development and appears for the first time on the deployed
  site. Both apps call it; CI fails the build if any route starts prerendering.
- `params` in a dynamic route is a **Promise** and must be awaited.
- Turbopack is the default for `dev` and `build`.
- **Never set state synchronously inside an effect.**
  `react-hooks/set-state-in-effect` is an error here and the fix is structural:
  tag fetched data with the query that produced it and *derive* the loading
  flag. See `useQuote`, `useResource`, and the settings form in the console.

---

# Part 2 — The runbook

## Prerequisites

Accounts: Google Cloud (billing enabled — the free tier still requires a billing
account), Neon, Upstash, Vercel, Expo. Tools: `gcloud`, Node 20+, `uv`.

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com
```

## Step 1 — Postgres (Neon)

Create a project in the region nearest Mumbai. Copy the **pooled** connection
string — the hostname contains `-pooler`.

```
DATABASE_URL=postgres://user:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/edawr?sslmode=require
```

**Take the pooled endpoint, not the direct one.** This is the single most
important Neon decision here and Part 3 explains why.

## Step 2 — Redis (Upstash)

Copy the **TLS** URL — the scheme is `rediss://`, with two s's.

```
CACHE_URL=rediss://default:PASSWORD@xxx.upstash.io:6379
```

Not optional: `check_production_safety()` in `api/apps.py` refuses to boot
without it. DRF keeps throttle counters in the cache and the default cache is
per-process, so without shared Redis `LOGIN_RATE_LIMIT` is silently multiplied
by your instance count — and that limit is the only thing between a 4-digit
rider PIN and an exhaustive search.

## Step 3 — The uploads bucket

```bash
gcloud storage buckets create gs://edawr-uploads \
  --location=asia-south1 --uniform-bucket-level-access
```

Keep it private. It is reached through the volume mount, not the public
internet. Part 3 explains why it is a mount rather than public object storage.

## Step 3b — The backups bucket, and why it is a second one

```bash
gcloud storage buckets create gs://edawr-backups \
  --location=asia-south1 --uniform-bucket-level-access
```

**It must not be the uploads bucket.** `SERVE_MEDIA=true` in production makes
Django serve everything under `/app/uploads` to anyone who asks — that is a
deliberate trade explained in Part 3 — so a `pg_dump` written there would be a
downloadable copy of every customer's name, phone number and address, reachable
by guessing a filename. `manage.py backup_database` refuses to run if
`BACKUP_DIR` resolves inside `MEDIA_ROOT`, rather than trusting anyone to have
noticed.

Grant it to the same service account as the uploads bucket in Step 4, and mount
it alongside the other volume in Step 5:

```
  --add-volume name=backups,type=cloud-storage,bucket=edawr-backups,mount-options="uid=10001;gid=10001;file-mode=600;dir-mode=700" \
  --add-volume-mount volume=backups,mount-path=/app/backups
```

`file-mode=600`, tighter than uploads' `644`. Nothing serves these and nothing
else should read them.

## Step 4 — Secrets

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))" \
  | gcloud secrets create edawr-jwt-secret --data-file=-
python -c "import secrets; print(secrets.token_urlsafe(48))" \
  | gcloud secrets create edawr-django-secret --data-file=-
printf '%s' "$DATABASE_URL" | gcloud secrets create edawr-database-url --data-file=-
printf '%s' "$CACHE_URL"    | gcloud secrets create edawr-cache-url --data-file=-
```

Two different secrets on purpose. One value signing both API tokens and
everything Django signs means rotating it to contain a leaked admin token also
invalidates every CSRF token, and a leak in either is a leak in both.

Grant the runtime service account access:

```bash
PROJECT=$(gcloud config get-value project)
SA="$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

for s in edawr-jwt-secret edawr-django-secret edawr-database-url edawr-cache-url; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done

gcloud storage buckets add-iam-policy-binding gs://edawr-uploads \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
```

## Step 5 — Deploy the API

From `backend/`:

```bash
gcloud run deploy edawr-api \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 512Mi --cpu 1 \
  --max-instances 4 --min-instances 0 \
  --add-volume name=uploads,type=cloud-storage,bucket=edawr-uploads,mount-options="uid=10001;gid=10001;file-mode=644;dir-mode=755" \
  --add-volume-mount volume=uploads,mount-path=/app/uploads \
  --set-secrets "JWT_SECRET=edawr-jwt-secret:latest,DJANGO_SECRET_KEY=edawr-django-secret:latest,DATABASE_URL=edawr-database-url:latest,CACHE_URL=edawr-cache-url:latest" \
  --set-env-vars "ENVIRONMENT=production,SERVE_MEDIA=true,ALLOWED_HOSTS=placeholder.invalid,CORS_ORIGINS=https://placeholder.invalid"
```

Three things that are easy to get wrong:

- **`uid=10001;gid=10001` must match the `USER` in the Dockerfile.** Without it
  the bucket mounts root-owned and every product image upload fails with a
  permission error, at the moment an admin first tries to add a product.
- **`--allow-unauthenticated` is correct.** The catalogue, checkout and order
  tracking are deliberately public. Cloud Run IAM is not this app's auth
  boundary — `api/permissions.py` is.
- **`--max-instances 4`** bounds your database connection count. See Part 3.

The two placeholders are a real circular dependency: the API needs the
frontends' origins for CORS, and the frontends need the API's URL. Read the
assigned URL and close the loop:

```bash
gcloud run services describe edawr-api --region asia-south1 --format='value(status.url)'

gcloud run services update edawr-api --region asia-south1 \
  --update-env-vars "ALLOWED_HOSTS=edawr-api-xxxxx-el.a.run.app"
```

`ALLOWED_HOSTS` takes the **hostname only** — no scheme, no trailing slash.

HTTPS needs no configuration: `SECURE_SSL_REDIRECT` and
`TRUST_PROXY_SSL_HEADER` both default to true outside development. Trusting
`X-Forwarded-Proto` is safe *specifically because* Cloud Run terminates TLS and
there is no way to reach the container around it — on a directly-reachable host
a client could forge that header.

## Step 6 — Migrations, as a separate job

Cloud Run has no release phase. **Never migrate on web-container startup** —
with more than one instance they race each other.

```bash
IMAGE=$(gcloud run services describe edawr-api --region asia-south1 \
  --format='value(spec.template.spec.containers[0].image)')

gcloud run jobs create edawr-migrate \
  --image "$IMAGE" --region asia-south1 \
  --command python --args manage.py,migrate \
  --set-secrets "JWT_SECRET=edawr-jwt-secret:latest,DJANGO_SECRET_KEY=edawr-django-secret:latest,DATABASE_URL=edawr-database-url:latest,CACHE_URL=edawr-cache-url:latest" \
  --set-env-vars "ENVIRONMENT=production,ALLOWED_HOSTS=edawr-api-xxxxx-el.a.run.app,CORS_ORIGINS=https://placeholder.invalid"

gcloud run jobs execute edawr-migrate --region asia-south1 --wait
```

On every later deploy: build → update the job's `--image` → run the job → route
traffic.

Migration `0007` creates the `store_settings` row, so the store has opening
hours and a delivery radius before the first request rather than being
configured by whichever request happens to arrive first.

## Step 6b — Scheduled backups

**Do this before the first real order.** Order history *is* the business record
of a cash shop, and Neon's free tier keeps a short restore window that is not a
backup strategy.

```bash
IMAGE=$(gcloud run services describe edawr-api --region asia-south1 \
  --format='value(spec.template.spec.containers[0].image)')

gcloud run jobs create edawr-backup \
  --image "$IMAGE" --region asia-south1 \
  --command python --args manage.py,backup_database \
  --add-volume name=backups,type=cloud-storage,bucket=edawr-backups,mount-options="uid=10001;gid=10001;file-mode=600;dir-mode=700" \
  --add-volume-mount volume=backups,mount-path=/app/backups \
  --set-secrets "JWT_SECRET=edawr-jwt-secret:latest,DJANGO_SECRET_KEY=edawr-django-secret:latest,DATABASE_URL=edawr-database-url:latest,CACHE_URL=edawr-cache-url:latest" \
  --set-env-vars "ENVIRONMENT=production,ALLOWED_HOSTS=edawr-api-xxxxx-el.a.run.app,CORS_ORIGINS=https://placeholder.invalid,BACKUP_DIR=/app/backups"

gcloud run jobs execute edawr-backup --region asia-south1 --wait
```

Then have Cloud Scheduler run it nightly, after closing:

```bash
gcloud scheduler jobs create http edawr-backup-nightly \
  --location asia-south1 --schedule "30 17 * * *" --time-zone Asia/Kolkata \
  --uri "https://asia-south1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$(gcloud config get-value project)/jobs/edawr-backup:run" \
  --http-method POST --oauth-service-account-email "$SA"
```

Three things worth knowing:

- **`pg_dump` must be at least the server's major version.** The image installs
  `postgresql-client-17` from PGDG because Debian bookworm ships 15 and Neon
  runs 17; an older client refuses to dump a newer server. If Neon is upgraded,
  that line in the Dockerfile goes up with it.
- **Nothing is pruned until the new archive verifies.** Exit status, plausible
  size, and `pg_restore --list` can read it. A rotation that trims yesterday's
  good backup to make room for today's broken one is worse than no rotation.
- **Restore it once, now, before you need to.** A backup nobody has restored is
  a hypothesis:

  ```bash
  pg_restore --no-owner --no-privileges -d "$SCRATCH_DATABASE_URL" edawr-<stamp>.dump
  ```

## Step 7 — The first admin

**Never run `manage.py seed` against production.** It deletes every row before
inserting sample data, and it creates an admin whose password is published in
`.env.example`.

Use the purpose-built command instead, either through a `gcloud run jobs`
execution or by running `manage.py` locally against the production
`DATABASE_URL` once:

```bash
uv run manage.py seed_admin --email you@example.com --password '...' --role admin
```

## Step 8 — Both frontends on Vercel

**Two Vercel projects from one repository**, differing only by root directory.
They deploy separately on purpose: the console and the storefront have different
audiences, different release cadences and different risk.

| Project | Root directory | Environment variable |
|---|---|---|
| `edawr-storefront` | `frontend` | `NEXT_PUBLIC_API_URL=https://edawr-api-xxxxx-el.a.run.app` |
| `edawr-console` | `admin` | `NEXT_PUBLIC_API_URL=https://edawr-api-xxxxx-el.a.run.app` |

`NEXT_PUBLIC_API_URL` is read at **build** time, not only at runtime —
`proxy.ts` bakes it into the CSP. Changing it requires a redeploy, not a
restart. **If a page loads but stays empty with CSP errors in the console, this
variable is wrong.** It is the single most common failure and the first thing to
check.

Then close the CORS loop with **both** origins:

```bash
gcloud run services update edawr-api --region asia-south1 \
  --update-env-vars "CORS_ORIGINS=https://shop.example.com,https://console.example.com"
```

Comma-separated. No wildcards — the startup check rejects `*`, correctly. Miss
the console's origin and it renders every screen while every request inside them
is blocked.

## Step 9 — The rider app

Set `expo.extra.apiUrl` in `mobile/app.json` (currently `null`) to the Cloud Run
URL, or pass `EXPO_PUBLIC_API_URL` at build time. Leaving it null makes a
release build fail loudly at startup rather than silently calling localhost —
that is intentional. Development auto-detects the dev machine's LAN IP and
ignores both.

**It must be `https://`.** `src/config.ts` refuses an `http://` URL in a release
build: the rider's PIN and bearer token would cross the network in plaintext,
and Android blocks cleartext by default anyway, so such a build is insecure by
intent and broken in practice.

```bash
cd mobile && npx expo-doctor && eas build --profile production --platform android
```

## Step 10 — Verify

```bash
API=https://edawr-api-xxxxx-el.a.run.app
curl -s $API/api/health          # liveness — the process is up
curl -s $API/api/health/ready    # readiness — it can reach Postgres and Redis
curl -s $API/api/store/config    # the storefront's first call
```

`/api/store/config` should show `"is_open": true` inside your trading hours. If
it shows `false`, that is the store-hours feature working — check `opens_at` and
`closes_at` on the console's Settings screen, not the deployment.

Then, in order of how likely each is to be misconfigured:

1. **Upload a product image from the console and reload it.** This is the only
   path that exercises the bucket mount.
2. **Place a real order end to end** — browse, add, checkout, track. Watch the
   browser console for CSP violations; there should be none.
3. **Sign in on the rider app**, accept the order, and mark it delivered.
   Then mark one **paid short** and check the console's Cash screen shows the
   difference against that rider.
4. **Replay the checkout POST** with the same `Idempotency-Key`. The second call
   must answer **200** with the same order id, and the product's stock must have
   moved exactly once. A unit test asserts this; only a real replay proves it.
5. **Sign out of the console, then replay a request with the token you copied
   out of `localStorage` first.** It must answer **401**, not 200 and not 403.
6. **Check the browser console for CSP violations — there should be none.** The
   `Reporting-Endpoints` header is new and is on the CSP path, which is exactly
   the kind of thing that only breaks in a production build.

If the container never turns healthy, read the logs. `check_production_safety()`
raises a `RuntimeError` naming exactly which setting is wrong:

```bash
gcloud run services logs read edawr-api --region asia-south1 --limit 50
```

## Rollback

Every Cloud Run deploy creates a numbered revision. Rolling back is routing
traffic to the previous one — seconds, no rebuild, because the image is
immutable:

```bash
gcloud run revisions list --service edawr-api --region asia-south1
gcloud run services update-traffic edawr-api --region asia-south1 \
  --to-revisions edawr-api-00007-abc=100
```

You can also shift gradually (`--to-revisions NEW=10,OLD=90`) — a canary, so 10%
of users find the bug instead of 100%.

**The catch: rollbacks do not undo migrations.** Old code against a new schema
breaks in fresh ways. For anything risky use expand/contract — add the new
column nullable, deploy code writing both, backfill, deploy code reading the
new one, *then* drop the old. Three deploys, no downtime. Overkill at this
scale, but know it exists before you need it.

---

# Part 3 — Reference

## Local development

Three terminals. The backend runs against **local PostgreSQL**; SQLite is no
longer the default in `.env` and should not be used again, because the row locks
checkout depends on are a no-op there.

```bash
# once
psql -U postgres -c "CREATE ROLE edawr LOGIN PASSWORD 'choose-one';"
psql -U postgres -c "CREATE DATABASE edawr OWNER edawr ENCODING 'UTF8';"
psql -U postgres -c "ALTER ROLE edawr CREATEDB;"   # so the test runner can make test_edawr
```

```bash
cd backend
uv sync
uv run manage.py migrate
uv run manage.py seed              # DEV ONLY — deletes every row first
uv run manage.py runserver 8000    # 0.0.0.0:8000 to reach it from a phone

cd frontend && npm install && npm run dev     # :3000
cd admin    && npm install && npm run dev     # :3001
cd mobile   && npm install && npm start
```

Seeded logins: `admin@edawr.local` / `admin1234`, rider `+919000000002` / PIN
`4813`.

`DATABASE_URL` in `backend/.env` points at the local `edawr` role. The role is
deliberately not `postgres`: an application that owns only its own database
cannot drop anyone else's.

Note that `manage.py test` creates and destroys `test_edawr`, which is why the
role needs `CREATEDB`.

## Every environment variable

Read by `config/settings.py`. Everything has a working development default; the
ones marked **required** are refused at startup outside development by
`check_production_safety()` in `api/apps.py`.

| Variable | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `development` | Any other value turns on HTTPS enforcement, hides `/docs`, activates the startup checks |
| `ALLOWED_HOSTS` | `*` in dev | **Required.** Hostnames only. `*` is refused |
| `DATABASE_URL` | `sqlite:///./edawr.db` | **Required.** Must not be SQLite |
| `DB_CONN_MAX_AGE` | `600` | Seconds a connection is held open. See pooling below |
| `JWT_SECRET` | insecure placeholder | **Required.** Refused even in dev if unchanged |
| `DJANGO_SECRET_KEY` | derived from `JWT_SECRET` | **Required.** Its own random value |
| `CACHE_URL` | unset | **Required.** `rediss://…` |
| `CORS_ORIGINS` | localhost:3000 | **Required.** Both frontend origins. No wildcards |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | 12 hours. How long one token lasts |
| `SESSION_MAX_HOURS` | `168` | A week. How long a session may keep *renewing* — see below |
| `NUM_PROXIES` | `1` outside dev | **Wrong here voids every rate limit.** See below |
| `LOGIN_RATE_LIMIT` | `10/min` | Guards a 4-digit rider PIN |
| `CHECKOUT_RATE_LIMIT` | `12/hour` | Public, and it writes rows and moves stock |
| `TRACKING_RATE_LIMIT` | `120/min` | Polled by an open browser tab |
| `ANON_RATE_LIMIT` | `240/min` | Backstop for everything else public |
| `STAFF_RATE_LIMIT` | `600/min` | Authenticated staff, keyed per account |
| `REPORT_RATE_LIMIT` | `60/min` | Crash and CSP reports. Public, so bounded |
| `SECURE_SSL_REDIRECT` | `true` outside dev | |
| `TRUST_PROXY_SSL_HEADER` | `true` outside dev | Only safe behind a proxy that sets it |
| `SECURE_HSTS_SECONDS` | `31536000` | A year. Browsers cache it that long — start lower if unsure |
| `SERVE_API_DOCS` | on in dev only | `/docs` is a map of the attack surface |
| `SERVE_MEDIA` | on in dev only | **Set `true` in production here** — see the bucket note |
| `UPLOAD_DIR` | `uploads` | Becomes `MEDIA_ROOT` |
| `BACKUP_DIR` | `backups` | **Must not be under `MEDIA_ROOT`** — see Step 3b |
| `BACKUP_KEEP` | `14` | Archives retained before the oldest is pruned |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | `10485760` | The upload view caps images at 5 MB separately |
| `FREE_DELIVERY_ABOVE` | `199.00` | Money as strings — a float reintroduces the rounding error |
| `HANDLING_FEE` | `5.00` | |
| `MIN_ORDER_VALUE` | `49.00` | |
| `DELIVERY_FEE_INSTANT` / `_SLOW` | `15.00` / `5.00` | |
| `DELIVERY_PROMISE_MINUTES_INSTANT` / `_SLOW` | `15` / `45` | Snapshotted per order |
| `DEFAULT_DELIVERY_TYPE` | `instant` | Never falls back to the cheap tier |
| `AUTO_ASSIGN_RIDER` | `true` | Off falls back to the pull feed |
| `MAX_ITEMS_PER_ORDER` | `50` | Abuse guard, not merchandising |
| `MAX_QUANTITY_PER_ITEM` | `20` | |
| `STORE_PAGE_SIZE` / `STORE_MAX_PAGE_SIZE` | `60` / `200` | |
| `STORE_NAME` / `STORE_CITY` | `eDawr` / `Aizawl` | |
| `STORE_TIMEZONE` | `Asia/Kolkata` | What analytics group by. Rows stay UTC |
| `LOG_LEVEL` | `INFO` | JSON lines outside development |
| `SEED_ADMIN_EMAIL` / `_PASSWORD` / `SEED_RIDER_PIN` | published defaults | `manage.py seed` only — never production |

**What is deliberately *not* here:** opening hours, the "pause new orders" kill
switch, the delivery radius and the store's own coordinates. Those live in the
`store_settings` table and are edited on the console's Settings screen or
through `PATCH /api/settings`. They are operational rather than commercial: they
change within a shift, and the person changing them is behind the counter.
Requiring a redeploy to pause checkout during a power cut means the shop keeps
promising 15-minute delivery it cannot make.

For the frontends there is exactly one variable each, `NEXT_PUBLIC_API_URL`, and
it is read at build time as well as runtime.

## `SESSION_MAX_HOURS`, and why a 12-hour token is not a 12-hour session

`/api/auth/me` mints a **fresh** token on every call, and both web clients call
it on startup. That is what keeps a manager signed in across a shift, and it
also means that without a ceiling a session renews itself forever: a token
copied out of the console's `localStorage` is a permanent credential, renewable
by whoever holds it on exactly the same cadence as its owner.

Two claims bound it:

- **`ver`** is the account's `token_version` column, compared on every request
  against the row the authentication class already reads. `POST /api/auth/logout`
  increments it, which retires every token that account holds — so signing out
  is a server-side act rather than a client deleting its own copy. It signs out
  every device, which is the right trade at one console per person and one phone
  per rider; per-token revocation needs a blacklist that outlives the token.
- **`ait`** — *auth issued at* — records when the session began, as distinct
  from `iat`, which is when this particular token was signed. It is copied
  forward unchanged across refreshes, and `/me` refuses to renew past
  `SESSION_MAX_HOURS` from it.

A password or PIN reset bumps the version too. A reset that leaves the old
sessions working is not a reset — the usual reason to change a credential is
that the old one is compromised.

Note the ceiling caps *renewal* only. A token inside its twelve hours keeps
working right up to its own expiry; cutting a rider off mid-delivery because
their session is a week old would be worse than the risk it avoids.

## `NUM_PROXIES`, and why a wrong value silently disables every rate limit

DRF identifies an anonymous caller in `BaseThrottle.get_ident()`. Left at its
default of `None`, that returns the **entire `X-Forwarded-For` header** as the
throttle key. The header is client-supplied, so an attacker sends a different
value on every request and gets a fresh bucket each time: the login, checkout,
tracking and anon limits all become decoration.

Set to an integer, DRF instead takes the entry the trusted proxy itself appended
and ignores anything the client prepended. `1` matches Cloud Run, which
terminates TLS and adds exactly one hop. `0` is correct in development.

Wrong in either direction hurts: too high and you trust hops that do not exist
and read a forged address; too low and you key on the proxy, so every customer
behind one CDN or carrier NAT shares a single bucket.

## Connection pooling — the Neon + serverless trap

**This is the concept most likely to bite you in production.**

Postgres connections are expensive: each is a separate OS process with its own
memory, and an instance handles a few hundred at most. Traditional apps run a
fixed number of servers, so the count is predictable. **Serverless breaks that
assumption.** Cloud Run creates instances on demand, each opening its own
connections, and `DB_CONN_MAX_AGE=600` holds each one open for ten minutes after
use. A traffic spike creates instances, which create connections, which exhaust
the limit — and the failure arrives precisely during the spike you wanted to
survive.

Two defences, and you want both:

1. **Use Neon's pooled endpoint** (`-pooler` in the hostname). It runs PgBouncer,
   multiplexing many client connections onto few real Postgres ones.
2. **Cap `--max-instances`.** With `4` the worst case is bounded. An uncapped
   Cloud Run service is a loaded gun pointed at your database *and* your bill.

Poolers in transaction mode do not support session-level features like
`LISTEN/NOTIFY` or session advisory locks. This app uses neither;
`select_for_update()` is transaction-scoped and works fine.

## Why images are a mounted bucket, not public object storage

The obvious design — upload to Cloud Storage, return a
`https://storage.googleapis.com/...` URL — is **wrong for this codebase**, and it
fails confusingly.

`proxy.ts` in both frontends builds the CSP's `img-src` from
`NEXT_PUBLIC_API_URL`. An image served from any other origin is therefore
**blocked by the browser**, and the store renders with empty tiles plus CSP
violations in the console. Making it work means editing `proxy.ts` in two
packages, `uploads.py`, the serializers and `assetUrl()`.

Mounting the bucket at `/app/uploads` instead means `api/views/uploads.py` keeps
writing to what it believes is local disk, URLs stay same-origin and relative,
and **no application code changes**. The trade is that Django serves the image
bytes rather than a CDN — which is why `SERVE_MEDIA=true` in production is a
deliberate exception to the advice in `config/urls.py`, not an oversight.

Upgrade path if image traffic ever dominates: `django-storages` plus a CDN
origin added to the CSP.

## Liveness vs readiness

`api/views/meta.py` answers two different questions, and answering both with
"ok" causes outages.

- **Liveness** (`/api/health`) — *is this process wedged and needing a restart?*
  It deliberately **checks nothing external**. If it touched the database, a
  brief database blip would fail every replica's liveness probe at once and the
  orchestrator would kill all of them — converting a recoverable dependency
  failure into a total outage.
- **Readiness** (`/api/health/ready`) — *should this replica get traffic right
  now?* This one checks the database, because a process that cannot reach it
  will fail every request. Failing readiness removes the replica from the load
  balancer **without restarting it**, and it rejoins by itself.

Redis being down is reported as `degraded` and does **not** fail the probe.
Pulling every replica out of rotation because the cache restarted would be a
bigger outage than the degraded rate limiting it prevents.

## Cold starts and the shape of serverless cost

With `--min-instances 0` you pay nothing while idle, but a request arriving
after idle waits for a container to boot — a few seconds for Django, plus up to
a second more for Neon to wake from autosuspend.

`--min-instances 1` removes it, but an always-on instance burns roughly **2.6M
vCPU-seconds/month against a 180k free allowance** — leaving the free tier
entirely, for around ₹1,000–2,000/mo.

The general lesson: serverless is cheap when idle and expensive when always-on.
It suits spiky, low-volume workloads and suits steady high-volume ones badly.

Mitigating detail specific to eDawr: the customer tracking page polls, so an
instance stays warm while any order is open. The cold start lands on the first
customer of the morning and essentially nobody else.

## Neon specifics

**Autosuspend.** The free tier suspends after ~5 minutes idle and takes about a
second to wake. Stacked on a Cloud Run cold start, the morning's first request
is noticeably slow. Paid tiers remove it (~₹450/mo). Do not spend until real
customers complain.

**Branching.** You can create a copy-on-write branch of the database in seconds
at near-zero storage cost. That makes a real preview environment per pull
request possible, lets you rehearse a risky migration against a branch of
production, and resets a broken dev database instantly. It is the reason to pick
Neon over a plain Postgres box.

**Free-tier limits to watch:** storage cap, compute-hours, branches per project.
Order history grows slowly at 500 users, and images are in Cloud Storage rather
than the database.

## Observability

Three distinct things, often confused:

- **Logs** — discrete events. `settings.py` emits JSON in production (one object
  per line) because that is what an aggregator can index; humans get readable
  lines in development. Cloud Logging picks up stdout automatically. Note
  `PYTHONUNBUFFERED=1` in the Dockerfile: without it Python block-buffers stdout
  when it is a pipe, and you get an empty log exactly when the process is dying
  and you most want one.
- **Metrics** — request rate, p95 latency, error rate, instance count. Free in
  the Cloud Run console.
- **Traces** — one request across services. Not wired up, and fine to skip here.

**Minimum worth doing at launch:** a billing alert (a runaway loop costs real
money) and an alert on 5xx rate.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- **storefront** — `npm ci`, lint, `tsc --noEmit`, 201 tests, production build,
  and a check that
  **no route prerenders**. That last one is not ceremony: a layout that stops
  being dynamic passes every other check and ships a storefront that paints and
  never hydrates.
- **console** — the same, with 66 tests.
- **rider app** — `npm ci`, `tsc --noEmit`, `expo-doctor`. No test job,
  because there is no test runner; see Part 4. It was in no CI job at all
  until recently, which is worth knowing given it is also the package where
  a mistake is hardest to correct — no OTA channel means a store submission.
- **backend** — disabled in this repo (`backend/` is gitignored here) and live in
  the `edawr-backend` repository, where the identical job runs 446 tests against
  a **Postgres service container**, checks migrations are committed
  (`makemigrations --check`), and runs `check --deploy` with production settings.

Postgres in CI rather than SQLite is the point of that job: `select_for_update()`
is a no-op on SQLite, so the lock that stops the last unit of stock being sold
twice would be unverified.

Deploys stay manual. At this scale that is fine; untested merges are not.

## Test suites

```bash
cd backend  && uv run manage.py test    # 446 tests, ~10s against Postgres
cd frontend && npm test                 # 201 tests, ~5s
cd admin    && npm test                 # 66 tests, ~4s
cd mobile   && npm run typecheck        # no test runner — see Part 4
```

The backend suite is the substantial one: pricing arithmetic, the state machine,
permissions, what each serializer must never leak, opening hours, the delivery
zone, failed deliveries, upload sniffing and image cleanup. It no longer depends
on what time of day it runs — `APITestBase.setUp` opens the store around the
clock, because `StoreSettings` otherwise closes it at 22:00 and every checkout
test would fail after ten at night.

## Things that will cause real damage

1. **Do not run `manage.py seed` against production.** It deletes all rows.
2. **Do not `git add backend` from the repository root.** It records a gitlink
   and ships an empty directory.
3. **Do not compute money in TypeScript.** Ids and quantities go to the server;
   totals come back from it.
4. **Do not assign `order.status` directly.** Use `advance_status()`.
5. **Do not run `pip install`.** Use `uv add`, which updates `pyproject.toml`
   and `uv.lock` together.
6. **Do not put `*` in `ALLOWED_HOSTS` or `CORS_ORIGINS`.** The startup check
   rejects both, correctly.
7. **Do not migrate on container startup.** Use the Cloud Run Job.
8. **Do not change the container's uid** without also changing the volume mount
   options — they must match.
9. **Do not reintroduce FastAPI, Supabase, or a client-side database.** All were
   removed deliberately.

---
# Part 4 — What is still missing

An honest inventory, ranked by what would bite a real store first. Everything
here is known and deliberately deferred.

Six items that were in this list are not any more. They are recorded at the end
under *Recently closed*, with what to check if one of them misbehaves — a gap
list that only grows teaches people to stop reading it.

## Before taking real money

**No out-of-band notification.** The customer's only channel is keeping a
browser tab open on `/order/{token}`. Close the tab and they have no idea when
the rider is coming. For COD in a market where SMS and WhatsApp are the norm,
this alone will generate a support call per order. It needs a provider account
and a per-message cost, which is why it is not done rather than because it is
hard: the send would be one call from `OrderStatusView`.

**No receipt, no invoice, no tax fields.** No PDF, no email, no printable view.
`Product` has no HSN code and no tax field; `Order` has no GSTIN and no invoice
number. If turnover crosses the GST registration threshold, a compliant tax
invoice cannot be issued from this system. Note the schema is now closer than it
was — `paid_at` and `amount_collected` are exactly the columns an invoice has to
cite — but the tax decisions are the store's, not the code's.

**Customer order history is a localStorage key.** `edawr-recent-orders-v1`,
capped at ten, and the tracking token is the only proof of ownership. Clearing
site data, switching phones or using private browsing permanently loses access
to every past order. The storefront now *says* so when the write fails, which is
a caveat rather than a fix; a real fix means customer accounts, and the only
sane identity for this market is a phone number, which means OTP, which means
the SMS provider above. These two gaps are one gap.

## Operational

**No third-party error tracking or alerting.** Crashes and CSP violations from
all three clients now reach `POST /api/client-errors` and `/api/csp-report` and
land in Cloud Logging as structured JSON — so failures are *visible*, which they
were not. Nothing yet *pages* anybody: there is no alert on 5xx rate, no billing
alert, and nothing polls `/api/health/ready`. Those are console configuration
rather than code, and they are the cheapest remaining safety improvement.

**Nothing rolls up the fifteen-minute promise.** `delivered_in_minutes` and
`was_late` are stamped per order and appear on the analytics screen; no trend,
no alert when the promise starts slipping.

**No per-account lockout.** Throttle trips are now logged, so a brute-force
attempt against a rider PIN is at least visible. Riders behind one carrier NAT
still share the login budget, and nothing locks an individual account after
repeated failures.

**Split repository.** `backend/` is gitignored from the root repo, so a change
spanning backend and frontend cannot be one commit, one PR, one CI run or one
rollback. This round was exactly such a change and it took two of each.
`git subtree` is the fix when this becomes painful enough.

**Rider dispatch is pull as well as push.** With `AUTO_ASSIGN_RIDER` on, a Ready
order is handed to the nearest eligible rider. With it off, every available
rider in range sees every packed order and first to accept wins. An order
declined by everyone stops appearing, which is why `GET /api/orders?stalled=true`
exists for the manager. A timed-offer design would need a scheduler.

**Straight-line distance.** The delivery radius and rider ranking use haversine,
and Aizawl is built on ridges — road distance can be several times it. A
genuinely 6 km address may be a twenty-minute ride.

## Testing

**No end-to-end test** of browse → add → quote → checkout → track. The three
suites are unit and integration tests; nothing drives a real browser.

**No component tests in `frontend/`.** `@testing-library/react` is not installed
there. Its tests are pure logic plus two files that render through
`react-dom/server` and `react-dom/client` by hand — which covers a hook and a
presentational component and does not scale to `CheckoutPage`. `admin/` does
install it and does render components.

**The mobile app has no tests and no test runner.** `jest-expo` is the standard
choice for SDK 54; adding the first test means configuring it from scratch. CI
now runs `tsc --noEmit` and `expo-doctor` on it, which is two more checks than
it had and still not a test.

## Smaller things

- `?stalled=true` computes reachability per order in Python — O(n) queries on a
  paged endpoint.
- Uploads are size- and type-checked but never scanned.
- `Order` has six lifecycle timestamps and records which rider collected the
  cash, but not which actor made each *transition*. `AuditLog` covers the status
  endpoint for both admins and riders; `OrderAcceptView` and `OrderRejectView`
  still write no audit row.
- The rider app's session profile is captured at login and refreshed only on
  restart, so a changed service radius shows stale in the hero card.
- The rider app has no `expo-updates` channel, so any fix to it requires a store
  submission. That is the reason its CI checks matter more than they look.
- `style-src 'unsafe-inline'` in both CSPs, for Tailwind v4 and `next/font`.
  Documented in `proxy.ts`; the weakest link in the policy and still not a hole.

## Recently closed

Kept here because knowing where a thing was *just* added is what you want when
it misbehaves.

| Was missing | Now | Check first |
|---|---|---|
| Automated backups | `manage.py backup_database`, a Cloud Run Job and a Scheduler trigger (Steps 3b, 6b) | `pg_dump` version vs Neon's; `BACKUP_DIR` not under `MEDIA_ROOT` |
| Cash recorded as intent only | `paid_at`, `amount_collected`, `collected_by`, stamped in `advance_status`; `/api/analytics/cash`; the console's Cash screen; "Paid less" in the rider app | Buckets by `paid_at`, not `created_at` — see `collected_orders` |
| Checkout not idempotent | `Idempotency-Key` header, unique `Order.idempotency_key`, replay answers 200 | The dedupe read is outside the transaction on purpose |
| No logout or token revocation | `ver` and `ait` claims, `/api/auth/logout` and the rider's, `SESSION_MAX_HOURS` | A retired token is **401**, never 403 |
| No error tracking | `/api/client-errors` and `/api/csp-report`; boundaries in all three clients | Reports are allowlisted; unknown keys are dropped |
| Concurrency untested | `api/tests/test_idempotency.py`, two threads on `APITransactionTestBase` | It needs real commits; the ordinary test base tests nothing here |
