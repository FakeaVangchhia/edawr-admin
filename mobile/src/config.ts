import Constants from 'expo-constants';

// The Django/DRF backend (backend/) listens on 8000. The Next.js app on 3000 is
// UI only and serves no API routes.
const DEFAULT_PORT = '8000';

function extractHost(hostLike?: string | null): string | null {
  if (!hostLike) {
    return null;
  }

  const normalized = hostLike
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^exp:\/\//, '')
    .split('/')[0]
    .split(':')[0];

  return normalized || null;
}

/** The dev machine's LAN address, as reported by the Expo dev server.
 *
 * Only ever available while the app is running through Expo Go or a dev client:
 * a standalone build has no dev server to ask, so every one of these lookups
 * returns undefined and this function returns null.
 */
function buildExpoLanUrl(): string | null {
  const constants = Constants as typeof Constants & {
    manifest?: { debuggerHost?: string | null };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string | null } } };
  };

  const host =
    extractHost(constants.expoConfig?.hostUri) ??
    extractHost(constants.manifest2?.extra?.expoGo?.debuggerHost) ??
    extractHost(constants.manifest?.debuggerHost);

  return host ? `http://${host}:${DEFAULT_PORT}` : null;
}

/**
 * Addresses that are meaningless on a phone.
 *
 * A device can never reach the *computer's* loopback, so any of these as an
 * override is treated as unset rather than obeyed. `10.0.2.2` is the Android
 * emulator's alias for the host machine and `::1` is IPv6 loopback; both used
 * to slip through and produce a build that fails every request on real hardware.
 */
function isLocalhostUrl(url?: string | null): boolean {
  return !!url && /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.0\.2\.2)/i.test(url);
}

/**
 * Whether a URL would send the rider's PIN and bearer token in the clear.
 *
 * The old guard rejected only localhost, so `http://203.0.113.9:8000` sailed
 * through and shipped a release build that transmits credentials in plaintext
 * over whatever network the rider is on. Android would then refuse those
 * requests anyway — cleartext is off by default since Android 9 — so the result
 * was an app that is both insecure by intent and broken in practice, failing
 * with a network error that says nothing about why.
 *
 * Allowed in development, where the dev server is plain HTTP on a LAN by
 * design.
 */
function isInsecureUrl(url: string): boolean {
  return /^http:\/\//i.test(url);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// A phone can never reach the *computer's* localhost, so a localhost override is
// treated as unset rather than obeyed.
const envApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const configuredApiUrl = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl?.trim();

function rejectInsecure(url: string, source: string): string {
  if (!__DEV__ && isInsecureUrl(url)) {
    throw new Error(
      `eDawr: ${source} is an http:// URL (${url}). A release build must use ` +
        'https:// — the rider PIN and bearer token would otherwise cross the ' +
        'network in plaintext, and Android blocks cleartext by default so every ' +
        'request would fail regardless.',
    );
  }
  return url;
}

function resolveApiUrl(): string {
  // 1. An explicit build-time override always wins.
  if (envApiUrl && !isLocalhostUrl(envApiUrl)) {
    return rejectInsecure(envApiUrl, 'EXPO_PUBLIC_API_URL');
  }

  // 2. In development, follow the Expo dev server back to this machine's LAN
  //    IP. This is what makes `npm start` work on a real phone with no config.
  if (__DEV__) {
    const lanUrl = buildExpoLanUrl();
    if (lanUrl) {
      return lanUrl;
    }
  }

  // 3. A released build reads its backend from app.json's `expo.extra.apiUrl`.
  if (configuredApiUrl && !isLocalhostUrl(configuredApiUrl)) {
    return rejectInsecure(configuredApiUrl, 'expo.extra.apiUrl in app.json');
  }

  // 4. Nothing configured. In development localhost is a reasonable guess (the
  //    simulator case). In a release build it is guaranteed wrong — there is no
  //    dev server to auto-detect and no override was baked in — so say so
  //    loudly rather than shipping an app that silently fails every request
  //    against an address that cannot exist on the device.
  if (!__DEV__) {
    throw new Error(
      'eDawr: no API URL configured for this build. Set EXPO_PUBLIC_API_URL at ' +
        'build time, or expo.extra.apiUrl in app.json, to the public URL of the ' +
        'Django backend.',
    );
  }

  return `http://localhost:${DEFAULT_PORT}`;
}

/**
 * Why the resolution above is caught rather than allowed to throw.
 *
 * Failing loudly on a misconfigured release build is right, and the two
 * conditions that raise — no URL at all, and an `http://` URL — are both
 * deliberate. What was wrong was *where* it happened: at module scope, during
 * the import of `config.ts`, which `api.ts` imports and `App.tsx` imports in
 * turn. So the throw landed before React had rendered anything and before any
 * error boundary existed to catch it, and the carefully written message went to
 * a log nobody reads while the rider got a white screen and a crash to home.
 *
 * The message is the entire value of failing loudly, so it has to reach a
 * screen. `App.tsx` checks `configError` and renders it; `apiUrl()` throws for
 * anything that somehow calls it anyway.
 *
 * `API_URL` stays exported and is `''` when unresolved — `LoginScreen` puts it
 * in an error message, which is a string either way, and the app never gets
 * that far in the broken case.
 */
let resolvedApiUrl = '';
let resolutionError: string | null = null;

try {
  resolvedApiUrl = stripTrailingSlash(resolveApiUrl());
} catch (caught) {
  resolutionError =
    caught instanceof Error ? caught.message : 'eDawr: the API URL is misconfigured.';
}

/** Non-null when this build cannot talk to a backend at all. */
export const configError = resolutionError;

export const API_URL = resolvedApiUrl;

/** The backend's base URL, or a throw naming exactly what is misconfigured. */
export function apiUrl(): string {
  if (resolutionError !== null) throw new Error(resolutionError);
  return resolvedApiUrl;
}
