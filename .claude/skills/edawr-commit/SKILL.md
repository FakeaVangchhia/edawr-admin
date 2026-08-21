---
name: edawr-commit
description: Commit eDawr changes across its two git repositories — the root repo and the separate backend/ repo — without recording a gitlink. Use whenever staging, committing or writing a commit message for this project, or when `git status` at the root does not show a backend change you know you made.
allowed-tools: Bash, Read
---

## State of both repos

```!
echo "── root ──"; git -C "${CLAUDE_PROJECT_DIR}" status --short --branch
echo "── backend ──"; git -C "${CLAUDE_PROJECT_DIR}/backend" status --short --branch
```

## The gotcha

`backend/` is a **separate git repository** with its own remote
(`edawr-backend`), and it is listed in the root `.gitignore`.

- Commit backend changes **from inside `backend/`**.
- **Never `git add backend` from the root.** That records a gitlink, which
  clones as an empty directory — the API silently disappears for the next person
  who clones.
- A change spanning both is **two commits**, one per repo. Give them the same
  subject line so they can be paired later.

## Procedure

1. Read both statuses above. Decide which repo each changed file belongs to.
2. If the root status shows `backend` as a staged entry, unstage it:
   `git -C . restore --staged backend`.
3. Stage deliberately — name the files, don't `git add -A`.
4. Commit each repo from its own directory:
   ```bash
   git -C . commit -m "..."
   git -C backend commit -m "..."
   ```
5. **Do not run `git push`.** Stage and commit; the human pushes.

## Message

Subject: imperative, under 72 chars, says what changed and why it matters —
match the existing log (`Fix eleven findings from the code review, one of them
production-breaking`, not `fix stuff`). Body only when the *why* isn't obvious.
End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Before committing

If the change touches more than one package, run `/preflight` first. Never
commit a model change without its migration — `makemigrations --check` catches
it, and `/preflight` runs that.
