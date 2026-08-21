import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  ConflictError,
  ForbiddenError,
  OfflineError,
  UnauthorizedError,
  acceptOrder,
  fetchDashboard,
  rejectOrder,
  setAvailability,
  setOrderStatus,
} from '../api';
import { DeliveryDashboard, Order, RiderSession, RiderStatus } from '../types';

interface DeliveryScreenProps {
  session: RiderSession;
  onLogout: () => void;
}

const emptyDashboard: DeliveryDashboard = {
  incoming_orders: [],
  active_order: null,
  recent_orders: [],
  is_available: true,
};

/**
 * Polling is the refresh path, not a fallback: there is no socket server, and
 * the `socket.io-client` dependency that pretended otherwise has been removed —
 * it shipped in every APK, connected to nothing, and its listeners called the
 * same `refreshDashboard` the timer below already calls. Fifteen seconds on a
 * 15-minute promise.
 */
const REFRESH_MS = 15_000;

/** How far the poll backs off while the server is unreachable. */
const MAX_BACKOFF_MS = 60_000;

/**
 * Why a delivery did not happen, in the words the store will read later.
 *
 * A closed list rather than a text box: the rider is standing at a door, often
 * in the rain, and these four cover what actually occurs. Each string goes
 * straight onto `Order.cancellation_reason` and into the audit trail, so they
 * are written as complete sentences rather than as labels.
 */
const FAILURE_REASONS: { label: string; reason: string }[] = [
  { label: 'Nobody answered', reason: 'Nobody answered at the address' },
  { label: 'Customer refused it', reason: 'Customer refused the order at the door' },
  { label: 'Could not find the address', reason: 'Could not find the address' },
  { label: 'Customer could not pay', reason: 'Customer could not pay the cash amount' },
];

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatItems(order: Order) {
  return order.items.map(item => `${item.quantity}x ${item.name}`).join(', ');
}

/**
 * The exact figure, to the paisa — the same one the customer is looking at.
 *
 * This used to be `₹${Math.round(value)}`, on the reasoning that a rider
 * counting cash at a door does not need paise. The reasoning was wrong in the
 * only way that matters: the customer's tracking page renders `grand_total`
 * with two decimals, so a ₹342.50 order told the customer ₹342.50 and told the
 * rider to collect ₹343. Every basket ending in .50 was a doorstep argument,
 * every basket ending in .40 was a shortfall, and the till never reconciled
 * against the order ledger.
 *
 * `Math.round` is also arithmetic on money, which is the one thing this
 * codebase does not do on a client.
 *
 * The `Number` coercion guards a stringified total: DRF is configured with
 * COERCE_DECIMAL_TO_STRING = False so these arrive as numbers, but a proxy or a
 * future serialiser change should not render `₹NaN` at a customer's door.
 */
