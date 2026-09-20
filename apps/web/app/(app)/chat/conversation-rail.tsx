'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { conversationSchema, type Conversation } from '@repo/contracts';

import { Button } from '@/components/ui/button';
import { browserApiClient } from '@/lib/api/browser';
import { cn } from '@/lib/utils';

export function ConversationRail({
  conversations,
}: {
  conversations: Conversation[];
}) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const [isCreating, setIsCreating] = useState(false);

  async function handleNew() {
    setIsCreating(true);

    try {
      const conversation = await browserApiClient().request('/conversations', {
        method: 'POST',
        body: {},
        schema: conversationSchema,
      });

      router.push(`/chat/${conversation.id}`);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <aside className="flex shrink-0 flex-col border-b border-border lg:h-svh lg:w-64 lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between gap-3 px-5 py-4 lg:px-6 lg:py-7">
        <h2 className="text-[0.8125rem] font-medium text-muted-foreground">
          Conversations
        </h2>
        <Button size="sm" disabled={isCreating} onClick={handleNew}>
          {isCreating ? 'Starting…' : 'New'}
        </Button>
      </div>

      {conversations.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground lg:px-6">
          No conversations yet.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 lg:px-3">
          {conversations.map((conversation) => {
            const isActive = params.id === conversation.id;

            return (
              <li key={conversation.id}>
                <Link
                  href={`/chat/${conversation.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'block truncate rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {conversation.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
