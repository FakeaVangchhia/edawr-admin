import Link from 'next/link';

/**
 * A console URL that does not exist.
 *
 * Reachable by a stale bookmark, a link in an old handover document, or a typo
 * — and without this file all three produced Next's default 404, which is
 * unstyled, says "This page could not be found", and offers no way back into
 * the console. Short, because there is nothing to diagnose: the page is not
 * there.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-ink-faint">404</p>
        <h1 className="mt-2 text-lg font-semibold text-ink">No such screen</h1>
        <p className="mt-2 text-sm text-ink-faint">
          That address is not part of the console. It may have been renamed since
          whatever sent you here was written.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
