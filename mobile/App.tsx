import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { UnauthorizedError, fetchRiderSession } from './src/api';
import DeliveryScreen from './src/screens/DeliveryScreen';
import LoginScreen from './src/screens/LoginScreen';
import { clearToken, loadToken, saveToken } from './src/session';
import { RiderSession } from './src/types';

export default function App() {
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
  }, []);

  const handleLogout = useCallback(async () => {
    setSession(null);
    await clearToken();
  }, []);

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
