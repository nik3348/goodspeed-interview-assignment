import type { Metadata } from 'next';

import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Bring your notes; ask them anything.',
};

export default function SignUpPage() {
  return <SignUpForm />;
}
