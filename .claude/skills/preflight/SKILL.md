---
name: preflight
description: Run every check eDawr must pass before a commit or a deploy — Django tests and `check --deploy` for backend/, lint + test + build for frontend/ and admin/, expo-doctor for mobile/. Use before committing, before pushing, when asked "is this ready to ship", or after a change that spans more than one package.
argument-hint: "[all | backend | frontend | admin | mobile]"
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit
---

## Scope

`$ARGUMENTS` names the packages to check. Empty or `all` means: run the gate for
every package that has uncommitted changes, and skip the ones that don't. Both
git repos matter — `git status` at the root does **not** show backend changes.

```bash
git -C . status --short
git -C backend status --short
```

## The gate

Run each package's block from that package's directory. Never `pip install` —
dependencies are uv-managed.

| Package | Commands, in order |
|---|---|
| `backend/` | `uv sync` · `uv run manage.py makemigrations --check --dry-run` · `uv run manage.py test` · `uv run manage.py check --deploy` |
| `frontend/` | `npm run lint` · `npm test` · `npm run build` |
| `admin/` | `npm run lint` · `npm test` · `npm run build` |
| `mobile/` | `npx expo-doctor` (there are no tests) |

`makemigrations --check --dry-run` exits non-zero when `api/models.py` changed
without a migration. That is the failure this gate exists to catch — a model
edit that passes tests locally and breaks the next deploy.

`check --deploy` warns loudly under `ENVIRONMENT=development`. Read the warnings
against `backend/.env.example`: the ones about `SECRET_KEY`, `DEBUG` and HTTPS
are expected locally and are enforced at startup in production by
`check_production_safety()` in `api/apps.py`. Anything else is real.

## Rules

- **Fix failures, don't report them and stop.** A failing test is the job.
- Report every command's real outcome. If you skipped a package, say which and
  why. Never call the gate green when a step was skipped.
- If `npm run build` fails on the CSP or on a missing `NEXT_PUBLIC_API_URL`,
  check `.env` against `.env.example` before touching `src/proxy.ts`.
- Do not run `git push`, and do not commit as part of this skill. Use
  `/edawr-commit` for that.

## Report

End with one table: package · step that failed (or "clean") · what you did.
