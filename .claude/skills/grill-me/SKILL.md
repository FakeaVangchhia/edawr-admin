---
name: grill-me
description: Pressure-test a plan before building it. Asks one numbered round of questions at a time, each with a recommended answer, until every branch is resolved — then writes the settled spec. Weighted toward the decisions that actually bite an eDawr feature - money, order state, roles, public surface, and a rider on a bad connection. Use when there is a feature idea, plan or spec to stress-test before implementation.
argument-hint: "[the plan or feature to grill]"
disable-model-invocation: true
---

Grill the plan in `$ARGUMENTS`. If it is empty, or too vague to interrogate
("I want to build X" with no shape), ask for the plan first — one question, then
stop. Do not guess a plan and grill your own invention.

## How to grill

1. Read the plan against the codebase. Ground every question in a real file,
   endpoint or model — never ask something the repo already answers.
2. Ask **one round at a time**: every question whose prerequisites are already
   settled, numbered, each with **your recommended answer and one line of why**.
   A recommendation moves the session forward; a bare question just blocks it.
3. Stop and wait. Do not answer for the user and do not start building.
4. Their answers unlock the next round. Repeat until nothing is unresolved.
5. Then write the settled spec: decisions made, decisions deferred, files that
   will change in each of the four packages, and what could still go wrong.

Ask about consequences, not preferences. "What colour should the button be" is
noise. "When the rider taps Delivered with no signal, does the order commit
locally and sync later, or does the tap fail" is the plan.

## The question bank

Work through these. Anything the plan touches, grill; anything it doesn't, skip.

**Money.** Does this change any price, fee, discount or total? Then: does the
number come only from `api/pricing.py`? Does any client compute or send one? Is
every value quantised through `money()`? What does `/api/store/quote` return, and
does the cart drawer show exactly that? A total the customer sees and a total the
customer is charged that disagree is the worst bug this project can have.

**Order state.** Does it add or move a status? Which `TRANSITIONS` rows change,
in both directions? What stamps the timestamp? Can every state it creates be
*left* by some actor — the manager, the rider, and the customer? If a step fails
in the real world (refused at the door, nobody home, bike stolen), whose button
handles it, and is stock returned?

**Roles.** Manager or Admin? `IsAdmin` or `IsOwnerAdmin`? Remember role is read
from the row on every request, never from the token — so a demotion takes effect
immediately. Does anything here need to survive that?

**Public surface.** Does it add an unauthenticated endpoint? What identifies the
resource — a sequential id is enumerable; tracking uses a 190-bit token. What is
the throttle? What does an attacker get by calling it a million times?

**Stock and concurrency.** Does it read or write `stock`? Is it inside the
checkout transaction, and are rows locked in primary-key order? Note the lock is
a **no-op on SQLite**, so local testing proves nothing about the race.

**The rider's phone.** Aizawl connectivity is not a lab. What happens on a failed
request — retry, queue, or lose it? Is the action idempotent if it fires twice?

**Data already in the database.** Does this need a migration that runs on rows
that already exist? Which existing rows violate the new rule today?

**Scope.** What is explicitly *not* in this change? Which of the eight items in
`BACKLOG.md` does it touch, close, or make worse?

## Rules

- One round per turn. Never a wall of forty questions.
- Never ask what the code already answers — read it instead.
- Recommend, don't just interrogate.
- Say plainly when a plan is fine as-is. Manufacturing doubt wastes the session.
