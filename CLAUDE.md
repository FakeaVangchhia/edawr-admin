# [CLAUDE.md](http://CLAUDE.md)

Guidance for Claude Code (claude.ai/code) when working in this repository. Do not push or commit anything on git, leave that part to me. Also, whenever you work on another worktree created by me or you, never touch another worktree, you must remain on your current worktree.

## Overview

This repository is the **eDawr staff console** — the instrument the shop is run
with. eDawr itself is a quick-commerce grocery platform for Aizawl, Mizoram:
customers order from a web storefront and a rider delivers on a 15-minute
promise.

The console is Next.js 16 (App Router, React 19, Tailwind v4) on **port 3001**,
with its own design system and its own deployment. **UI only — it serves no API
routes.**

It was split out of the eDawr monorepo, which no longer exists as a repository.
What surrounds it now:

- `edawr-backend` — Django 6 + DRF + PostgreSQL. **This is the API**, and the
only place business rules live. Checked out beside this one, at `../backend`.
- `../frontend` **and** `../mobile` — the customer storefront and the Expo rider
app. They are **not under version control**: no repository, no history, no
rollback. Their last committed state is archived in a bundle file on the
developer's disk.
- `../PRODUCTION.md` — still the single deployment guide for all four
applications. It is a plain file in an unversioned directory, so it is worth
reading with the possibility in mind that it has drifted.

The containing directory is not a git repository and must not become one. Run
git only from inside this repository or `../backend`.

The console and the storefront share no code, no design system and no
deployment. They share only the API. If you find yourself copying a component
between them, that is a decision to make deliberately, not a refactor — and the
copy in `../frontend` has no history to trace it back to.

## Commands

```bash
npm install
npm run dev        # http://localhost:3001
npm run build
npm run lint
npm test           # vitest
npx tsc --noEmit
```

`@testing-library/react` is installed here, so components can be rendered in
tests — which is not true in the storefront. Use it. End-to-end coverage is
still missing; if you touch something substantially, consider whether you can
leave a test behind.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and a production
build on every push, and fails if any route starts prerendering — see the CSP
note below. It is the only CI in the project apart from the API's: the
storefront and the rider app have none, because they have no repository.

## The rules that matter

These are API contracts. Breaking one here does not fail a test in this
repository — it produces a wrong number on a bill, or a console that signs
people out.

### Money is Decimal, and it is never computed on the client

Every price, fee and total is a server-side `DecimalField`, quantised
ROUND_HALF_UP in the API's `api/pricing.py`. **Do not add up line totals in
TypeScript** — that is a second pricing engine, and it will disagree with the
server the first time a fee changes. `src/lib/format.ts` formats and does not
add.

DRF is configured with `COERCE_DECIMAL_TO_STRING = False`, so money arrives as a
JSON number because the client displays it rather than recomputes it.

### Order status is a state machine, enforced by the server

Legal moves are declared in the API's `Order.TRANSITIONS`. An illegal move is a
**409** — a conflict with the order's state, not a bad request — so a button
that offers an impossible transition produces a 409, not a validation message.

```
Placed → Packing → Ready → Dispatched → Delivered
   └────────┴────────┴──────────────────→ Cancelled
                       Dispatched → Ready    (rider hands it back)
                       Dispatched → Failed   (attempted, did not happen)
```

`Failed` is terminal and restores **nothing** — when the rider reports it the
bag is on a bike. Restocking is a separate, audited step behind
`POST /api/orders/{id}/restock`, it requires a reason, and that sentence is what
the store reads when the customer rings. Cancelling restores stock; failing does
not.

### 401 and 403 are not the same, and the difference is the session

Only a **401** clears the stored session — it means "I don't know who you are".
A **403** means "you, specifically, may not do this" and must never sign anyone
out; clearing on 403 would sign an Admin out of a page they merely lack rights
for. The interceptor in `src/lib/api.ts` is the only place this is decided.

A retired token (after a logout, or a password reset elsewhere) is also a 401,
which is what makes the app clear its session on the next request.

### Two roles, and the server is the one that decides

`AdminUser.role` is `admin` or `manager`. A **Manager** runs the store: products,
categories, orders, riders, prices, settings, every figure in analytics. An
**Admin** adds exactly two things — account management and the audit log.

`src/lib/guard.ts` holds the capability map and is the only place the UI asks.
It decides what to *draw*. The server decides what is *allowed*, re-reading the
role from the database on every request — so a demotion takes effect on the next
request rather than when a token expires. Never treat the guard as security.

### Requests that write

- **Editing a product sends** `PATCH`**, not** `PUT`**.** PUT writes every column from a
body assembled when the form opened, so a sale during the edit is overwritten.
- **The category** `PUT` **is not partial.** Use `categoryPutBody()`; omitting a
field resets it.
- Error responses are always `{"detail": "..."}`. A bad body is **400**, not 422.
- URLs carry **no trailing slash** — the API sets `APPEND_SLASH = False`, because
a redirected POST loses its body.
- Uploads return a **relative** `/uploads/<name>` path; prefix it via
`assetUrl()`.



## Next.js 16 specifics

This is not the Next.js you know. Consult `node_modules/next/dist/docs/` before
writing framework code.

- **Middleware is called Proxy.** `src/proxy.ts` is the current convention, not
dead code. It carries the CSP with a per-request nonce.
- `await connection()` **in the root layout is load-bearing.** The CSP uses
`script-src 'strict-dynamic'`, which makes a CSP3 browser ignore `'self'` and
trust only nonced scripts — and a prerendered page's script tags were written
at build time with no nonce, so the browser blocks every one and the page never
hydrates. **It only breaks in** `next build`; `next dev` renders per request,
so it is invisible locally and appears first on the deployed site. CI fails the
build if any route prerenders.
- **The CSP names the API origin.** `src/proxy.ts` derives `connect-src` and
`img-src` from `NEXT_PUBLIC_API_URL`. Get that wrong and the browser blocks
every request and every product image, and the console renders empty. It is the
first thing to check when nothing loads.
- `params` in a dynamic route is a **Promise** and must be awaited.
- Turbopack is the default for `dev` and `build`.
- **Never set state synchronously inside an effect.**
`react-hooks/set-state-in-effect` is an error here, and the fix is structural
rather than a suppression: tag fetched data with the query that produced it and
**derive** the loading flag, and refresh by bumping a token from an event
handler. See `ManagerDashboard.tsx`.



## Conventions

- Path alias `@/*` → `src/*`.
- Product images use plain `<img>`, not `next/image`: the host is only known at
runtime, so `remotePatterns` cannot be configured at build time without baking
it in. The lint rule is disabled per-file with that reasoning.
- Failures are reported same-origin: the console POSTs to `/api/client-errors`
and the CSP names `/api/csp-report`. Both endpoints allowlist every field they
log — an endpoint that logged whatever arrived would be a PII sink. Every
reporter is written so it cannot throw and cannot block; it runs at the moment
the app is already failing.
- **Successes are toasts; failures stay inline.** Every write confirms itself
through `useToast()` (`src/components/ui/toast.tsx`), mounted once in
`(console)/layout.tsx`. Errors keep using `ErrorBanner` where they are: a
confirmation is glanced at and let go, an error has to be read and acted on,
and a 409 that vanishes after four seconds is a 409 nobody saw. Word the
confirmation as the *consequence* — "Order #12 delivered, ₹340 recorded as
collected", not "Saved" — because the side effects of these writes (stock
moving, cash being recorded) are invisible on the screen that made them.
- **Do not run** `git push`**.** Stage and commit; leave pushing to the user.

