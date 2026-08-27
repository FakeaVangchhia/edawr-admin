# eDawr Console

The staff console: order fulfilment, catalogue, riders, analytics and account
management for Admins and Managers.

## Where this sits

eDawr is four applications; two of them are versioned. This one is the console,
and it is deployed on its own:

| | Versioned in | What it is |
|---|---|---|
| **Console** | `edawr-admin` (here) | Next.js 16, port 3001. Staff only. |
| API | `edawr-backend` | Django 6 + DRF + PostgreSQL. **The only server.** |
| Storefront + rider app | *nothing* | The customer web store and the Expo rider app. They live beside this repository on the developer's disk, at `../frontend` and `../mobile`, and are not under version control. |

The containing directory (`eDawr/`) is **not** a git repository. This one and
`edawr-backend` are checked out inside it as subdirectories.

A **separate application** from the storefront. The storefront sells; this is
the instrument the shop is run with, and the two share no code, no design system
and no deployment. They share only the API.

Clone the API beside this one if you want to run the whole stack locally — the
console serves no API routes of its own and does nothing without it. The shared
deployment guide, `PRODUCTION.md`, sits at the root of that working directory
and is not in any repository.

```bash
npm install
cp .env.example .env      # point NEXT_PUBLIC_API_URL at the Django API
npm run dev               # http://localhost:3001
```

The API must allow this origin. In the `edawr-backend` checkout's `.env`:

```
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001
```

Create the first account from that same checkout — the console has no sign-up,
by design:

```bash
uv run manage.py seed_admin --email you@example.com --password '...' --role admin
```

## The two roles

| | Manager | Admin |
|---|---|---|
| Orders, products, categories, riders, settings | yes | yes |
| Cost prices, margins, all analytics | yes | yes |
| Create accounts and change roles | — | yes |
| Read the activity log | — | yes |

`src/lib/guard.ts` holds the capability map and is the only place the UI asks.
It decides what to *draw*; the server decides what is *allowed*, re-reading the
role from the database on every request. A Manager who types `/accounts` into
the address bar gets an explanation from the route guard and a 403 from the API.

## Things worth knowing before changing anything

- **401 and 403 are not the same.** Only a 401 clears the session. A 403 means
  "you, specifically, may not do this" and must never sign anyone out. See the
  interceptor in `src/lib/api.ts`.
- **`await connection()` in the root layout is load-bearing.** `src/proxy.ts`
  issues a per-request CSP nonce; a statically prerendered page would ship a
  build-time nonce, the browser would reject every script, and the app would
  never hydrate.
- **`NEXT_PUBLIC_API_URL` is in the CSP.** Get it wrong and every screen renders
  while no data ever arrives. It is the first thing to check.
- **Editing a product sends `PATCH`, not `PUT`.** PUT writes every column from a
  body assembled when the form opened, so a sale during the edit is overwritten.
- **The category `PUT` is not partial.** Use `categoryPutBody()`; omitting a
  field resets it.
- **Money is never computed here.** Totals come from the server. `src/lib/format.ts`
  formats and does not add.

## Tests

```bash
npm test      # vitest — pure logic plus rendered components
npm run lint
```

`@testing-library/react` is installed, so components can be rendered in tests —
which is not true in the storefront.
