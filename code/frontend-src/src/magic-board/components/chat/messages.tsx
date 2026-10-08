import { useState } from 'react';
import { Check, Copy, Package, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Artifact, ChatMessage } from '../../lib/types';
import { ChatMarkdown } from './markdown';
import { AiGlyph, Reasoning } from './trace';
import { fmtAt, KIND_LABELS } from './utils';

/** Clickable artifact reference pill shown under a message. */
function RefChip({
  artifact,
  onSelect,
}: {
  artifact: Artifact;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      title={`Reference: ${artifact.title} — click to select it on the canvas`}
    >
      <Package size={10} className="shrink-0" />
      <span className="truncate font-medium">
        {KIND_LABELS[artifact.kind]} · {artifact.title}
      </span>
      <span className="shrink-0 font-mono text-[9px] opacity-60">
        #{artifact.id.slice(0, 6)}
      </span>
    </button>
  );
}

/** Hover-revealed copy action for assistant replies. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Copy reply"
    >
      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}

/** One chat turn. User = right pill; assistant = unbubbled prose + glyph. */
export function MessageRow({
  m,
  artifact,
  onSelectArtifact,
}: {
  m: ChatMessage;
  artifact: Artifact | undefined;
  onSelectArtifact: (id: string) => void;
}) {
  const isUser = m.role === 'user';
  const removed = m.artifact_id && !artifact;
  return (
    <div
      className={cn('group flex gap-2', isUser && 'justify-end')}
      style={{ animation: 'fade-up 220ms ease-out both' }}
    >
      {!isUser && <AiGlyph />}
      <div
        className={cn(
          'min-w-0 max-w-[85%] text-sm leading-relaxed',
          isUser && 'flex flex-col items-end',
        )}
      >
        {artifact && (
          <div className="mb-1">
            <RefChip artifact={artifact} onSelect={() => onSelectArtifact(artifact.id)} />
          </div>
        )}
        {removed && (
          <div
            className="mb-1 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
            title="The referenced artifact is no longer on the canvas"
          >
            artifact #{m.artifact_id!.slice(0, 6)} removed
          </div>
        )}
        {isUser ? (
          <div
            className="w-fit rounded-2xl rounded-tr-md bg-foreground px-3.5 py-2 text-background"
            title={m.at ? fmtAt(m.at) : undefined}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ) : (
          <>
            {m.thinking && (
              <div className="mb-1.5">
                <Reasoning
                  active={false}
                  text={m.thinking}
                  doneSecs={
                    m.thinking_ms != null ? Math.round(m.thinking_ms / 1000) : undefined
                  }
                  defaultOpen={false}
                />
              </div>
            )}
            <ChatMarkdown text={m.content} />
            <div className="mt-1 flex items-center gap-1.5">
              <CopyButton text={m.content} />
              {m.at && (
                <span className="text-[10px] text-muted-foreground">{fmtAt(m.at)}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = ['Increase gravity', 'Add a pause button', 'Speed up the animation'];

/** Centered welcome shown before the first message. */
export function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="my-auto flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles size={18} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Refine this board</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Select a sim or diagram on the canvas, then describe the change in words.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
