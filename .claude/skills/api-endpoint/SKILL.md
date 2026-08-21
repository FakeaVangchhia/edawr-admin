---
name: api-endpoint
description: Add or change a backend API endpoint the eDawr way — model, migration, serializer, view, urls.py entry, permission class, audit record and tests, in that order, with the repo's error-shape and trailing-slash rules. Use when adding a route under backend/, changing a DRF serializer or permission, or wiring a new store/admin/rider endpoint.
argument-hint: "[what the endpoint should do]"
paths: backend/**
---

Build `$ARGUMENTS`. Work in `backend/`, which is its own git repository.

## Order of work

1. **Model** (`api/models.py`) — only if new state is needed. Then
   `uv run manage.py makemigrations`, and review the file by hand: see
   `/migrate-safe`.
2. **Serializer** (`api/serializers.py`) — pick the right *pair*. Admin-facing
   and public-facing serializers are separate classes on purpose:
   `ProductSerializer` carries cost price, supplier and shelf location;
   `StoreProductSerializer` carries none of them and reduces `stock` to
   `in_stock` + `low_stock`. Same split for `OrderSerializer` vs
   `OrderTrackingSerializer`. **Never widen a public serializer** — add a field
   to the admin one and leave the public one alone.
3. **View** (`api/views/<area>.py`) — one module per area: `store`, `products`,
   `categories`, `orders`, `delivery`, `users`, `admins`, `analytics`, `audit`,
   `uploads`, `auth`, `meta`.
4. **Permission** (`api/permissions.py`) — `IsAdmin` = any active AdminUser
   (admin *or* manager). `IsOwnerAdmin` = Admin role only, and only `/api/admins`
   and `/api/audit` use it. **Do not change `IsAdmin`** — `test_auth.py` asserts
   the 401-vs-403 contract through it.
5. **URL** (`api/urls.py`) — one line, **no trailing slash** (`APPEND_SLASH` is
   off; a redirected POST loses its body). Put it under the right `# ---` banner
   and mark it `(public)` only if it truly is. That file is the routing table and
   the public-surface audit; keep both accurate.
6. **Audit** (`api/audit.py`) — every *mutating admin* view calls
   `record(request, action, entity, entity_id=..., summary=..., changes=...)`.
   It never raises and it strips credential-shaped keys.
7. **Tests** (`api/tests/test_<area>.py`) — extend the existing module, reuse
   `tests/base.py`. Cover the happy path, the permission denial, and the 400.

## Non-negotiables

- **Errors are always `{"detail": "..."}`** (`api/exceptions.py`). Raise
  `NotFound` / `ValidationError`, or return
  `Response({"detail": ...}, status=...)`. Never a bare error dict.
- **A bad body is 400, not 422.** A conflict with existing state is 409.
- **A valid token of the wrong kind is 403, not 401.** 401 makes the web app
  clear its session; returning it for a rights problem signs an admin out of
  pages they merely lack access to.
- **The actor comes from the token, never the body.** No endpoint takes a rider
  id or an admin id as a parameter to act as.
- **Money never arrives from the client.** A request body carries product ids
  and quantities. If your endpoint touches totals, see `/money-guard`.
- **DRF `CharField` rejects `""`** — optional text fields use the shared
  `OPTIONAL_TEXT` kwargs.
- **`default=` is what makes PUT replace.** `required=False` alone leaves an
  omitted field unchanged.
- List endpoints that nest need `.prefetch_related("items")` and
  `.select_related("delivery_boy")`, or 50 orders is 101 queries.
- Public endpoints must be throttled (`api/throttling.py`) and keyed on
  something unguessable, not a sequential id.

## Finish

`uv run manage.py test` from `backend/`, then hand off to `/edawr-commit`.
