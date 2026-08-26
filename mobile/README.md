# edawr-mobile

The delivery-rider app. Expo / React Native (SDK 54), two screens.

## Running it

```bash
npm install
npm start                   # dev server + QR code
npm run android             # or: npm run ios
```

The backend must be running and reachable **from the phone**:

```bash
cd ../backend
uv run manage.py runserver 0.0.0.0:8000     # 0.0.0.0, not just 8000
```

`runserver 8000` alone binds to `127.0.0.1`, which a phone on the same Wi-Fi
cannot reach. Use `0.0.0.0:8000`.

## Signing in

Riders sign in with **phone number + PIN**. After `uv run manage.py seed` the
two sample riders are:

| Phone | PIN |
| --- | --- |
| `+919000000002` | `4813` |
| `+919000000003` | `4813` |

The number can be typed with or without the country code — it is normalised to
`+91XXXXXXXXXX` on both sides before lookup.

Override the seeded PIN with `SEED_RIDER_PIN`. To create a rider through the
API, `POST /api/users` as an admin with a `pin` field (write-only, minimum 4
digits). The API rejects the obvious sequences — `1234`, `0000`, `1111` — so
the seed does not use them either. A rider whose `pin_hash` is NULL cannot sign
in at all.

The token is stored in the OS keystore via `expo-secure-store` and revalidated
against `/api/auth/rider/me` on every launch, so a rider stays signed in across
restarts and is signed out automatically when the token expires — or the moment
a manager deactivates them, since `is_active` is re-checked on every request.

## What the rider sees

Three buckets, from `GET /api/delivery/{id}/dashboard`:

- **Incoming** — orders that are packed (`Ready`), unclaimed, inside the
  rider's service radius, and **not previously declined by this rider**.
  Sorted nearest first.
- **Active** — the one order currently in their hands (`Dispatched`).
- **Recent** — their last ten deliveries.

Each card shows the two numbers that matter: the cash to collect, and how long
is left on the delivery promise.

### On duty / off duty

The switch in the header calls `PATCH /api/delivery/availability`. Off duty
means no new offers; it does **not** surrender an order already accepted.

This is deliberately separate from `is_active`, which is the manager's switch
for someone who has left. A rider cannot re-enable a deactivated account by
toggling a button.

### One delivery at a time

A rider already carrying an order is offered nothing new. Stacking two drops on
one rider is the fastest way to miss a 15-minute promise.

### Reject actually does something now

It used to clear a database column that nothing ever set, so the order
reappeared on the next refresh and the button was decoration. Declining now
records the decision: that rider stops seeing the order, everyone else still
does. An order declined by every available rider shows up for the manager under
`GET /api/orders?stalled=true`.

## Offline behaviour

Riders lose signal constantly, so it is treated as an expected condition rather
than an error:

- Requests time out after 15 seconds instead of hanging forever.
- A failed refresh shows a banner and **keeps the last loaded screen** — a
  rider in a stairwell can still read the address they are delivering to.
- A failed action says so plainly and does not clear the queue.
- Pull down to retry.

A `409` gets its own message ("Order already moved on") because it is not a
failure: another rider took it first, or the store cancelled it.

## Pointing it at a backend

`src/config.ts` resolves the API URL in this order:

1. **`EXPO_PUBLIC_API_URL`** — an explicit build-time override. Ignored if it
   names `localhost` or `127.0.0.1`, because a phone cannot reach the dev
   machine's loopback address.
2. **The Expo dev server's LAN IP** — development only. This is why
   `npm start` just works on a real device with no configuration.
3. **`expo.extra.apiUrl` in `app.json`** — what a release build talks to.
4. Otherwise: `http://localhost:8000` in development, and a **thrown error** in
   a release build.

That last step is deliberate. Outside Expo Go there is no dev server to
auto-detect, so an unconfigured release build used to fall back to `localhost`
and fail every single request against an address that cannot exist on the
device. It now refuses to start with a message telling you which value to set.

**Before building a release**, set one of:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com npx expo run:android --variant release
```

or edit `app.json`:

```json
"extra": { "apiUrl": "https://api.example.com" }
```

`eas.json` sets `EXPO_PUBLIC_API_URL` per build profile — the `preview` and
`production` profiles both carry placeholder hostnames that must be replaced
before the first real build.

## Building

```bash
npx eas build --profile preview --platform android     # internal APK
npx eas build --profile production --platform android  # Play Store bundle
```

Profiles live in `eas.json`. `production` sets `autoIncrement` for both
`versionCode` and `buildNumber`, because a re-used version number is rejected
at upload and wastes a build.

Icons in `assets/` are generated, not hand-drawn — see the note in the repo
root README if you want to regenerate or replace them.

## Known gaps

- **No over-the-air updates.** `expo-updates` is not installed, so every fix
  ships through a store review. Adding it needs an EAS project id; installing
  it half-configured is worse than not having it.
- **No crash reporting.** Errors surface as alerts to the rider and nowhere
  else. Sentry's Expo SDK is the usual choice.
- **Push notifications need an EAS project id.** The code is in place (see
  below), but `getExpoPushTokenAsync` cannot issue a token until `eas init` has
  written `extra.eas.projectId` into `app.json`. Until then `src/push.ts` logs
  why and the app runs normally on its poll.
- **No notification icon.** Android renders one as a white silhouette, so it
  needs a purpose-made 96x96 transparent PNG; without one it falls back to the
  app icon, which comes out as a white blob. `app.json` says so at the
  `expo-notifications` plugin entry.
- **No background location**, so the customer's tracking page shows order
  status rather than a moving pin.

## Staying up to date

Two mechanisms, and only one of them carries data.

**The poll is the source of truth.** `DeliveryScreen` refetches the dashboard
every 15 seconds while the app is in the foreground, backing off to a minute
while the server is unreachable and refreshing immediately on resume. There is
no socket server in this repo — the `socket.io-client` dependency and the
`useSocket` hook that pretended otherwise are gone; they shipped in every APK
and connected to nothing.

**Push notifications are a prompt to look.** `src/push.ts` registers the
handset with the backend, which buzzes it when an order is assigned to this
rider or lands in the feed for anyone to take (`backend/api/push.py`). The
notification carries the address and the amount to collect and nothing else —
it renders on a lock screen, so the customer's name and phone number stay
inside the app. Receiving one triggers an immediate refresh, because the banner
would otherwise describe an order the screen behind it does not yet show.

Everything works with notifications denied, undelivered, or switched off
server-side; the rider is then 15 seconds behind rather than stuck. Three
things have to line up before any of it fires:

1. `eas init`, so the build has a project id to mint a push token against.
2. `eas credentials`, so Expo can reach FCM (Android) and APNs (iOS).
3. `PUSH_ENABLED=true` on the backend.

The rider is asked for permission once, on their first sign-in. A refusal is
recorded by the OS and never re-prompted, which is deliberate: a rider who does
not want their phone buzzing has said so.
