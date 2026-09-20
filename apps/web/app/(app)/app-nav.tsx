'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/documents', label: 'Documents' },
  { href: '/chat', label: 'Ask' },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 md:mt-9 md:flex-col md:gap-0.5">
      {LINKS.map((link) => {
        const isActive = pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // The active marker is the accent rule from the brand mark,
              // reused rather than invented: same language, smaller voice.
              'relative rounded-md px-2.5 py-1.5 text-[0.9375rem] transition-colors',
              isActive
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2.5 -bottom-0.5 block h-[2px] bg-accent md:inset-x-auto md:top-1.5 md:bottom-1.5 md:-left-0.5 md:h-auto md:w-[2px]"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
