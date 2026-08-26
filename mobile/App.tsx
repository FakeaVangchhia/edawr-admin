import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { UnauthorizedError, fetchRiderSession, riderLogout } from './src/api';
import { configError } from './src/config';
import { ConfigErrorScreen, ErrorBoundary } from './src/ErrorBoundary';
import {
  registerForPushNotifications,
  unregisterForPushNotifications,
} from './src/push';
import { reportRiderCrash } from './src/report-error';
import DeliveryScreen from './src/screens/DeliveryScreen';
import LoginScreen from './src/screens/LoginScreen';
import { clearToken, loadToken, saveToken } from './src/session';
import { RiderSession } from './src/types';

/**
 * The root, and the two things that wrap everything else.
 *
 * **`ConfigErrorScreen` before anything.** A release build with no
 * `expo.extra.apiUrl` and no `EXPO_PUBLIC_API_URL` cannot work, and used to say
 * so by throwing during the import of `config.ts` — before React existed, so
 * the carefully worded message went nowhere and the rider got a white screen.
 * It is now caught there and shown here.
 *
 * **`ErrorBoundary` around the app.** React Native's default for an uncaught
 * render throw is to unmount everything, which in a release build is a crash to
 * the home screen with no explanation, mid-shift.
 */
export default function App() {
  if (configError !== null) {
    return <ConfigErrorScreen message={configError} />;
  }

  return (
    <ErrorBoundary onError={reportRiderCrash}>
      <RiderApp />
    </ErrorBoundary>
  );
}

function RiderApp() {
  const [session, setSession] = useState<RiderSession | null>(null);
  // Distinct from "signed out": on launch we do not yet know which it is, and
  // flashing the login screen at a rider who is already signed in is jarring.
  const [restoring, setRestoring] = useState(true);

  // Restore a stored token, then revalidate it against the backend. Validating
  // rather than trusting it matters: the token may have expired, or the rider
  // may have been deactivated since, and finding that out here is far better
  // than on their first tap of Accept.
  //
  // **The catch is narrow, and that is the whole point of this block.** It used
  // to be a bare `catch { clearToken() }`, and `api.ts` turns every fetch
  // rejection — including the 15-second timeout — into `OfflineError`. So a
  // rider opening the app in a stairwell, a basement, or the road out of
  // Aizawl had their SecureStore credential permanently deleted, and could not
  // sign back in either, because logging in also needs the network. A dead spot
  // became a hard lockout that only the manager could undo.
  //
  // Only `UnauthorizedError` — a real 401, meaning the server looked at the
  // token and rejected it — ends the session. Anything else keeps the token and
  // lets the rider try again when they have signal.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await loadToken();
      if (token) {
        try {
          const restored = await fetchRiderSession(token);
          if (!cancelled) {
            setSession(restored);
            // /rider/me returns a fresh token; keep the stored one rolling so a
            // rider who opens the app regularly is never logged out mid-shift.
            // Inside the guard: writing after unmount is a write nothing reads.
            await saveToken(restored.access_token);
            // Every launch, not just the first sign-in: Expo rotates a push
            // token on reinstall and on restore to a new phone without telling
            // anyone, so a registration made once quietly stops working. It
            // never throws and never blocks — see src/push.ts.
            registerForPushNotifications(restored.access_token);
          }
        } catch (caught) {
          if (caught instanceof UnauthorizedError) {
            await clearToken();
          }
          // Otherwise the token stays. The rider lands on the login screen for
          // this launch, but their credential survives, so the next launch with
          // signal restores them without a PIN.
        }
      }
      if (!cancelled) {
        setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = useCallback(async (next: RiderSession) => {
    setSession(next);
    await saveToken(next.access_token);
    // Not awaited: the permission prompt is the rider's to answer in their own
    // time, and the delivery feed should be on screen behind it rather than
    // waiting on it.
    registerForPushNotifications(next.access_token);
  }, []);

  const handleLogout = useCallback(async () => {
    // Retire the token server-side, then clear it locally regardless. Ordered
    // this way because the call needs the token, and safe because `riderLogout`
    // swallows its own failures: a rider signing out in a basement must still
    // be signed out of the phone in front of them.
    // Unregister the handset *before* the token is retired, and before the
    // local copy is cleared — both calls need it. Ordering matters more here
    // than it looks: Expo delivers to a handset, not to a session, so a token
    // left registered keeps buzzing this phone for orders that now belong to
    // whoever signs in next. Like `riderLogout`, it swallows its own failure.
    if (session) {
      await unregisterForPushNotifications(session.access_token);
      await riderLogout(session.access_token);
    }
    setSession(null);
    await clearToken();
  }, [session]);

  if (restoring) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#4169E1" />
      </View>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <DeliveryScreen
      session={session}
      onLogout={handleLogout}
    />
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
});
