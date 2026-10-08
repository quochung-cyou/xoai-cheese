import { useEffect, useState, type CSSProperties } from 'react';
import { Brain, ChevronDown, ChevronRight, FilePenLine, Loader2, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RefineEditCard, RefineRun } from '../../lib/types';
import { stageLabel } from './reducer';

/** Vệt sáng lấp lánh (shimmer) cho nhãn trạng thái đang chạy. */
const SHIMMER_TEXT: CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer-text 1.4s linear infinite',
};

/** Glyph tác nhân nhỏ — đánh dấu lượt của trợ lý mà không cần cả cột ảnh đại diện. */
export function AiGlyph() {
  return (
    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center text-primary">
      <Sparkles size={13} />
    </span>
  );
}

/** Đồng hồ đếm giây nguyên cho giai đoạn suy nghĩ. */
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

/** Bộ tải dạng lưới điểm ảnh cho tác vụ chạy lâu (chuyển từ bộ UI của ai4edu). */
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

/** Dấu vết suy nghĩ có thể thu gọn — mở ra trong lúc truyền phát, rồi thu lại thành
 *  dòng 'Đã suy nghĩ Ns' vẫn mở rộng được ở tin nhắn đã hoàn tất. */
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
              Đang suy nghĩ
            </span>
            {secs != null && secs > 0 && (
              <span className="font-mono text-[10px] tabular-nums">{secs}s</span>
            )}
          </>
        ) : (
          <span className="font-medium">
            {doneSecs != null ? `Đã suy nghĩ ${doneSecs}s` : 'Quá trình suy nghĩ'}
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

/** Truyền phát lời dẫn từng từ một — mỗi từ mới hiện ra từ vết mờ và một
 *  con trỏ dạng khối bám theo dòng chảy. */
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

/** Một dòng chỉnh sửa; mở rộng ra thành diff tìm/thay thế. */
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
      ? 'đang định vị mã…'
      : card.status === 'patching'
        ? `thấy ở dòng ${card.line} — đang vá…`
        : card.status === 'applied'
          ? `đã áp dụng${card.line ? ` ở dòng ${card.line}` : ''}`
          : `thất bại: ${card.reason ?? 'không khớp'}`;
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
          <span className="font-medium text-foreground/80">Sửa {card.index}</span>
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

/** Lần tinh chỉnh trực tiếp — một dấu vết gọn gàng, không phải thẻ lồng trong thẻ. */
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
            Viết lại toàn bộ — đã ghi {run.rewriteLines} dòng
          </p>
        )}
      </div>
    </div>
  );
}
