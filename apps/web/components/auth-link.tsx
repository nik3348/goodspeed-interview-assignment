import Link from 'next/link';

import { cn } from '@/lib/utils';

export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'text-foreground underline decoration-accent underline-offset-4 transition-[text-decoration-thickness] hover:decoration-2',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      {children}
    </Link>
  );
}
