import Link from 'next/link';

import { BrandMark } from '@/components/brand-mark';

import { AppNav } from './app-nav';
import { SignOutButton } from './sign-out-button';

/**
 * The signed-in frame: a narrow rail that stays put, and a working area that
 * scrolls. The rail is the only persistent chrome — everything else on screen
 * is the user's own text, which is the point of the product.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <header className="flex shrink-0 items-center gap-6 border-b border-border px-5 py-4 md:w-56 md:flex-col md:items-stretch md:gap-0 md:border-r md:border-b-0 md:px-6 md:py-7">
        <Link href="/documents" aria-label="Knowledge base" className="shrink-0">
          <BrandMark />
        </Link>

        <AppNav />

        <div className="ml-auto md:mt-auto md:ml-0 md:pt-8">
          <SignOutButton />
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
