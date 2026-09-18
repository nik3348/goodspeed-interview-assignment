import { Suspense } from 'react';
import type { Metadata } from 'next';

import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Ask questions of everything you have written down.',
};

export default function SignInPage() {
  // `SignInForm` reads the `next` search param, so it needs a boundary.
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
