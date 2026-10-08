import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Atom,
  BookOpen,
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
  BookOpen,
  Network,
  Brain,
  Atom,
  HeartPulse,
} as const;

type Tab = 'catalog' | CatalogCategoryId | 'previous';

function fmtWhen(iso?: string): string {
  if (!iso) return 'chưa đặt lên bảng';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'chưa đặt lên bảng';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'vừa đặt lên bảng';
  if (mins < 60) return `đặt lên bảng ${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `đặt lên bảng ${hours} giờ trước`;
  return `đặt lên bảng ${Math.round(hours / 24)} ngày trước`;
}

/**
 * Nút "thêm" nổi + bộ chọn mục.
 *
 * Chọn một mục là nó được đặt thẳng lên bảng vẽ với cài đặt mặc định — không
 * có biểu mẫu, không cần xác nhận. Mọi thứ trong danh mục đều là artifact dựa
 * trên mẫu và tự mang theo các điều khiển của mình khi đã ở trên bảng, nên bộ
 * chọn chỉ cần trả lời câu hỏi "mục nào".
 *
 * Tab "Đã tạo" liệt kê những kết quả mà mô hình (model) đã tạo ra (bộ nhớ đệm
 * kết quả) để chúng cũng có thể được đặt lên bất kỳ bảng nào.
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
  /** Tổng dung lượng của bộ nhớ đệm kết quả, dùng cho gợi ý ở chân hộp thoại. */
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

  // Trạng thái mới mỗi lần mở.
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

  /** Các mục của tab đang mở, đã lọc theo ô tìm kiếm. Tìm kiếm quét toàn bộ
   *  danh mục bất kể tab nào, đúng như người dùng mong đợi. */
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

  /** Nhóm theo danh mục khi đang hiển thị danh sách trộn. */
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

  /** Chạy việc đặt lên bảng, giữ hộp thoại mở khi thất bại để người dùng đọc
   *  được thông báo. */
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

  /** Các dòng giải phẫu nhận văn bản tự do, nên đưa truy vấn ra làm giá trị
   *  focus. */
  const spawnFocus = (focus: string) =>
    void run(() =>
      onSpawnItem({
        id: `anatomy-focus:${focus || 'body'}`,
        label: focus || 'toàn thân',
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
        className="flex h-[78vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        style={{ animation: 'fade-up 160ms ease-out both' }}
      >
        {/* Tiêu đề */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <LayoutGrid size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">Thêm vào bảng</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Đóng"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tìm kiếm */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                // Enter đặt mục đầu tiên lên bảng — đường đi nhanh nhất có thể.
                if (tab === 'previous') {
                  if (previousItems[0]) void run(() => onSpawnPrevious(previousItems[0]!));
                } else if (items[0]) {
                  spawnItem(items[0]);
                }
              }
            }}
            placeholder="Tìm kiếm — hình cầu, trái tim, con lắc, phương trình…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Xóa"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Dải danh mục */}
        <div className="mb-scroll flex gap-1 overflow-x-auto border-b border-border px-2.5 py-2">
          <TabChip active={onCatalogTab} onClick={() => { setTab('catalog'); setQuery(''); }}>
            Tất cả
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
            Đã tạo{previous.length ? ` (${previous.length})` : ''}
          </TabChip>
        </div>

        {/* Nội dung */}
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
                    ? 'Không có kết quả trước đây nào khớp với tìm kiếm đó.'
                    : 'Chưa có gì. Hãy Phân tích một bản phác thảo, kết quả sẽ hiện ở đây và sẵn sàng để đặt lên bất kỳ bảng nào.'
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
                  title="Đặt mọi kết quả đã tạo lên bảng này"
                >
                  <Layers size={12} />
                  Đặt lên bảng tất cả ({previousItems.length})
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
                          {p.artifact.kind === 'elements' ? 'sơ đồ' : 'mô phỏng'} ·{' '}
                          {fmtWhen(p.spawnedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => onRemovePrevious(p.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      title="Xóa khỏi danh sách"
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
              text={`Không có kết quả nào khớp với “${query}”. Thử hình cầu, nút thắt, con lắc, ma trận, trái tim…`}
            />
          ) : (
            <>
              {/* Văn bản tự do cho phần focus của trình xem giải phẫu, vì đây
                  là mục duy nhất có tham số là tên cấu trúc mở. */}
              {tab === 'biology' && !q && (
                <div className="mb-2 rounded-lg border border-border bg-muted/40 p-2">
                  <p className="mb-1.5 px-0.5 text-[10px] font-medium text-muted-foreground">
                    Tập trung vào một cấu trúc (hoặc chọn mẫu có sẵn)
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
                    Hoặc gõ bất kỳ cấu trúc nào ở trên rồi nhấn Enter — ví dụ: “xương đùi” (femur), “động mạch chủ” (aorta), “võng mạc” (retina).
                  </p>
                </div>
              )}

              {(groups ?? [{ category: null, items }]).map((group) =>
                group.category ? (
                  <div key={group.category.id} className="mb-1">
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.category.label}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {group.items.map((i) => (
                        <ItemCard key={i.id} item={i} busy={busy} onPick={spawnItem} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div key="filtered-items" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.items.map((i) => (
                      <ItemCard key={i.id} item={i} busy={busy} onPick={spawnItem} />
                    ))}
                  </div>
                ),
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          {tab === 'previous' && previous.length > 0 ? (
            <>
              <p className="text-[10px] text-muted-foreground">
                {previous.length} đã lưu · {Math.round(previousBytes / 1024)} KB
              </p>
              <button
                onClick={onClearPrevious}
                className="ml-auto rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Xóa mọi kết quả đã lưu"
              >
                Xóa tất cả
              </button>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Các mục được đặt lên bảng với cài đặt mặc định — hãy điều chỉnh chúng bên trong mô phỏng.
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

function ItemCard({
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
      className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md disabled:translate-y-0 disabled:opacity-40"
      title={`Đặt ${item.label} lên bảng`}
    >
      <ItemPreview item={item} />
      <span className="flex items-start gap-2 p-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{item.label}</span>
          <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-muted-foreground">
            {item.hint}
          </span>
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Plus size={12} />
        </span>
      </span>
    </button>
  );
}

function ItemPreview({ item }: { item: CatalogItem }) {
  const category = CATALOG.find((entry) => entry.items.includes(item));
  const Icon = category ? ICONS[category.icon] : LayoutGrid;

  return (
    <span className="relative flex h-20 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/5 via-muted/70 to-primary/15">
      <span className="absolute -right-5 -top-6 h-20 w-20 rounded-full border border-primary/10" />
      <span className="absolute -bottom-8 -left-5 h-20 w-20 rounded-full bg-primary/5" />
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-card/80 text-primary shadow-sm backdrop-blur">
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <span className="absolute bottom-1.5 right-2 max-w-[75%] truncate rounded-full bg-card/80 px-1.5 py-0.5 font-mono text-[8px] text-muted-foreground backdrop-blur">
        {item.scenario.replaceAll('_', ' ')}
      </span>
    </span>
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