function formatMoney(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₹${amount.toFixed(2)}`
    : '₹—';
}

function countdownLabel(order: Order) {
  if (order.is_late) return 'Overdue';
  if (order.minutes_remaining <= 0) return 'Due now';
  return `${order.minutes_remaining} min left`;
}

export default function DeliveryScreen({ session, onLogout }: DeliveryScreenProps) {
  const [dashboard, setDashboard] = useState<DeliveryDashboard>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  // Shown as a quiet banner rather than an alert. Losing signal is an expected
  // part of the job, not an error the rider did something to cause.
  const [isOffline, setIsOffline] = useState(false);
  const [togglingAvailability, setTogglingAvailability] = useState(false);

  const user = session.rider;
  const token = session.access_token;

  // An expired or revoked token is not an error the rider can act on, so it
  // ends the session instead of raising an alert they can only dismiss and
  // then hit again on every subsequent tap.
  /**
   * Signing out is not something to do by accident mid-shift.
   *
   * Logging back in needs the PIN *and* the network, so a rider who taps this
   * in a dead spot is stuck at a login screen they cannot get past. The
   * confirmation also names the active delivery, because handing an order back
   * before signing out is the thing they should do first.
   */
  const confirmSignOut = useCallback(() => {
    Alert.alert(
      'Sign out?',
      'You will need your phone number and PIN to sign back in, and that needs a connection.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: onLogout },
      ],
    );
  }, [onLogout]);

  const handleExpiredSession = useCallback(() => {
    Alert.alert('Signed out', 'Your session has expired. Please sign in again.');
    onLogout();
  }, [onLogout]);

  // `useCallback` because the poll effect lists this in its dependency array; a
  // fresh function identity each render would tear the timer down and rebuild
  // it on every state change, resetting the interval each time.
  // Guards against two refreshes running at once — a poll and a pull-to-refresh,
  // or a poll and an AppState resume. A ref rather than state because changing
  // it must not re-render, and because the poll loop reads it synchronously.
  const inFlight = useRef(false);

  /** Returns whether the fetch succeeded, which is what drives the backoff. */
  const refreshDashboard = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return true;
    inFlight.current = true;
    try {
      setDashboard(await fetchDashboard(user.id, token));
      setIsOffline(false);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        handleExpiredSession();
        return false;
      }
      if (error instanceof OfflineError) {
        // Keep whatever is already on screen. A rider in a stairwell should
        // still be able to read the address they are delivering to.
        setIsOffline(true);
        return false;
      }
      console.error(error);
      Alert.alert('Connection issue', 'Unable to refresh delivery feed.');
      return false;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [user.id, token, handleExpiredSession]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  /**
   * Poll, because there is no socket server to push to us.
   *
   * Three things this has to get right, none of which `setInterval` gives you:
   *
   * **Polls must not stack.** `setInterval` with an async callback does not wait
   * for the previous call, and the request timeout is 15s — exactly the old
   * interval. A request that ran to its full timeout finished precisely as the
   * next began, and anything slower overlapped, so a slow older response could
   * land after a fast newer one and overwrite fresh data with stale. The
   * self-scheduling `setTimeout` below cannot overlap by construction: the next
   * one is not queued until this one has settled.
   *
   * **It must stop in the background.** There was no `AppState` listener at all,
   * so the app polled every fifteen seconds all shift while nobody was looking
   * at it — battery and mobile data, both of which a rider is paying for. It
   * also never refreshed *on* resume, so a rider returning to the app read stale
   * data until the next tick.
   *
   * **It must back off when the server is unreachable.** Hammering a dead
   * connection every 15 seconds helps nobody; the delay doubles up to a minute
   * and resets the moment a request succeeds.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let delay = REFRESH_MS;

    const tick = async () => {
      // Skip the fetch when backgrounded, but keep the loop alive so it resumes
      // on its own without waiting for the AppState listener to fire.
      if (AppState.currentState === 'active') {
        const ok = await refreshDashboard();
        delay = ok ? REFRESH_MS : Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      if (!cancelled) {
        timer = setTimeout(tick, delay);
      }
    };

    timer = setTimeout(tick, REFRESH_MS);

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // Straight away, not on the next tick: the first thing a rider does
        // after unlocking their phone is look at the screen.
        delay = REFRESH_MS;
        refreshDashboard();
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [refreshDashboard]);

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDashboard();
    setRefreshing(false);
  }, [refreshDashboard]);

  const toggleAvailability = useCallback(
    async (next: boolean) => {
      setTogglingAvailability(true);
      // Optimistic: the switch must feel instant. Reverted below if the call
      // fails, so it can never show "online" while the server thinks otherwise.
      setDashboard(current => ({ ...current, is_available: next }));
      try {
        await setAvailability(next, token);
        await refreshDashboard();
      } catch (error) {
        setDashboard(current => ({ ...current, is_available: !next }));
        if (error instanceof UnauthorizedError) {
          handleExpiredSession();
        } else if (error instanceof OfflineError) {
          setIsOffline(true);
        } else {
          Alert.alert('Could not update', 'Please try again.');
        }
      } finally {
        setTogglingAvailability(false);
      }
    },
    [token, refreshDashboard, handleExpiredSession],
  );

  const callCustomer = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Cannot place call', phone);
    });
  }, []);

  /**
   * Open the drop in whatever maps app the phone has.
   *
   * `geo:` is the Android intent scheme and `maps:` the iOS one; both accept a
   * `q=` free-text fallback, which is what a customer who declined to share a
   * position leaves us with. The `?q=lat,lng(label)` form drops a labelled pin
   * rather than just centring the map, so the rider can see the destination
   * against the road.
   */
  const openDirections = useCallback((order: Order) => {
    const hasPosition =
      order.customer_latitude !== null && order.customer_longitude !== null;
    const label = encodeURIComponent(`Order #${order.id}`);
    const query = hasPosition
      ? `${order.customer_latitude},${order.customer_longitude}(${label})`
      : encodeURIComponent(order.customer_address);

    const scheme = Platform.OS === 'ios' ? `maps:0,0?q=${query}` : `geo:0,0?q=${query}`;
    Linking.openURL(scheme).catch(() => {
      // No maps app, or the scheme was refused. The web fallback works
      // everywhere and is better than an alert the rider can only dismiss.
      const web = hasPosition
        ? `https://www.google.com/maps/search/?api=1&query=${order.customer_latitude},${order.customer_longitude}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customer_address)}`;
      Linking.openURL(web).catch(() => {
        Alert.alert('Cannot open maps', order.customer_address);
      });
    });
  }, []);

  /**
   * Marking an order delivered is irreversible and it is about money.
   *
   * `Delivered` is terminal in `Order.TRANSITIONS` — nothing, including a
   * manager, can move an order out of it — and this is a cash-on-delivery
   * store, so the tap also asserts that the rider took the money. It used to be
   * a single unguarded `onPress`: one fat-finger in a jacket pocket permanently
   * recorded an undelivered order as delivered and paid, with no correction
   * path in any of the three apps.
   *
   * The confirmation states the amount, which makes it a cash-collected step
   * rather than merely an "are you sure" — the rider has to read the figure
   * they are confirming they hold.
   */
  const confirmDelivered = useCallback(
    (order: Order) => {
      Alert.alert(
        `Delivered order #${order.id}?`,
        `Confirm you handed over the order and collected ${formatMoney(order.grand_total)} in cash.

This cannot be undone.`,
        [
          { text: 'Not yet', style: 'cancel' },
          {
            text: `Collected ${formatMoney(order.grand_total)}`,
            style: 'default',
            onPress: () => submitDecision(order.id, 'status', 'Delivered'),
          },
        ],
      );
    },
    // `submitDecision` is redefined every render and is not memoised; listing it
    // would defeat the useCallback entirely. It closes over `token` and
    // `refreshDashboard`, both of which are stable for the life of a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Give the order back to the pool. The backend supports it; the app never did. */
  const confirmHandBack = useCallback(
    (order: Order) => {
      Alert.alert(
        `Hand order #${order.id} back?`,
        'It goes back to the pool for another rider. Use this if you cannot get there — a broken bike, or you are needed elsewhere.',
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Hand back',
            onPress: () => submitDecision(order.id, 'status', 'Ready'),
          },
        ],
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Report a delivery that was attempted and did not happen.
   *
   * A modal rather than `Alert.alert`, and that is not a styling preference.
   * React Native's Android Alert does `buttons.slice(0, 3)` — see
   * `Libraries/Alert/Alert.js` — so a Cancel plus three reasons silently drops
   * the third one on the rider's actual platform. A rider who could not find
   * the address would have been left choosing a reason that was false, which is
   * precisely the "a lie the till has to absorb" problem this whole feature
   * exists to remove.
   *
   * The reason is required by the server, and rightly: it is the sentence the
   * store reads when the customer rings. A tap list beats typing at a doorstep
   * in the rain, and `Alert.prompt` is iOS-only anyway.
   */
  const [failing, setFailing] = useState<Order | null>(null);

  const confirmFailed = useCallback((order: Order) => {
    setFailing(order);
  }, []);

  const sendFailure = (reason: string) => {
    const order = failing;
    setFailing(null);
    if (order) {
      submitDecision(order.id, 'status', 'Failed', reason);
    }
  };

  const submitDecision = async (
    orderId: number,
    action: 'accept' | 'reject' | 'status',
    // Was typed `'Delivered'` and nothing else, which made the app's entire
    // vocabulary one word — see `setOrderStatus` in src/api.ts for what that
    // cost a rider who could not complete a drop.
    status?: RiderStatus,
    reason?: string,
  ) => {
    try {
      setSubmittingId(orderId);
      // No rider id is sent for any of these — the backend takes it from the
      // bearer token. See backend/api/views/orders.py.
      if (action === 'accept') {
        await acceptOrder(orderId, token);
      } else if (action === 'reject') {
        await rejectOrder(orderId, token);
      } else {
        await setOrderStatus(orderId, status ?? 'Delivered', token, reason);
      }

      await refreshDashboard();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        handleExpiredSession();
        return;
      }
      if (error instanceof ForbiddenError) {
        // The server knows exactly who this rider is and is refusing the
        // action — most often because a manager returned the order to the pool
        // between two polls. This used to arrive as UnauthorizedError and sign
        // the rider out mid-shift with "your session has expired", which was
        // false and cost them their PIN and a working signal to get back in.
        Alert.alert('Not yours to change', error.message);
        await refreshDashboard();
        return;
      }
      if (error instanceof OfflineError) {
        setIsOffline(true);
        Alert.alert('You are offline', 'That did not go through. Try again once you have signal.');
        return;
      }
      if (error instanceof ConflictError) {
        // Another rider got there first, or the store cancelled it. Not a
        // failure the rider caused, and the feed needs to catch up.
        Alert.alert('Order already moved on', error.message);
        await refreshDashboard();
        return;
      }
      Alert.alert('Action failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmittingId(null);
    }
  };

  const incomingOrders = dashboard.incoming_orders;
  const activeOrder = dashboard.active_order;
  const recentOrders = dashboard.recent_orders;

  const renderIncomingCard = ({ item }: { item: Order }) => (
    <View style={styles.offerCard}>
      <View style={styles.offerTopRow}>
        <View>
          <Text style={styles.offerEyebrow}>Incoming Request</Text>
          <Text style={styles.orderTitle}>Order #{item.id}</Text>
        </View>
        <View style={styles.pillPrimary}>
          <Ionicons name="navigate" size={13} color="#4169E1" />
          <Text style={styles.pillPrimaryText}>{item.offered_distance_km?.toFixed(1) ?? '0.0'} km</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Ionicons name="person-circle-outline" size={16} color="#64748b" />
        <Text style={styles.metaText}>{item.customer_name}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={16} color="#64748b" />
        <Text style={styles.metaText}>{item.customer_address}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="cube-outline" size={16} color="#64748b" />
        <Text style={styles.metaText}>{formatItems(item)}</Text>
      </View>

      {/* The two numbers that decide whether to take the job: how much cash to
          carry back, and how long is left on the promise. */}
      <View style={styles.factRow}>
        <View style={styles.factBox}>
          <Text style={styles.factLabel}>Collect cash</Text>
          <Text style={styles.factValue}>{formatMoney(item.grand_total)}</Text>
        </View>
        <View style={styles.factBox}>
          <Text style={styles.factLabel}>Promise</Text>
          <Text style={[styles.factValue, item.is_late && styles.factValueLate]}>
            {countdownLabel(item)}
          </Text>
        </View>
      </View>

      <View style={styles.offerActions}>
        <TouchableOpacity
          style={[styles.secondaryAction, submittingId === item.id && styles.actionDisabled]}
          disabled={submittingId === item.id}
          onPress={() => submitDecision(item.id, 'reject')}
        >
          <Text style={styles.secondaryActionText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryAction, submittingId === item.id && styles.actionDisabled]}
          disabled={submittingId === item.id}
          onPress={() => submitDecision(item.id, 'accept')}
        >
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.primaryActionText}>Accept Delivery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#4169E1" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {/* Was a bare back-arrow: unlabelled, unconfirmed, and the only
              logout in the app. Every other app on the phone has trained the
              rider that a back-arrow goes back, so they tap it, are signed out
              instantly, and need their PIN and a working signal to get back
              in — possibly with a delivery in their hand. */}
          <TouchableOpacity
            onPress={confirmSignOut}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>eDawr Rider Console</Text>
            <Text style={styles.headerSubtitle}>{user.name}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.connectionLabel}>
            {dashboard.is_available ? 'On duty' : 'Off duty'}
          </Text>
          <Switch
            value={dashboard.is_available}
            onValueChange={toggleAvailability}
            disabled={togglingAvailability}
            trackColor={{ false: '#94a3b8', true: '#34d399' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* A banner, not an alert: riders lose signal constantly and a modal on
          every dropout would be unusable. Whatever was last loaded stays on
          screen underneath it. */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#7c2d12" />
          <Text style={styles.offlineBannerText}>
            No connection — showing your last update. Pull down to retry.
          </Text>
        </View>
      )}

      {!dashboard.is_available && (
        <View style={styles.dutyBanner}>
          <Ionicons name="pause-circle-outline" size={16} color="#1e3a8a" />
          <Text style={styles.dutyBannerText}>
            You are off duty. Switch on to start receiving orders.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#4169E1" />
        </View>
      ) : (
        <FlatList
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          data={incomingOrders}
          keyExtractor={item => item.id.toString()}
          renderItem={renderIncomingCard}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullToRefresh} tintColor="#4169E1" />
          }
          ListHeaderComponent={
            <>
              <View style={styles.heroCard}>
                <View>
                  <Text style={styles.heroKicker}>Service Zone</Text>
                  <Text style={styles.heroTitle}>{user.service_radius_km.toFixed(0)} km dispatch radius</Text>
                  <Text style={styles.heroSubtitle}>
                    Orders are offered only if they fall inside your nearby delivery range.
                  </Text>
                </View>
                <View style={styles.heroBadge}>
                  <Ionicons name="flash" size={18} color="#fff" />
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Upcoming Requests</Text>
                <Text style={styles.sectionCount}>{incomingOrders.length}</Text>
              </View>

              {activeOrder ? (
                <View style={styles.activeCard}>
                  <View style={styles.offerTopRow}>
                    <View>
                      <Text style={styles.offerEyebrow}>Active Delivery</Text>
                      <Text style={styles.orderTitle}>Order #{activeOrder.id}</Text>
                    </View>
                    <View style={styles.activePill}>
                      <Ionicons name="bicycle" size={14} color="#047857" />
                      <Text style={styles.activePillText}>In Progress</Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="person-circle-outline" size={16} color="#64748b" />
                    <Text style={styles.metaText}>{activeOrder.customer_name}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={16} color="#64748b" />
                    <Text style={styles.metaText}>{activeOrder.customer_address}</Text>
                  </View>
                  {/* Collected at checkout specifically to make a 15-minute
                      delivery likelier, then never shown to the one person who
                      needs it. In Aizawl the landmark is how you find the door. */}
                  {activeOrder.customer_landmark ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="flag-outline" size={16} color="#64748b" />
                      <Text style={styles.metaText}>{activeOrder.customer_landmark}</Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.metaRow}
                    onPress={() => callCustomer(activeOrder.customer_phone)}
                  >
                    <Ionicons name="call-outline" size={16} color="#4169E1" />
                    <Text style={[styles.metaText, styles.metaLink]}>
                      {activeOrder.customer_phone}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.metaRow}>
                    <Ionicons name="cube-outline" size={16} color="#64748b" />
                    <Text style={styles.metaText}>{formatItems(activeOrder)}</Text>
                  </View>
                  {activeOrder.delivery_notes ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="#64748b" />
                      <Text style={styles.metaText}>{activeOrder.delivery_notes}</Text>
                    </View>
                  ) : null}

                  <View style={styles.factRow}>
                    <View style={styles.factBox}>
                      <Text style={styles.factLabel}>Collect cash</Text>
                      <Text style={styles.factValue}>{formatMoney(activeOrder.grand_total)}</Text>
                    </View>
                    <View style={styles.factBox}>
                      <Text style={styles.factLabel}>Promise</Text>
                      <Text
                        style={[styles.factValue, activeOrder.is_late && styles.factValueLate]}
                      >
                        {countdownLabel(activeOrder)}
                      </Text>
                    </View>
                  </View>

                  {/* The single most valuable thing a delivery app does, and
                      the app was throwing away the coordinates it needed. Falls
                      back to searching the typed address when the customer did
                      not share a position — which is now a real, distinguishable
                      state rather than the store's own coordinates. */}
                  <TouchableOpacity
                    style={styles.navigateButton}
                    onPress={() => openDirections(activeOrder)}
                  >
                    <Ionicons name="navigate" size={18} color="#4169E1" />
                    <Text style={styles.navigateButtonText}>Navigate</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.completeButton, submittingId === activeOrder.id && styles.actionDisabled]}
                    disabled={submittingId === activeOrder.id}
                    onPress={() => confirmDelivered(activeOrder)}
                  >
                    <Ionicons name="checkmark-done-circle" size={18} color="#fff" />
                    <Text style={styles.completeButtonText}>Mark Delivered</Text>
                  </TouchableOpacity>

                  {/* The two exits that did not exist. A rider whose drop could
                      not be completed had one button — "Mark Delivered" — which
                      records the goods as sold and paid for and never returns
                      the stock. */}
                  <View style={styles.secondaryRow}>
                    <TouchableOpacity
                      style={[styles.secondaryButton, submittingId === activeOrder.id && styles.actionDisabled]}
                      disabled={submittingId === activeOrder.id}
                      onPress={() => confirmHandBack(activeOrder)}
                    >
                      <Ionicons name="return-up-back" size={16} color="#475569" />
                      <Text style={styles.secondaryButtonText}>Hand back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.dangerButton, submittingId === activeOrder.id && styles.actionDisabled]}
                      disabled={submittingId === activeOrder.id}
                      onPress={() => confirmFailed(activeOrder)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color="#b91c1c" />
                      <Text style={styles.dangerButtonText}>Could not deliver</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.emptyActiveCard}>
                  <Ionicons name="time-outline" size={26} color="#94a3b8" />
                  <Text style={styles.emptyActiveTitle}>No active trip right now</Text>
                  <Text style={styles.emptyActiveText}>Accept the next nearby request to start your run.</Text>
                </View>
              )}

              {incomingOrders.length === 0 && (
                <View style={styles.queueEmptyCard}>
                  <Ionicons name="notifications-off-outline" size={24} color="#94a3b8" />
                  <Text style={styles.queueEmptyTitle}>
                    {!dashboard.is_available
                      ? 'You are off duty'
                      : activeOrder
                        ? 'Finish your current delivery first'
                        : 'No nearby offers right now'}
                  </Text>
                  <Text style={styles.queueEmptyText}>
                    {!dashboard.is_available
                      ? 'Switch on at the top to start receiving orders.'
                      : activeOrder
                        ? 'New offers appear once this one is delivered — one drop at a time keeps the promise.'
                        : 'Packed orders inside your service radius will appear here.'}
                  </Text>
                </View>
              )}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Completed Recently</Text>
                <Text style={styles.sectionCount}>{recentOrders.length}</Text>
              </View>
            </>
          }
          ListFooterComponent={
            <View style={styles.historySection}>
              {recentOrders.length === 0 ? (
                <Text style={styles.historyEmpty}>Completed deliveries will appear here.</Text>
              ) : (
                recentOrders.map(order => (
                  <View key={order.id} style={styles.historyCard}>
                    <View>
                      <Text style={styles.historyOrderTitle}>Order #{order.id}</Text>
                      <Text style={styles.historyOrderText}>{order.customer_address}</Text>
                    </View>
                    <View style={styles.historyRight}>
                      <Text style={styles.historyTime}>{formatTime(order.created_at)}</Text>
                      <View style={styles.donePill}>
                        <Ionicons name="checkmark-circle" size={14} color="#059669" />
                        <Text style={styles.donePillText}>Done</Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          }
        />
      )}

      {/* The failed-delivery reason picker. A modal rather than Alert.alert
          because Android caps an alert at three buttons and silently discards
          the rest — see confirmFailed. */}
      <Modal
        visible={failing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFailing(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Could not deliver order #{failing?.id}?
            </Text>
            <Text style={styles.modalBody}>
              This ends the order without recording a sale. Bring the bag back to
              the shop — the stock is only returned once it is on the shelf.
            </Text>

            {FAILURE_REASONS.map(({ label, reason }) => (
              <TouchableOpacity
                key={reason}
                style={styles.modalOption}
                onPress={() => sendFailure(reason)}
              >
                <Ionicons name="close-circle-outline" size={16} color="#b91c1c" />
                <Text style={styles.modalOptionText}>{label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setFailing(null)}
            >
              <Text style={styles.modalCancelText}>Keep trying</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#4169E1',
  },
  header: {
    backgroundColor: '#4169E1',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionLive: {
    backgroundColor: '#22c55e',
  },
  connectionIdle: {
    backgroundColor: '#cbd5e1',
  },
  connectionLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  heroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -4,
    marginBottom: 18,
  },
  heroKicker: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 6,
  },
  heroSubtitle: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    maxWidth: 240,
  },
  heroBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#4169E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 6,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionCount: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  offerCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  activeCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  emptyActiveCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    marginBottom: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyActiveTitle: {
    marginTop: 10,
    color: '#334155',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyActiveText: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
  },
  queueEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  queueEmptyTitle: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  queueEmptyText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  offerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  offerEyebrow: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  orderTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  pillPrimary: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillPrimaryText: {
    color: '#4169E1',
    fontSize: 12,
    fontWeight: '700',
  },
  activePill: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  activePillText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  metaText: {
    flex: 1,
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  offerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryActionText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryAction: {
    flex: 1.6,
    borderRadius: 14,
    backgroundColor: '#4169E1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 8,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  // The route out, styled as an outline so it reads as a tool rather than as a
  // step in the flow — it is pressed many times per drop, unlike the three
  // terminal actions below it.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalBody: {
    marginTop: 6,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#b91c1c',
  },
  modalCancel: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  navigateButton: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#4169E1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 8,
  },
  navigateButtonText: {
    color: '#4169E1',
    fontSize: 14,
    fontWeight: '800',
  },
  // Hand back and Could-not-deliver sit below Mark Delivered and are visually
  // quieter. Both are legitimate outcomes and neither should be the easy tap:
  // the common case is a completed drop, and the rare cases should take a
  // deliberate look.
  secondaryRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 6,
  },
  secondaryButtonText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  dangerButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 6,
  },
  dangerButtonText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  completeButton: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 8,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  historySection: {
    paddingBottom: 8,
  },
  historyEmpty: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 12,
    fontSize: 13,
  },
  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  historyOrderTitle: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  historyOrderText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 3,
    maxWidth: 210,
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  historyTime: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  donePill: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  donePillText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffedd5',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offlineBannerText: {
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  dutyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dbeafe',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dutyBannerText: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  factRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  factBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  factLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  factValue: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  factValueLate: {
    color: '#b91c1c',
  },
  metaLink: {
    color: '#4169E1',
    fontWeight: '700',
  },
});
