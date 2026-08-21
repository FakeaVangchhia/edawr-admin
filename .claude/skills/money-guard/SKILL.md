---
name: money-guard
description: Audit eDawr for its money invariant — every price, fee and total is a server-side Decimal quantised ROUND_HALF_UP in api/pricing.py, and no client ever computes or supplies one. Use when touching cart, checkout, quote, delivery fees, discounts or totals, when reviewing a diff containing prices, or when a displayed total disagrees with the charged total.
allowed-tools: Bash, Read, Grep, Glob
---

## What changed

```!
git -C "${CLAUDE_PROJECT_DIR}" diff --stat HEAD
git -C "${CLAUDE_PROJECT_DIR}/backend" diff --stat HEAD
```

## The invariant

The server computes every number a customer is charged, in `api/pricing.py`, as
`Decimal`, quantised to 2dp with ROUND_HALF_UP via `money()`. The checkout
request carries **product ids and quantities only** — no price, no fee, no
total — and the server reads none from it. `/api/store/quote` exists so the cart
drawer can *display* the same arithmetic the server will charge.

A float cannot represent `0.1`, so a basket totalled in floats drifts. That is a
rounding error handed to a customer on a bill. And a checkout that trusts a
client-supplied total is a checkout where the customer picks the price.

## Violations to hunt

Run these and read every hit, including in `frontend/`, `admin/` and `mobile/`:

```bash
rg -n "reduce\(|\.price \*|price\s*\*\s*(qty|quantity)|subtotal|grandTotal|total\s*\+=" frontend/src admin/src mobile/src
rg -n "float|Decimal\(|round\(" backend/api --glob '!tests/*'
rg -n "price|total|fee|amount" backend/api/serializers.py | rg -i "write|required=True|input"
```

Flag, in order of severity:

1. **A price, fee or total read from a request body** in a serializer or view.
   This is the price-picking hole. There is no acceptable version of it.
2. **Line totals summed in TypeScript.** That is a second pricing engine, and it
   will disagree with the server the first time a fee changes. The cart holds a
   *display* snapshot; the bill comes from `/api/store/quote` and the order.
3. **`float` used for money server-side**, or `Decimal(some_float)` instead of
   `Decimal(str(...))` — `Decimal(0.1)` is `0.1000000000000000055…`.
4. **Money arithmetic outside `api/pricing.py`** — a fee computed in a view or a
   serializer is a rule that lives in two places.
5. **A value leaving `pricing.py` without `money()`** — `Decimal` is exact but
   not automatically 2dp; a percentage produces `186.2999…`.
6. **`COERCE_DECIMAL_TO_STRING` flipped on.** It is `False` deliberately: money
   arrives as a JSON number because clients *display* it, never recompute it.

## Report

For each finding: file:line, which of the six it is, and the concrete failure —
the input, and the wrong rupee figure it produces. If nothing is wrong, say the
invariant holds and name the files you checked. Do not pad the list.
