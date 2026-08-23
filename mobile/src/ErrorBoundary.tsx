import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * The only thing standing between a render error and a blank phone.
 *
 * React Native has no default fallback worth the name: an uncaught render throw
 * unmounts the whole tree, which in a release build is a crash to the home
 * screen with no message. `DeliveryScreen` is 1,364 lines and holds every order
 * card, the availability toggle, the maps and phone intents and two modals — so
 * "one unexpected null in one order" and "the rider's app dies mid-shift" were
 * the same event, and the rider's only recovery was to relaunch and hope.
 *
 * A class component because that is the only way: `componentDidCatch` and
 * `getDerivedStateFromError` have no hook equivalents, and are unlikely to get
 * one.
 *
 * **It offers Try again rather than only reporting.** Clearing the error state
 * re-renders the subtree, which recovers from a transient bad render — a stale
 * order shape from a poll that raced a status change, say — without the rider
 * losing their session. If it throws again they see this screen again, which is
 * the honest outcome.
 */

interface Props {
  children: React.ReactNode;
  /** Reports the crash. Injected so this file needs no import of the API layer. */
  onError?: (error: Error, componentStack: string) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Logged as well as reported: in development nobody is reading the Django
    // log while tapping around the app.
    console.error('eDawr rider app crashed', error);
    this.props.onError?.(error, info.componentStack ?? '');
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.text}>
            The app hit an error it could not recover from on its own. You are still
            signed in, and nothing about your deliveries has changed — the store has
            the same orders it had a moment ago.
          </Text>
          <Text style={styles.text}>
            Try again. If it keeps happening, tell the store and use the phone number
            on the order sheet.
          </Text>
          {/* The message, not the stack. A rider reading it out to a manager over
              the phone is the realistic support path, and a stack trace is
              unreadable that way. The full stack goes to the backend log. */}
          <Text style={styles.detail}>{error.message}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={styles.button}
            onPress={this.reset}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

/**
 * The build has no usable backend URL.
 *
 * Separate from the boundary above because it is not a crash — it is a build
 * that was assembled wrong, and it will fail identically every launch. See
 * `config.ts` for why this is a screen rather than a throw during import.
 */
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>This build is misconfigured</Text>
        <Text style={styles.text}>
          The app does not know which server to talk to, so nothing it does would
          work. This is not something signing in again will fix — the build itself
          needs replacing.
        </Text>
        <Text style={styles.detail}>{message}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  detail: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  button: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: '#4169E1',
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
