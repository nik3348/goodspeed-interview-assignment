import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ask' };

export default function ChatIndexPage() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-16">
      <div className="max-w-sm">
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight">
          Ask your documents
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          Every answer is drawn from what you have written, and says which
          passage it came from. Start a conversation to begin.
        </p>
      </div>
    </div>
  );
}
