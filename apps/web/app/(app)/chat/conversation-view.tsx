'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  chatStreamEventSchema,
  type Citation,
  type ConversationDetail,
  type ConversationMessage,
} from '@repo/contracts';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { browserApiClient } from '@/lib/api/browser';
import { ApiClientError } from '@/lib/api/client';
import { readServerSentEvents } from '@/lib/api/sse';

import { AnswerText } from './answer-text';
import { Citations } from './citations';

/** The answer as it arrives, before the server's own record of it exists. */
interface PendingAnswer {
  citations: Citation[];
  content: string;
}

export function ConversationView({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(conversation.messages);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAnswering = pending !== null;

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending?.content]);

  async function ask(text: string) {
    const asked = text.trim();

    if (asked === '' || isAnswering) {
      return;
    }

    setQuestion('');
    setError(null);
    setMessages((current) => [...current, optimisticQuestion(asked)]);
    setPending({ citations: [], content: '' });

    try {
      const response = await browserApiClient().stream(
        `/conversations/${conversation.id}/messages/stream`,
        { body: { question: asked } },
      );

      for await (const raw of readServerSentEvents<unknown>(response)) {
        const event = chatStreamEventSchema.safeParse(raw);

        if (!event.success) {
          continue;
        }

        if (event.data.type === 'citations') {
          // Sources arrive before the first token, so they are on screen while
          // the answer is still being written.
          const { citations } = event.data;
          setPending((current) =>
            current === null ? current : { ...current, citations },
          );
        } else if (event.data.type === 'delta') {
          const { text: delta } = event.data;
          setPending((current) =>
            current === null
              ? current
              : { ...current, content: current.content + delta },
          );
        } else if (event.data.type === 'done') {
          const { assistantMessage } = event.data;
          setMessages((current) => [...current, assistantMessage]);
          setPending(null);
          // Picks up the conversation's new title in the rail.
          router.refresh();
        } else {
          setError(event.data.message);
          setPending(null);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Could not reach the assistant.',
      );
      setPending(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. `isComposing` keeps an IME's
    // confirmation keystroke from sending a half-typed question.
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void ask(question);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-10 md:px-10">
          {messages.length === 0 && !isAnswering ? (
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              Ask something your documents can answer. If they cannot, the
              assistant will say so rather than guess.
            </p>
          ) : null}

          <div className="flex flex-col gap-8">
            {messages.map((message) => (
              <Turn key={message.id} message={message} />
            ))}

            {pending ? <PendingTurn answer={pending} /> : null}
          </div>

          {error ? (
            <p role="alert" className="mt-8 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-background"
      >
        <div className="mx-auto w-full max-w-2xl px-6 py-4 md:px-10">
          <Textarea
            rows={2}
            value={question}
            disabled={isAnswering}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What does the expenses policy say about hotels?"
            aria-label="Your question"
            className="resize-none"
          />

          <div className="mt-2 flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Enter to send, Shift + Enter for a new line.
            </p>
            <Button
              type="submit"
              size="lg"
              disabled={isAnswering || question.trim() === ''}
            >
              {isAnswering ? 'Answering…' : 'Ask'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Turn({ message }: { message: ConversationMessage }) {
  if (message.role === 'user') {
    return (
      <article className="border-l-2 border-foreground pl-4">
        <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>
      </article>
    );
  }

  return (
    <article>
      <AnswerText content={message.content} />
      <Citations citations={message.citations} />
      {message.usage ? (
        <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground">
          {message.model} · {message.usage.totalTokens} tokens
        </p>
      ) : null}
    </article>
  );
}

function PendingTurn({ answer }: { answer: PendingAnswer }) {
  return (
    <article aria-live="polite" aria-busy="true">
      {answer.content === '' ? (
        <p className="text-[0.9375rem] text-muted-foreground">
          {answer.citations.length === 0
            ? 'Searching your documents…'
            : `Reading ${answer.citations.length} ${
                answer.citations.length === 1 ? 'passage' : 'passages'
              }…`}
        </p>
      ) : (
        <AnswerText content={answer.content} />
      )}
      <Citations citations={answer.citations} />
    </article>
  );
}

function optimisticQuestion(content: string): ConversationMessage {
  return {
    // Replaced by the server's record when the route refreshes.
    id: `pending-${Date.now()}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    model: null,
    usage: null,
    citations: [],
  };
}
