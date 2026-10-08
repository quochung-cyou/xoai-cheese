import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { BoardSummary } from '../lib/types';

function fmtRelative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Board switcher: every board lives in localStorage, so this is a plain
 * dropdown over the saved index. Rename/duplicate/delete are inline — no
 * dialogs, since there is nothing to confirm against a server.
 */
export default function BoardSwitcher({
  boards,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  boards: BoardSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = boards.find((b) => b.id === activeId);

  // Click-away / Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) onRename(id, name);
    setRenamingId(null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Switch board"
      >
        <span className="truncate">{active?.name ?? 'Board'}</span>
        <ChevronDown
          size={13}
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-8 z-40 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
          style={{ animation: 'fade-up 140ms ease-out both' }}
        >
          <div className="mb-scroll max-h-72 overflow-y-auto p-1.5">
            {boards.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'group flex items-center gap-1 rounded-lg px-1.5 py-1.5',
                  b.id === activeId ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                {renamingId === b.id ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(b.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="h-6 min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring"
                    />
                    <button
                      onClick={() => commitRename(b.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10"
                      title="Save name"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (b.id !== activeId) onSelect(b.id);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left"
                      title={`Open "${b.name}"`}
                    >
                      <span
                        className={cn(
                          'block truncate text-xs',
                          b.id === activeId ? 'font-semibold text-primary' : 'font-medium',
                        )}
                      >
                        {b.name}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {fmtRelative(b.updated_at)}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={() => {
                          setRenamingId(b.id);
                          setDraft(b.name);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onDuplicate(b.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Duplicate"
                      >
                        <Copy size={11} />
                      </button>
                      {confirmDeleteId === b.id ? (
                        <button
                          onClick={() => {
                            onDelete(b.id);
                            setConfirmDeleteId(null);
                          }}
                          className="flex h-6 items-center justify-center rounded bg-destructive px-1.5 text-[10px] font-semibold text-white"
                          title="Click again to confirm delete"
                        >
                          sure?
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(b.id)}
                          disabled={boards.length <= 1}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent"
                          title={
                            boards.length <= 1
                              ? 'The last board cannot be deleted'
                              : 'Delete board'
                          }
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
            className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
          >
            <Plus size={13} />
            New board
          </button>
        </div>
      )}
    </div>
  );
}
