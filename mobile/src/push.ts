import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { forgetPushToken, registerPushToken } from './api';

/**
 * Getting the phone to buzz when an order lands on it.
 *
 * The dashboard polls every fifteen seconds — but only while the app is open,
 * and a rider between drops has the screen off and the phone in a pocket. The
 * backend assigns an order the instant a manager marks the bag packed
 * (`backend/api/dispatch.py`), so without this the rider finds out when they
 * next look, which on a fifteen-minute promise is most of the promise.
 *
 * **Nothing here is load-bearing.** Every function returns quietly on every
 * failure: no permission, no project id, a simulator, an offline register call.
 * The poll still works, the app still works, and the rider is fifteen seconds
 * behind rather than dead in the water. A notification is a prompt to look at
 * the app, never how the order arrives — so an error path here that could throw
 * would be a crash traded for a convenience.
 */

/** Must match `CHANNEL_ID` in backend/api/push.py, and `channelId` on the
 *  messages it sends. A mismatch is silent: Android files the notification
 *  under a default channel with whatever importance that channel has, which the
 *  rider may have turned down months ago for something unrelated. */
const CHANNEL_ID = 'orders';

/**
 * How a notification behaves when it arrives while the rider is *in* the app.
 *
 * Banner and sound stay on. The instinct is to suppress them — the rider is
 * already looking at the screen, so why interrupt? — but the screen they are
 * looking at is very often the address of the drop they are currently on, and
 * "another one just came in" is exactly the thing they need to see without
 * navigating away. `shouldShowList` keeps it in the tray so it is still there
 * if they were mid-tap and missed it.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * The EAS project this build belongs to.
 *
 * `getExpoPushTokenAsync` needs it and has needed it since SDK 49 — Expo's push
 * service uses it to work out which credentials to send under. It is absent
 * until somebody runs `eas init`, which is why this is read defensively rather
 * than asserted: a build with no project id is a perfectly working rider app
 * that cannot be notified, and it should say so in a log rather than fail to
 * start. The same reasoning as `configError` in `config.ts`, one severity down,
 * because a missing API URL is fatal and this is not.
 */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Ask Android to give this channel its own importance setting.
 *
 * `MAX` because a delivery assignment is the case heads-up notifications exist
 * for — it should appear over whatever is on screen and make a sound. Without
 * an explicit channel, Android 8+ files everything under a default channel at
 * `DEFAULT` importance, which does not pop and can be silenced by a rider who
 * was trying to mute something else. Creating a channel with a name they can
 * recognise is also what lets them mute *this* deliberately, which is a choice
 * worth giving someone whose phone is their working tool.
 *
 * A no-op on iOS, where the equivalent is decided by the permission grant.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'New deliveries',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4169E1',
    sound: 'default',
  });
}

/**
 * The Expo push token for this handset, or null with a reason logged.
 *
 * Null is a normal outcome, not an error, and there are three ways to get it:
 *
 * **A simulator.** There is no APNs or FCM registration to make, so Expo cannot
 * issue a token. Checked first because it is the one every developer hits and
 * the failure it otherwise produces is an opaque native error.
 *
 * **The rider said no.** `requestPermissionsAsync` is asked exactly once — the
 * OS only ever shows the prompt once, and after that it answers from the stored
 * decision. Nothing here nags, and nothing here treats a refusal as a state to
 * recover from: a rider who does not want their phone buzzing has said so, and
 * the app works without it.
 *
 * **No EAS project id.** See `projectId` above.
 */
async function getExpoToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[push] no token: notifications need a physical device');
    return null;
  }

  const id = projectId();
  if (!id) {
    console.log('[push] no token: this build has no EAS project id (run `eas init`)');
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  // `granted` is false on iOS for a provisional grant, which still delivers —
  // `status` is the field that distinguishes "not yet asked" from "refused".
  const status =
    existing.status === 'undetermined'
      ? (await Notifications.requestPermissionsAsync()).status
      : existing.status;

  if (status !== 'granted') {
    console.log(`[push] no token: notification permission is "${status}"`);
    return null;
  }

  await ensureAndroidChannel();

  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  return token.data;
}

/** The token this app last registered, so sign-out knows what to unregister.
 *
 * Module state rather than SecureStore: it is not a credential, it is derived
 * from the handset in a fraction of a second, and a value that outlived the
 * process would be a stale token we tell the server to forget — possibly one
 * that now belongs to the next rider who signed in on this phone.
 */
let currentToken: string | null = null;

/**
 * Register this handset against the signed-in rider. Call on every launch.
 *
 * Every launch rather than once, because Expo rotates a push token on
 * reinstall, on restore to a new phone, and across some native updates, and it
 * does not tell the server it did. The backend upserts on the token
 * (`push.register_device`), so the repeat costs one request and guarantees the
 * row is never stale.
 *
 * Swallows everything. A rider whose registration failed still has a working
 * app; one who got an unhandled rejection on launch does not.
 */
export async function registerForPushNotifications(authToken: string): Promise<void> {
  try {
    const expoToken = await getExpoToken();
    if (!expoToken) return;

    await registerPushToken(expoToken, Platform.OS === 'ios' ? 'ios' : 'android', authToken);
    currentToken = expoToken;
  } catch (error) {
    // Offline, permission revoked between the check and the call, an Expo
    // outage. All the same to the rider: no buzz, everything else unchanged.
    console.log('[push] could not register this device', error);
  }
}

/**
 * Unregister at sign-out, so the next rider on this handset gets their own drops.
 *
 * This matters most on a shared phone at shift change. Expo delivers to a token,
 * not to a session, so a token left registered keeps buzzing for orders that are
 * no longer this rider's — and the backend cannot know the app has signed out.
 * The server also claims a token for whoever registered last, which covers the
 * case where the next rider signs in; this covers the gap in between.
 *
 * Takes the auth token as an argument because by the time `App.tsx` has cleared
 * the session there is nothing left to authenticate with — the same ordering
 * `riderLogout` needs, and for the same reason.
 */
export async function unregisterForPushNotifications(authToken: string): Promise<void> {
  const expoToken = currentToken;
  currentToken = null;
  if (!expoToken) return;

  try {
    await forgetPushToken(expoToken, authToken);
  } catch (error) {
    console.log('[push] could not unregister this device', error);
  }
}

/**
 * Run `onOrderNotification` whenever a delivery notification arrives or is tapped.
 *
 * Two listeners, because they fire on genuinely different events and the app
 * wants the same thing from both — fresh data:
 *
 *   received — it arrived while the app was in the foreground. The rider may
 *              not have touched anything, so the dashboard has to catch up on
 *              its own or the banner is describing an order that is not on the
 *              screen behind it.
 *   response — the rider tapped it, from the tray or the lock screen. The app
 *              is coming to the foreground, and `AppState` will refresh too, but
 *              this fires first and a tap should not land on a stale list.
 *
 * Returns a teardown function. Both subscriptions must be removed on unmount or
 * a re-mount leaves the old one holding a callback that closes over a dead
 * session.
 */
export function addOrderNotificationListener(onOrderNotification: () => void): () => void {
  const received = Notifications.addNotificationReceivedListener(() => {
    onOrderNotification();
  });
  const responded = Notifications.addNotificationResponseReceivedListener(() => {
    onOrderNotification();
  });

  return () => {
    received.remove();
    responded.remove();
  };
}
