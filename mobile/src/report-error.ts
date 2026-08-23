import { API_URL, configError } from './config';

/**
 * Tell the backend the rider app crashed.
 *
 * There was no crash reporting of any kind — no Sentry, no Crashlytics, nothing
 * — and no `expo-updates` channel either, so a crash on a rider's phone was
 * both invisible and unfixable without a store submission. This does not solve
 * the second problem, but it means the store finds out about the first from a
 * log rather than from a rider standing at the counter saying the app closed.
 *
 * Deliberately not routed through `src/api.ts`. That module has a timeout, an
 * error taxonomy and an abort controller, all of which are the wrong shape for
 * a fire-and-forget report sent from inside a crash — and it reads `apiUrl()`,
 * which throws when the build is the misconfigured one this might be reporting.
 *
 * It cannot throw and it sends no credentials: the endpoint is public, and
 * attaching a rider's bearer token to a best-effort request that ends up in a
 * log is a way to leak one.
 */
export function reportRiderCrash(error: Error, componentStack: string): void {
  // Nowhere to send it. A build with no API URL is exactly the case that cannot
  // report itself, which is why `ConfigErrorScreen` states the problem on the
  // phone instead.
  if (configError !== null || !API_URL) return;

  try {
    void fetch(`${API_URL}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'rider',
        message: error.message,
        // The component stack rather than the JS stack: in a release bundle the
        // latter is minified to nothing useful, while the component stack still
        // names the screen. The server caps and truncates it either way.
        stack: componentStack || error.stack || '',
      }),
    }).catch(() => {
      // The rider is very likely offline. That is an ordinary condition here
      // and never worth surfacing on top of a crash screen.
    });
  } catch {
    // A malformed URL throws synchronously, and that is one of the things this
    // exists to report — so it must not become a second crash.
  }
}
