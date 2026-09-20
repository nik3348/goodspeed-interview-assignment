import { conversationListSchema } from '@repo/contracts';

import { ApiClientError } from '@/lib/api/client';
import { serverApiClient } from '@/lib/api/server';

import { ConversationRail } from './conversation-rail';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const api = await serverApiClient();

  let conversations;

  try {
    conversations = await api.request('/conversations', {
      schema: conversationListSchema,
    });
  } catch (cause) {
    // The rail is navigation, not content: if it cannot load, the chat pane is
    // still usable and saying so there is more helpful than failing the route.
    if (!(cause instanceof ApiClientError)) {
      throw cause;
    }
  }

  return (
    <div className="flex h-svh flex-col lg:flex-row">
      <ConversationRail conversations={conversations?.conversations ?? []} />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
