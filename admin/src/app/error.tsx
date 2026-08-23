'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { reportConsoleError } from '@/lib/report-error';

/**
 * The route error boundary the console did not have.
 *
 * Without this file a render throw on any screen fell through to Next's own
 * page — in production, the bare sentence "Application error: a client-side
 * exception has occurred", with no styling, no way back, and nothing recorded
 * anywhere. On the application that holds write access to the whole catalogue,
 * every order and every staff account, that is the wrong place to economise.
 *
 * It is deliberately reassuring about data. The console writes through the API
 * and holds no unsaved state of its own beyond an open drawer, so a crash here
 * has not lost anybody's work — and a manager mid-rush needs to know that
 * before they know anything else.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportConsoleError({
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-ink">This screen didn&apos;t load</h1>
        <p className="mt-2 text-sm text-ink-faint">
          Something went wrong rendering it. Nothing you have saved is affected — the
          console writes straight to the API and keeps nothing of its own.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
