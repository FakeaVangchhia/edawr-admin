---
name: migrate-safe
description: Write and review a Django migration for eDawr that survives existing production data — makemigrations, hand-editing for backfills, per-row unique values, and the seed/demo_clear caveats. Use after editing backend/api/models.py, when a migration must run on a live database, or when reviewing a migration file.
paths: backend/api/models.py, backend/api/migrations/**
allowed-tools: Bash, Read, Edit, Grep, Glob
---

## Existing migrations

```!
ls "${CLAUDE_PROJECT_DIR}/backend/api/migrations"
```

## Procedure

```bash
cd backend
uv run manage.py makemigrations          # generates the file
# read it, edit it by hand, then:
uv run manage.py migrate
uv run manage.py test
```

**Migrations are source code.** Commit them (from inside `backend/`), and never
edit one that has already run anywhere but your own machine — add a new one.

## What generated migrations get wrong

`makemigrations` writes a schema change. It does not know your data. Read the
generated file against this list before running it:

- **A new non-nullable column** with no default fails on a non-empty table. Add
  the column nullable, backfill in a `RunPython`, then `AlterField` to
  non-nullable — three operations in one file.
- **A new unique column.** A single `AddField` with a callable default gives
  *every existing row the same value*, and the unique constraint then fails.
  Populate row by row in `RunPython` first, then add the constraint.
  `0003_quick_commerce` does exactly this for tracking tokens.
- **A unique constraint on existing data** needs the duplicates resolved first.
  `0003` dedupes category names before the constraint lands.
- **A renamed vocabulary** (e.g. status values) is a data migration, not a schema
  one. `0003` renames the old status vocabulary and backfills totals.
- **`RunPython` needs a reverse**, or `migrations.RunPython.noop` with a comment
  saying why the migration cannot be undone.
- **Use the historical model** inside `RunPython`: `apps.get_model("api", "Order")`,
  never the imported class. The imported one is today's shape, not the shape at
  this point in history.
- **Batch the backfill** if the table can be large — `.iterator()` plus
  `bulk_update`, not a per-row `.save()` over every order.

## Caveats specific to this repo

- `manage.py seed` deletes and reinserts **rows** only. It never touches the
  schema, but it wipes hand-added admins — so it cannot be re-run on a live
  database. Use `seed_admin` to add a console account, and `demo_clear --dry-run`
  (then without the flag) to clear demo data.
- The lock in `checkout.py` (`select_for_update()`) is a **no-op on SQLite**. A
  migration that looks safe against the dev `edawr.db` is not evidence about
  Postgres. `DATABASE_URL` must point at Postgres before real traffic.
- If the model change touches order status, read `/order-state` first — the
  status column carries `choices`, and both UIs need the matching change.

## Review checklist

Before you call it done: does it run on an empty database, on the seeded
database, and on a database with 10k orders where one row already violates the
new constraint? Say which of the three you actually tested.
