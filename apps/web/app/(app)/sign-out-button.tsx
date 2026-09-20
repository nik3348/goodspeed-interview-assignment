'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await createClient().auth.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
