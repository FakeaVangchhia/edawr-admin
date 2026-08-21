---
name: order-state
description: Reference and change-checklist for eDawr's order status state machine — Order.TRANSITIONS, advance_status(), the 409-on-illegal-move contract, cancellation and restock, and the matching buttons in the admin console and the rider app. Use when adding or changing a status, debugging a 409 from /api/orders/<id>/status, or when an order is stuck.
---

## The machine

Declared in `Order.TRANSITIONS` (`backend/api/models.py`) and enforced by
`Order.advance_status()`, which also stamps the matching timestamp exactly once.

```
Placed ──→ Packing ──→ Ready ──→ Dispatched ──→ Delivered
   │          │          │            │
   │          │          │            └──→ Ready        (rider hands it back)
   │          │          └──→ Packing
   └──────────┴──────────┴──→ Cancelled
```

`Delivered` and `Cancelled` are terminal. `CANCELLABLE = (Placed, Packing, Ready)`.

## Rules

- **Never assign `order.status` directly.** Always `advance_status()`. It is the
  only thing that stamps `packed_at` / `dispatched_at` / `delivered_at` /
  `cancelled_at` once, and freezes the fulfilment outcome at delivery.
- An illegal move raises `ValueError`, which the view turns into **409** — a
  conflict with the order's state, not a bad request.
- **Cancelling goes through `checkout.cancel_order()`**, never `advance_status`
  alone, because it must restore stock under a lock.
- The rider comes from the token. `accept` / `reject` / `status` take no rider id
  and each checks ownership.

## Changing the machine

A status change is a **four-file** change. Missing any one of them produces an
order that some actor can reach and no actor can leave.

1. `backend/api/models.py` — the constant, `STATUS_CHOICES`, the `TRANSITIONS`
   row (both directions), `CANCELLABLE`/`TERMINAL`, and the timestamp field.
2. A migration — the status column is a `CharField` with `choices`, so a new
   value needs a migration, and a *renamed* one needs a data migration.
   `0003_quick_commerce` is the worked example. See `/migrate-safe`.
3. `backend/api/tests/test_orders.py` — assert the new legal move **and** assert
   409 on the moves that stay illegal.
4. The UIs, both of them:
   - `admin/src/app/(console)/orders/` and `admin/src/components/orders/OrderDrawer.tsx`
   - `frontend/src/components/ManagerDashboard.tsx` (the older console)
   - `mobile/src/screens/DeliveryScreen.tsx` — the rider's only buttons

## Known hole (BACKLOG #3)

`Dispatched` cannot reach `Cancelled`, and the rider app sends only `Delivered`.
When a customer refuses at the door or nobody is home, **every actor's only
button is "Mark delivered"** — the goods are recorded as sold and stock is never
returned. The fix is a `Failed`/`Returned` terminal state that restocks only when
the rider brings the bag back, plus UI in both apps. If the task touches
`Dispatched`, say whether it closes this hole or leaves it open.

## Debugging a stuck order

```bash
cd backend && uv run manage.py shell -c "
from api.models import Order
o = Order.objects.get(id=ID)
print(o.status, Order.TRANSITIONS[o.status], o.delivery_boy_id)"
```

A 409 means the move is not in `TRANSITIONS` for the current status. A 403 means
the rider does not own the order. A 401 means the token is unreadable — not a
rights problem.
