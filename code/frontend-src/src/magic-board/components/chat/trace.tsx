import { useEffect, useState, type CSSProperties } from 'react';
import { Brain, ChevronDown, ChevronRight, FilePenLine, Loader2, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RefineEditCard, RefineRun } from '../../lib/types';
import { stageLabel } from './reducer';

/** Shimmer sweep for live status labels. */
const SHIMMER_TEXT: CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer-text 1.4s linear infinite',
};

/** Tiny agent glyph — marks assistant turns without a full avatar column. */
export function AiGlyph() {
  return (
    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center text-primary">
      <Sparkles size={13} />
    </span>
  );
}

/** Whole-seconds ticker for the thinking phase. */
function useThinkingSeconds(active: boolean, startedAt?: number): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active || startedAt == null) return;
    const tick = () => setSecs(Math.max(0, (performance.now() - startedAt) / 1000));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [active, startedAt]);
  return Math.floor(secs);
}

/** Pixel-grid loader for long-running work (ported from ai4edu's UI kit). */
const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

function PixelLoader({ label, round }: { label: string; round: boolean }) {
  return (
    <div className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {chevron.map((d, i) => (
          <span
            key={i}
            className={cn('size-[4px] bg-foreground', round ? 'rounded-full' : 'rounded-[1px]')}
            style={{
              opacity: 0.15,
              animation: `pixel-on 650ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={SHIMMER_TEXT}
      >
        {label}
      </span>
    </div>
  );
}

/** Collapsible thinking trace — expands while streaming, settles to a
 *  'Thought for Ns' row that stays expandable on completed messages. */
export function Reasoning({
  active,
  text,
  secs,
  doneSecs,
  defaultOpen = true,
}: {
  active: boolean;
  text: string;
  secs?: number;
  doneSecs?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <div>
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain size={12} />
        {active ? (
          <>
            <span className="bg-clip-text font-medium text-transparent" style={SHIMMER_TEXT}>
              Thinking
            </span>
            {secs != null && secs > 0 && (
              <span className="font-mono text-[10px] tabular-nums">{secs}s</span>
            )}
          </>
        ) : (
          <span className="font-medium">
            {doneSecs != null ? `Thought for ${doneSecs}s` : 'Thought process'}
          </span>
        )}
        <ChevronDown
          size={11}
          className={cn('transition-transform duration-300', !open && '-rotate-90')}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** Streams narration word-by-word — each new word resolves out of blur and a
 *  block caret trails the stream. */
function StreamingNarration({ text, caret }: { text: string; caret: boolean }) {
  const parts = text.split(/(\s+)/);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span key={i} style={{ animation: 'word-in 260ms ease-out both' }}>
            {w}
          </span>
        ),
      )}
      {caret && (
        <span
          className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-foreground"
          style={{ animation: 'fade-in 150ms ease-out both' }}
        />
      )}
    </p>
  );
}

/** One-line edit row; expands to the search/replace diff. */
function EditRow({ card }: { card: RefineEditCard }) {
  const [open, setOpen] = useState(false);
  const icon =
    card.status === 'applied' ? (
      <FilePenLine size={12} className="text-emerald-600" />
    ) : card.status === 'failed' ? (
      <FilePenLine size={12} className="text-red-500" />
    ) : (
      <Loader2 size={12} className="animate-spin text-primary" />
    );
  const label =
    card.status === 'locating'
      ? 'locating code…'
      : card.status === 'patching'
        ? `found at line ${card.line} — patching…`
        : card.status === 'applied'
          ? `applied${card.line ? ` at line ${card.line}` : ''}`
          : `failed: ${card.reason ?? 'no match'}`;
  const hasDiff = Boolean(card.search || card.replace);
  return (
    <div style={{ animation: 'fade-up 320ms ease-out both' }}>
      <button
        onClick={() => hasDiff && setOpen((o) => !o)}
        disabled={!hasDiff}
        className={cn(
          'flex w-full items-center gap-1.5 py-0.5 text-left text-xs',
          hasDiff
            ? 'text-muted-foreground transition-colors hover:text-foreground'
            : 'cursor-default text-muted-foreground',
        )}
      >
        {icon}
        <span className="truncate">
          <span className="font-medium text-foreground/80">Edit {card.index}</span>
          <span className="mx-1 text-border">·</span>
          {label}
        </span>
        {hasDiff &&
          (open ? (
            <ChevronDown size={11} className="ml-auto shrink-0" />
          ) : (
            <ChevronRight size={11} className="ml-auto shrink-0" />
          ))}
      </button>
      {open && hasDiff && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[10px] leading-snug">
          {(card.search ?? '').split('\n').map((l, i) => (
            <div key={`s${i}`} className="text-red-600 dark:text-red-400">
              - {l}
            </div>
          ))}
          {(card.replace ?? '').split('\n').map((l, i) => (
            <div key={`r${i}`} className="text-emerald-600 dark:text-emerald-400">
              + {l}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

/** Live refine run — a lean trace, not a card of cards. */
export function AgentRun({ run }: { run: RefineRun }) {
  const thinkingActive =
    run.stage === 'streaming' && !run.narration && run.edits.length === 0;
  const thinkingSecs = useThinkingSeconds(thinkingActive, run.thinkingStarted);
  const narrationLive =
    run.stage === 'streaming' && run.rewriteLines == null && run.edits.length === 0;
  return (
    <div className="flex gap-2">
      <AiGlyph />
      <div className="min-w-0 flex-1 space-y-1.5 pt-px text-sm">
        <PixelLoader label={stageLabel(run)} round={run.stage !== 'streaming'} />
        {run.thinking && (
          <Reasoning
            active={thinkingActive}
            text={run.thinking}
            secs={thinkingSecs}
            doneSecs={
              run.thinkingMs != null ? Math.round(run.thinkingMs / 1000) : undefined
            }
          />
        )}
        {run.narration && <StreamingNarration text={run.narration} caret={narrationLive} />}
        {run.edits.length > 0 && (
          <div className="relative space-y-0.5 border-l border-border pl-2.5">
            {run.edits.map((card) => (
              <EditRow key={card.index} card={card} />
            ))}
          </div>
        )}
        {run.rewriteLines != null && (
          <p className="text-xs text-muted-foreground">
            Full rewrite — {run.rewriteLines} lines written so far
          </p>
        )}
      </div>
    </div>
  );
}
