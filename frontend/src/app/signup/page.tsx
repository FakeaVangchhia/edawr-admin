import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SignUpPage } from './SignUpPage';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Keep your orders with your number instead of one browser.',
  robots: { index: false, follow: false },
};

/** `useSearchParams` (for `?next=`) needs a Suspense boundary. */
export default function Page() {
  return (
    <Suspense fallback={<div className="container-page py-12" />}>
      <SignUpPage />
    </Suspense>
  );
}
