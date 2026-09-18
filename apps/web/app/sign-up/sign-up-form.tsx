'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { authErrorMessage } from '@/lib/auth/errors';
import {
  authButtonClassName,
  authFieldClassName,
  authFooterClassName,
  authHintClassName,
  authLabelClassName,
} from '@/lib/auth/styles';
import { AuthLink } from '@/components/auth-link';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Pick a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }

    setIsLoading(true);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });

    setIsLoading(false);

    if (signUpError) {
      setError(authErrorMessage(signUpError.message));
      return;
    }

    // With email confirmation switched off, Supabase signs the new account in
    // straight away. Otherwise there is no session yet and the link does it.
    if (data.session) {
      router.push('/');
      router.refresh();
      return;
    }

    // Supabase returns this same shape for an address that already has an
    // account, so the message stays identical either way and never confirms
    // to a stranger who is already a user.
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            We sent a confirmation link to{' '}
            <span className="font-mono text-foreground">{sentTo}</span>.
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            Open it and your account is ready. If it has not arrived in a few
            minutes, check the spam folder before trying again.
          </p>

          <p className={authFooterClassName}>
            Already confirmed? <AuthLink href="/sign-in">Sign in</AuthLink>
          </p>
        </div>
      </AuthShell>
    );
  }

  const passwordsMismatch =
    confirmation.length > 0 && password !== confirmation;

  return (
    <AuthShell
      title="Create an account"
      subtitle="Bring your notes; ask them anything."
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
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="password-hint"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={authFieldClassName}
            />
            <p id="password-hint" className={authHintClassName}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmation" className={authLabelClassName}>
              Confirm password
            </Label>
            <Input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={passwordsMismatch}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
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
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>

        <p className={authFooterClassName}>
          Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
        </p>
      </form>
    </AuthShell>
  );
}
