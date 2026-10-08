import type { KeyboardEvent, RefObject } from 'react';
import { ArrowUp, Settings2, Square } from 'lucide-react';

import type { Artifact } from '../../lib/types';
import { KIND_LABELS } from './utils';

/** Khung soạn tin nổi (composer): chip ngữ cảnh + vùng nhập tự giãn + nút gửi tròn. */
export function ChatComposer({
  input,
  inputRef,
  onInput,
  onSend,
  onStop,
  busy,
  activeArtifact,
  detached,
  modelLabel,
  onOpenSettings,
}: {
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  activeArtifact: Artifact | null;
  detached: boolean;
  modelLabel: string;
  onOpenSettings: () => void;
}) {
  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="p-3 pt-1">
      <div className="rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
        {activeArtifact && (
          <div className="flex items-center gap-1.5 px-3 pt-2">
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              <span className="truncate font-medium">
                {KIND_LABELS[activeArtifact.kind]} · {activeArtifact.title}
              </span>
              <span className="shrink-0 font-mono text-[9px] text-primary/60">
                #{activeArtifact.id.slice(0, 6)}
              </span>
            </span>
            {detached && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">
                ngoài bảng vẽ
              </span>
            )}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            activeArtifact
              ? 'Mô tả thay đổi…'
              : 'Chọn một mô phỏng hoặc sơ đồ trên bảng vẽ để tinh chỉnh…'
          }
          rows={1}
          className="field-sizing-content max-h-40 min-h-9 w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Chip mô hình (model) — mở hộp thoại cài đặt. */}
          <button
            onClick={onOpenSettings}
            className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={`Cài đặt mô hình (model) — ${modelLabel}`}
          >
            <Settings2 size={14} />
            <span className="max-w-36 truncate font-mono text-[10px]">{modelLabel}</span>
          </button>
          <div className="ml-auto">
            {busy ? (
              <button
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85"
                title="Dừng tinh chỉnh"
              >
                <Square size={12} className="fill-current" />
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85 disabled:opacity-30"
                title="Gửi"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
