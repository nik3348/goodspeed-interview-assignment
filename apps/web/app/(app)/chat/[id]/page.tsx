import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  conversationDetailSchema,
  type ConversationDetail,
} from '@repo/contracts';

import { ApiClientError } from '@/lib/api/client';
import { serverApiClient } from '@/lib/api/server';

import { ConversationView } from '../conversation-view';

export const metadata: Metadata = { title: 'Ask' };

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conversation = await load(id);

  // Keyed by id so switching conversations remounts with fresh state rather
  // than syncing props into state in an effect.
  return <ConversationView key={conversation.id} conversation={conversation} />;
}

async function load(id: string): Promise<ConversationDetail> {
  const api = await serverApiClient();

  try {
    return await api.request(`/conversations/${id}`, {
      schema: conversationDetailSchema,
    });
  } catch (cause) {
    // Someone else's conversation is invisible rather than forbidden, so a
    // 404 is what comes back and what the page should show.
    if (cause instanceof ApiClientError && cause.statusCode === 404) {
      notFound();
    }

    throw cause;
  }
}
