import { BrandMark } from '@/components/brand-mark';

/**
 * Every auth screen is the same column: mark, what the screen is, what it gets
 * you, then the form. No product illustration above the fold — a person at a
 * sign-in box is trying to get in, not to be sold to.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-[24rem]">
        <BrandMark />

        <div className="mt-8 flex flex-col gap-2">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>

        <div className="mt-9">{children}</div>
      </div>
    </main>
  );
}
