'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { conversationSchema, type Conversation } from '@repo/contracts';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { browserApiClient } from '@/lib/api/browser';
import { ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export function ConversationRail({
  conversations,
}: {
  conversations: Conversation[];
}) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function handleDelete(conversation: Conversation) {
    if (
      !window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)
    ) {
      return;
    }

    setError(null);
    setDeletingId(conversation.id);

    try {
      await browserApiClient().request(`/conversations/${conversation.id}`, {
        method: 'DELETE',
      });

      // Staying on a deleted conversation would 404 on the next refresh.
      if (params.id === conversation.id) {
        router.push('/chat');
      }

      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Could not delete that conversation.',
      );
    } finally {
      setDeletingId(null);
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

      {error ? (
        <p role="alert" className="px-5 pb-3 text-sm text-destructive lg:px-6">
          {error}
        </p>
      ) : null}

      {conversations.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground lg:px-6">
          No conversations yet.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 lg:px-3">
          {conversations.map((conversation) => {
            const isActive = params.id === conversation.id;

            return (
              <li
                key={conversation.id}
                className={cn(
                  'group flex items-center rounded-md transition-colors',
                  isActive && 'bg-secondary',
                )}
              >
                <Link
                  href={`/chat/${conversation.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'min-w-0 flex-1 truncate px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {conversation.title}
                </Link>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete “${conversation.title}”`}
                  disabled={deletingId === conversation.id}
                  onClick={() => handleDelete(conversation)}
                  className="mr-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
