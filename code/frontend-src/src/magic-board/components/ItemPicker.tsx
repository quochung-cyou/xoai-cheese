import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Atom,
  Box,
  Brain,
  HeartPulse,
  LayoutGrid,
  Layers,
  LineChart,
  Loader2,
  Network,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ANATOMY_QUICK, CATALOG, type CatalogCategoryId, type CatalogItem } from '../lib/catalog';
import type { CachedOutput } from '../lib/cache';

const ICONS = {
  Box,
  LineChart,
  Network,
  Brain,
  Atom,
  HeartPulse,
} as const;

type Tab = 'catalog' | CatalogCategoryId | 'previous';

function fmtWhen(iso?: string): string {
  if (!iso) return 'not spawned yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'not spawned yet';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'spawned just now';
  if (mins < 60) return `spawned ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `spawned ${hours}h ago`;
  return `spawned ${Math.round(hours / 24)}d ago`;
}

/**
 * Floating "add" button + item picker.
 *
 * Pick an item and it spawns straight onto the canvas with its default
 * settings — no form, no confirm. Everything in the catalog is a
 * template-backed artifact that carries its own controls once on the board, so
 * the picker only has to answer "which one".
 *
 * The "Previous" tab lists results the model already produced (the output
 * cache) so they can be dropped onto any board too.
 */
export default function ItemPicker({
  open,
  onClose,
  onSpawnItem,
  previous,
  previousBytes,
  onSpawnPrevious,
  onSpawnAllPrevious,
  onRemovePrevious,
  onClearPrevious,
}: {
  open: boolean;
  onClose: () => void;
  onSpawnItem: (item: CatalogItem) => Promise<void>;
  previous: CachedOutput[];
  /** Total size of the output cache, for the footer hint. */
  previousBytes: number;
  onSpawnPrevious: (entry: CachedOutput) => Promise<void>;
  onSpawnAllPrevious: () => void;
  onRemovePrevious: (id: string) => void;
  onClearPrevious: () => void;
}) {
  const [tab, setTab] = useState<Tab>('catalog');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh state each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  /** Items for the active tab, filtered by the search box. Searching spans the
   *  whole catalog regardless of tab, which is what a user expects. */
  const items = useMemo<CatalogItem[]>(() => {
    const pool =
      tab === 'catalog' || q
        ? CATALOG.flatMap((c) => c.items)
        : CATALOG.find((c) => c.id === tab)?.items ?? [];
    if (!q) return pool;
    return pool.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.hint.toLowerCase().includes(q) ||
        i.scenario.toLowerCase().includes(q),
    );
  }, [tab, q]);

  /** Group by category when we're showing the mixed list. */
  const groups = useMemo(() => {
    if (tab !== 'catalog' && !q) return null;
    return CATALOG.map((c) => ({
      category: c,
      items: items.filter((i) => c.items.includes(i)),
    })).filter((g) => g.items.length > 0);
  }, [tab, q, items]);

  const previousItems = useMemo(() => {
    if (!q) return previous;
    return previous.filter(
      (p) =>
        p.artifact.title.toLowerCase().includes(q) ||
        p.artifact.kind.toLowerCase().includes(q),
    );
  }, [previous, q]);

  if (!open) return null;

  /** Run a spawn, keeping the dialog open on failure so the message is read. */
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const spawnItem = (item: CatalogItem) => void run(() => onSpawnItem(item));

  /** Anatomy rows accept free text, so expose the query as a focus value. */
  const spawnFocus = (focus: string) =>
    void run(() =>
      onSpawnItem({
        id: `anatomy-focus:${focus || 'body'}`,
        label: focus || 'whole body',
        scenario: 'anatomy_3d',
        params: { focus, systems: [], isolate: true },
        hint: '',
      }),
    );

  const onCatalogTab = tab === 'catalog' || (tab !== 'previous' && !q);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[70vh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        style={{ animation: 'fade-up 160ms ease-out both' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <LayoutGrid size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">Add to board</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                // Enter spawns the top hit — the fastest possible path.
                if (tab === 'previous') {
                  if (previousItems[0]) void run(() => onSpawnPrevious(previousItems[0]!));
                } else if (items[0]) {
                  spawnItem(items[0]);
                }
              }
            }}
            placeholder="Search — sphere, heart, pendulum, equation…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Category rail */}
        <div className="mb-scroll flex gap-1 overflow-x-auto border-b border-border px-2.5 py-2">
          <TabChip active={onCatalogTab} onClick={() => { setTab('catalog'); setQuery(''); }}>
            All
          </TabChip>
          {CATALOG.map((c) => {
            const Icon = ICONS[c.icon];
            return (
              <TabChip
                key={c.id}
                active={tab === c.id && !q}
                onClick={() => {
                  setTab(c.id);
                  setQuery('');
                }}
              >
                <Icon size={11} />
                {c.label}
              </TabChip>
            );
          })}
          <TabChip
            active={tab === 'previous'}
            onClick={() => {
              setTab('previous');
              setQuery('');
            }}
          >
            <Package size={11} />
            Previous{previous.length ? ` (${previous.length})` : ''}
          </TabChip>
        </div>

        {/* Body */}
        <div className="mb-scroll min-h-0 flex-1 overflow-y-auto p-2.5">
          {error && (
            <p className="mb-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] leading-snug text-destructive">
              {error}
            </p>
          )}

          {tab === 'previous' ? (
            previousItems.length === 0 ? (
              <Empty
                icon={<Package size={16} />}
                text={
                  previous.length
                    ? 'No previous result matches that search.'
                    : 'Nothing yet. Analyze a sketch and the result shows up here, ready to drop onto any board.'
                }
              />
            ) : (
              <>
                <button
                  onClick={() => {
                    onSpawnAllPrevious();
                    onClose();
                  }}
                  disabled={busy}
                  className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  title="Drop every generated result onto this board"
                >
                  <Layers size={12} />
                  Spawn all ({previousItems.length})
                </button>
                {previousItems.map((p) => (
                  <div
                    key={p.id}
                    className="group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted"
                  >
                    <button
                      onClick={() => void run(() => onSpawnPrevious(p))}
                      disabled={busy}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left disabled:opacity-40"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Package size={12} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {p.artifact.title}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {p.artifact.kind === 'elements' ? 'diagram' : 'sim'} ·{' '}
                          {fmtWhen(p.spawnedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => onRemovePrevious(p.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      title="Remove from the list"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </>
            )
          ) : items.length === 0 ? (
            <Empty
              icon={<Search size={16} />}
              text={`Nothing matches “${query}”. Try sphere, knot, pendulum, matrix, heart…`}
            />
          ) : (
            <>
              {/* Free-text focus for the anatomy viewer, since it is the one
                  item whose param is an open-ended structure name. */}
              {tab === 'biology' && !q && (
                <div className="mb-2 rounded-lg border border-border bg-muted/40 p-2">
                  <p className="mb-1.5 px-0.5 text-[10px] font-medium text-muted-foreground">
                    Focus a structure (or pick a preset)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ANATOMY_QUICK.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => spawnFocus(s.focus)}
                        disabled={busy}
                        className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 px-0.5 text-[10px] leading-snug text-muted-foreground/80">
                    Or type any structure above and press Enter — e.g. “femur”, “aorta”, “retina”.
                  </p>
                </div>
              )}

              {(groups ?? [{ category: null, items }]).map((group) =>
                group.category ? (
                  <div key={group.category.id} className="mb-1">
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.category.label}
                    </p>
                    {group.items.map((i) => (
                      <ItemRow key={i.id} item={i} busy={busy} onPick={spawnItem} />
                    ))}
                  </div>
                ) : (
                  group.items.map((i) => (
                    <ItemRow key={i.id} item={i} busy={busy} onPick={spawnItem} />
                  ))
                ),
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          {tab === 'previous' && previous.length > 0 ? (
            <>
              <p className="text-[10px] text-muted-foreground">
                {previous.length} saved · {Math.round(previousBytes / 1024)} KB
              </p>
              <button
                onClick={onClearPrevious}
                className="ml-auto rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Delete every saved result"
              >
                Clear all
              </button>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Items spawn with default settings — adjust them inside the simulation.
            </p>
          )}
          {busy && <Loader2 size={12} className="ml-auto animate-spin text-primary" />}
        </div>
      </div>
    </div>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function ItemRow({
  item,
  busy,
  onPick,
}: {
  item: CatalogItem;
  busy: boolean;
  onPick: (item: CatalogItem) => void;
}) {
  return (
    <button
      onClick={() => onPick(item)}
      disabled={busy}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:opacity-40"
      title={`Spawn ${item.label}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Plus size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{item.hint}</span>
      </span>
    </button>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
