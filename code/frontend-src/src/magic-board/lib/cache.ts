/**
 * Bộ nhớ tạm (cache) kết quả phân tích — kết quả "vẽ → LLM trả ra" được giữ
 * lại để có thể tái tạo (spawn) lên bất kỳ bảng nào sau này.
 *
 * Mỗi lần phân tích thành công (và mỗi lần tinh chỉnh làm thay đổi payload)
 * đều được lưu với khóa là mã băm của các phần tử bản phác thảo đã sinh ra nó.
 * Vì hệ thống bảng chỉ hoạt động cục bộ, đây là ký ức bền vững duy nhất về
 * những gì mô hình đã tạo ra: xóa bảng vẽ, đổi bảng, tải lại — kết quả vẫn còn
 * ở đây và có thể tái tạo theo yêu cầu.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

import type { Artifact, Rect } from './types';

const CACHE_SLUG = 'magic-board';
const INDEX_KEY = `${CACHE_SLUG}.cache.index`;
const ENTRY_PREFIX = `${CACHE_SLUG}.cache.`;

export interface CachedOutput {
  id: string;
  /** Mã băm (hash) của bản phác thảo đã sinh ra kết quả này — cho phép vẽ lại
   *  cùng bản phác thảo thì dùng lại kết quả trong bộ nhớ tạm thay vì gọi mô
   *  hình lần nữa. */
  hash: string;
  artifact: Artifact;
  /** Khoảng bao (bounds) của bản phác thảo nguồn, để bước tái tạo đặt kết quả
   *  gần nó. */
  sourceBounds: Rect | null;
  /** Lần cuối mục này được tái tạo lên một bảng. */
  spawnedAt?: string;
}

interface CacheEntry {
  id: string;
  hash: string;
  artifact: Artifact;
  sourceBounds: Rect | null;
  spawnedAt?: string;
  created_at: string;
}

/** Mã băm nội dung ổn định của một kết quả — dùng làm khóa bộ nhớ tạm cho mọi
 *  thứ được chèn vào mà không đi qua bản phác thảo (mục trong danh mục, lần tái
 *  tạo lại), nên cùng một mục được tái tạo hai lần chỉ dùng lại một dòng cache
 *  thay vì chồng lên nhau. */
export function artifactContentHash(artifact: Artifact): string {
  const { scenario, params } = artifact.payload;
  const identifying =
    scenario !== undefined
      ? `s:${scenario}:${JSON.stringify(params ?? {}, Object.keys(params ?? {}).sort())}`
      : `h:${artifact.kind}:${artifact.title}:${artifact.payload.html ?? ''}:${
          artifact.payload.elements ? artifact.payload.elements.length : 0
        }`;
  return 'out:' + fnv(identifying);
}

// -------------------------------------------------------------------- băm

/** FNV-1a 64-bit, hiển thị dưới dạng 12 ký tự hex. */
function fnv(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** Mã băm nội dung ổn định của các phần tử đã sinh ra một kết quả:
 *  id:version:versionNonce cho từng phần tử, đã sắp xếp, rồi FNV-1a 64-bit.
 *  Cùng một hình vẽ (và bất kỳ tập con nào của nó) cho cùng mã băm trên mọi
 *  bảng. */
export function hashSketch(elements: readonly ExcalidrawElement[]): string {
  const parts = elements
    .filter((el) => !el.isDeleted)
    .map((el) => `${el.id}:${el.version}:${el.versionNonce}`)
    .sort();
  return fnv(parts.join('|'));
}

// ---------------------------------------------------------------- lưu trữ

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch (e) {
    console.error('Không thể ghi chỉ mục của bộ nhớ tạm kết quả', e);
  }
}

function readEntry(id: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(ENTRY_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.artifact?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Mới nhất trước. Chịu được các mục bị hỏng riêng lẻ. */
export function listCachedOutputs(): CachedOutput[] {
  return readIndex()
    .map(readEntry)
    .filter((e): e is CacheEntry => e !== null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((e) => ({
      id: e.id,
      hash: e.hash,
      artifact: e.artifact,
      sourceBounds: e.sourceBounds ?? null,
      spawnedAt: e.spawnedAt,
    }));
}

/** Lưu (hoặc làm mới) kết quả cho một mã băm bản phác thảo. Phân tích lại cùng
 *  một bản phác thảo sẽ cập nhật mục đang có thay vì chồng thêm bản trùng. */
export function putCachedOutput(
  hash: string,
  artifact: Artifact,
  sourceBounds: Rect | null = null,
): CachedOutput {
  const existing = listCachedOutputs().find((c) => c.hash === hash);
  const entry: CacheEntry = {
    id: existing?.id ?? newId(),
    hash,
    artifact,
    sourceBounds,
    spawnedAt: existing?.spawnedAt,
    created_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(ENTRY_PREFIX + entry.id, JSON.stringify(entry));
    if (!existing) writeIndex([entry.id, ...readIndex()]);
  } catch (e) {
    // Hết dung lượng là lỗi thực tế hay gặp — một mô phỏng mang theo cả tài liệu HTML của nó.
    console.error('Không thể lưu kết quả đã tạo vào bộ nhớ tạm', e);
  }
  return {
    id: entry.id,
    hash,
    artifact,
    sourceBounds,
    spawnedAt: entry.spawnedAt,
  };
}

/** Cập nhật payload của kết quả đã lưu cho một mục trong bộ nhớ tạm (bước tinh
 *  chỉnh đã hoàn tất). */export function updateCachedArtifact(
  id: string,
  payload: Artifact['payload'],
): void {
  const entry = readEntry(id);
  if (!entry) return;
  try {
    localStorage.setItem(
      ENTRY_PREFIX + id,
      JSON.stringify({ ...entry, artifact: { ...entry.artifact, payload } }),
    );
  } catch (e) {
    console.error('Không thể cập nhật kết quả trong bộ nhớ tạm', e);
  }
}

export function markCachedSpawned(id: string): void {
  const entry = readEntry(id);
  if (!entry) return;
  try {
    localStorage.setItem(
      ENTRY_PREFIX + id,
      JSON.stringify({ ...entry, spawnedAt: new Date().toISOString() }),
    );
  } catch {
    /* cố gắng hết sức — dấu thời gian chỉ để hiển thị */
  }
}

export function removeCachedOutput(id: string): void {
  try {
    localStorage.removeItem(ENTRY_PREFIX + id);
  } catch {
    /* bỏ qua */
  }
  writeIndex(readIndex().filter((x) => x !== id));
}

export function clearCachedOutputs(): void {
  for (const id of readIndex()) {
    try {
      localStorage.removeItem(ENTRY_PREFIX + id);
    } catch {
      /* bỏ qua */
    }
  }
  writeIndex([]);
}

/** Tổng số byte bộ nhớ tạm chiếm dụng — hiển thị ở chân trang của bảng điều khiển. */
export function cacheByteSize(): number {
  let total = 0;
  for (const id of readIndex()) {
    try {
      total += (localStorage.getItem(ENTRY_PREFIX + id) ?? '').length;
    } catch {
      /* bỏ qua */
    }
  }
  return total;
}
