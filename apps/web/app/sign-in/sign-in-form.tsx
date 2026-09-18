'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { authErrorMessage } from '@/lib/auth/errors';
import {
  authButtonClassName,
  authFieldClassName,
  authFooterClassName,
  authLabelClassName,
} from '@/lib/auth/styles';
import { AuthLink } from '@/components/auth-link';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsLoading(false);

    if (signInError) {
      setError(authErrorMessage(signInError.message));
      return;
    }

    // The proxy records where the visitor was headed before it bounced them.
    router.push(safeNextPath(searchParams.get('next')));
    router.refresh();
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Ask questions of everything you have written down."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className={authLabelClassName}>
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={authFieldClassName}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className={authLabelClassName}>
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={authFieldClassName}
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          className={authButtonClassName}
          disabled={isLoading}
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className={authFooterClassName}>
          New here? <AuthLink href="/sign-up">Create an account</AuthLink>
        </p>
      </form>
    </AuthShell>
  );
}

/**
 * Only same-origin paths are honoured, so a crafted `?next=` cannot turn the
 * sign-in page into an open redirect.
 */
function safeNextPath(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}
