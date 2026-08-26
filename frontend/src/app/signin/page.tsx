import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SignInPage } from './SignInPage';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to see your orders on any device.',
  robots: { index: false, follow: false },
};

/** `useSearchParams` (for `?next=`) needs a Suspense boundary. */
export default function Page() {
  return (
    <Suspense fallback={<div className="container-page py-12" />}>
      <SignInPage />
    </Suspense>
  );
}
