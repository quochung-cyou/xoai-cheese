/**
 * Analyze-result cache — "draw → LLM out" results kept so they can be
 * re-spawned onto any board later.
 *
 * Each successful analyze (and each refine that changes a payload) is stored
 * keyed by a hash of the sketch elements it came from. Because the board
 * system is local-only, this is the only durable memory of what the model
 * produced: clear the canvas, switch boards, reload — the outputs are still
 * here and can be re-spawned on demand.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

import type { Artifact, Rect } from './types';

const CACHE_SLUG = 'magic-board';
const INDEX_KEY = `${CACHE_SLUG}.cache.index`;
const ENTRY_PREFIX = `${CACHE_SLUG}.cache.`;

export interface CachedOutput {
  id: string;
  /** Hash of the sketch this came from — lets a redraw of the same sketch
   *  reuse the cached result instead of calling the model again. */
  hash: string;
  artifact: Artifact;
  /** Bounds of the source sketch, so a spawn can land near it. */
  sourceBounds: Rect | null;
  /** Last time this entry was spawned onto a board. */
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

/** Stable content hash of an artifact — used as the cache key for anything
 *  inserted without going through a sketch (catalog items, re-spawns), so the
 *  same item spawned twice reuses one cache row instead of stacking. */
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

// ---------------------------------------------------------------- hashing

/** 64-bit FNV-1a, rendered as 12 hex chars. */
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

/** Stable content hash of the elements an artifact was generated from:
 *  id:version:versionNonce per element, sorted, then a 64-bit FNV-1a. The
 *  same drawing (and any subset of it) hashes the same way on any board. */
export function hashSketch(elements: readonly ExcalidrawElement[]): string {
  const parts = elements
    .filter((el) => !el.isDeleted)
    .map((el) => `${el.id}:${el.version}:${el.versionNonce}`)
    .sort();
  return fnv(parts.join('|'));
}

// ---------------------------------------------------------------- storage

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
    console.error('Could not write the output cache index', e);
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

/** Newest first. Tolerates individual corrupt entries. */
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

/** Store (or refresh) the output for a sketch hash. A repeat analyze of the
 *  same sketch updates the existing entry instead of stacking duplicates. */
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
    // Quota is the realistic failure — a sim carries its whole HTML doc.
    console.error('Could not cache the generated output', e);
  }
  return {
    id: entry.id,
    hash,
    artifact,
    sourceBounds,
    spawnedAt: entry.spawnedAt,
  };
}

/** Update the stored artifact payload for a cached entry (refine landed). */export function updateCachedArtifact(
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
    console.error('Could not update the cached output', e);
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
    /* best effort — the timestamp is cosmetic */
  }
}

export function removeCachedOutput(id: string): void {
  try {
    localStorage.removeItem(ENTRY_PREFIX + id);
  } catch {
    /* ignoring */
  }
  writeIndex(readIndex().filter((x) => x !== id));
}

export function clearCachedOutputs(): void {
  for (const id of readIndex()) {
    try {
      localStorage.removeItem(ENTRY_PREFIX + id);
    } catch {
      /* ignoring */
    }
  }
  writeIndex([]);
}

/** Total bytes the cache occupies — surfaced in the panel footer. */
export function cacheByteSize(): number {
  let total = 0;
  for (const id of readIndex()) {
    try {
      total += (localStorage.getItem(ENTRY_PREFIX + id) ?? '').length;
    } catch {
      /* ignoring */
    }
  }
  return total;
}
