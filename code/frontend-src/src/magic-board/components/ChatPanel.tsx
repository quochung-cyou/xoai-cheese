import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { ArrowDown } from 'lucide-react';

import { refineArtifactToCallback } from '../lib/refine';
import type { LLMConfig } from '../lib/settings';
import type { Artifact, ChatMessage, RefineEvent, RefineRun } from '../lib/types';
import { ChatComposer } from './chat/composer';
import { EmptyState, MessageRow } from './chat/messages';
import { applyEvent, newRun } from './chat/reducer';
import { AgentRun } from './chat/trace';

const FLUSH_MS = 50; // throttle: don't re-render per token

interface ChatPanelProps {
  getConfig: () => LLMConfig;
  modelLabel: string;
  /** Opens the model settings dialog. */
  onOpenSettings: () => void;
  artifacts: Artifact[];
  activeArtifactId: string | null;
  /** Only used by the fallback picker for detached artifacts — normal
   *  targeting comes from canvas selection. */
  onSelectArtifact: (id: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  /** done payload for the artifact — App updates state + canvas. */
  onArtifactPayload: (artifactId: string, payload: Artifact['payload']) => void;
  /** artifact ids whose canvas elements were manually deleted. */
  detachedIds: ReadonlySet<string>;
  activeArtifact: Artifact | null;
}

/**
 * Refine chat. Select a generated sim/diagram on the canvas, describe the
 * change, and watch the edit land live (thinking, narration, per-edit diffs).
 */
export default function ChatPanel({
  getConfig,
  modelLabel,
  onOpenSettings,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  messages,
  onMessagesChange,
  onArtifactPayload,
  detachedIds,
  activeArtifact,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Live run state in a ref — token deltas flush to React every FLUSH_MS
  // instead of once per token.
  const runRef = useRef<RefineRun | null>(null);
  const [, setTick] = useState(0);
  const flushTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Follow new content only while the user is pinned to the bottom. */
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scheduleFlush = () => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      setTick((t) => t + 1);
    }, FLUSH_MS);
  };

  // Auto-scroll on every flush — but only while pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight });
  });

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = at;
    setAtBottom(at);
  }, []);

  const handleJump = useCallback(() => {
    stickRef.current = true;
    setAtBottom(true);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  // Abort an in-flight run if the panel unmounts.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const artifact = artifacts.find((a) => a.id === activeArtifactId);
    const now = new Date().toISOString();

    if (!artifact) {
      const why = activeArtifactId
        ? `The selected element references artifact #${activeArtifactId.slice(
            0,
            6,
          )}, but it isn't in this board's artifacts — it was probably deleted or copied. Analyze the sketch again.`
        : 'No artifact selected — click a generated sim or diagram on the canvas, or analyze your sketch first.';
      onMessagesChange([
        ...messages,
        { role: 'user', content: text, at: now, artifact_id: activeArtifactId },
        { role: 'assistant', content: why, at: now },
      ]);
      setInput('');
      return;
    }

    const cfg = getConfig();
    if (!cfg.api_key.trim() || !cfg.model.trim()) {
      onMessagesChange([
        ...messages,
        { role: 'user', content: text, at: now, artifact_id: artifact.id },
        {
          role: 'assistant',
          content:
            'No model configured yet. Open Settings (the chip below) and fill in the endpoint, model and API key.',
          at: now,
        },
      ]);
      setInput('');
      onOpenSettings();
      return;
    }

    const withUser: ChatMessage[] = [
      ...messages,
      { role: 'user', content: text, at: now, artifact_id: artifact.id },
    ];
    onMessagesChange(withUser);
    setInput('');
    setBusy(true);
    runRef.current = newRun();
    setTick((t) => t + 1);

    const abort = new AbortController();
    abortRef.current = abort;

    const onEvent = (ev: RefineEvent) => {
      if (runRef.current) {
        applyEvent(runRef.current, ev);
        scheduleFlush();
      }
    };

    const outcome = await refineArtifactToCallback(
      cfg,
      artifact,
      text,
      onEvent,
      abort.signal,
    );
    abortRef.current = null;

    // Persist the run's reasoning so completed messages keep the
    // 'Thought for Ns' block after the live trace disappears.
    const runMeta = runRef.current;
    const traceMeta =
      runMeta && runMeta.thinking
        ? { thinking: runMeta.thinking, thinking_ms: runMeta.thinkingMs }
        : {};

    if (outcome.payload !== undefined) {
      onArtifactPayload(artifact.id, outcome.payload);
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: outcome.message ?? '',
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    } else if (outcome.message !== undefined) {
      // Done with no payload — the request isn't expressible on this
      // artifact; the reply lands in chat and the canvas stays untouched.
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: outcome.message,
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    } else {
      const detail = outcome.aborted
        ? 'Refinement stopped.'
        : `Refinement failed: ${outcome.error ?? 'the stream ended without a result'}`;
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: detail,
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    }
    runRef.current = null;
    setBusy(false);
    setTick((t) => t + 1);
  };

  const stop = () => abortRef.current?.abort();
  const run = runRef.current;

  const pickSuggestion = (s: string) => {
    setInput(s);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="mb-scroll h-full overflow-y-auto"
        >
          <div className="flex min-h-full flex-col space-y-6 px-4 py-5">
            {messages.length === 0 && !busy ? (
              <EmptyState onPick={pickSuggestion} />
            ) : (
              messages.map((m, i) => (
                <MessageRow
                  key={i}
                  m={m}
                  artifact={
                    m.artifact_id
                      ? artifacts.find((a) => a.id === m.artifact_id)
                      : undefined
                  }
                  onSelectArtifact={onSelectArtifact}
                />
              ))
            )}
            {run && <AgentRun run={run} />}
          </div>
        </div>
        {!atBottom && (
          <button
            onClick={handleJump}
            className="absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground"
            title="Jump to latest"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>
      <ChatComposer
        input={input}
        inputRef={inputRef}
        modelLabel={modelLabel}
        onOpenSettings={onOpenSettings}
        onInput={setInput}
        onSend={() => void send()}
        onStop={stop}
        busy={busy}
        activeArtifact={activeArtifact}
        detached={activeArtifact != null && detachedIds.has(activeArtifact.id)}
      />
    </div>
  );
}
