/**
 * Placement for spawned cached outputs.
 *
 * Deliberately pure (no Excalidraw API): the same code positions artifacts
 * when the canvas is live AND when a batch is appended straight to a saved
 * board's scene JSON during a restore.
 */
import type { Rect } from './types';

const PAD = 28;
const STEP = 120;

/** Height a spawned artifact is clamped to. Mirrors the constants in
 *  boardTheme; kept local so this module stays dependency-free (and so it can
 *  be exercised directly by the scripts/ check harnesses). */
const FALLBACK_H = 420;
const MIN_H = 300;
const MAX_H = 600;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + PAD &&
    a.x + a.w > b.x - PAD &&
    a.y < b.y + b.h + PAD &&
    a.y + a.h > b.y - PAD
  );
}

/** Height of a spawned artifact, clamped the same way live placement does. */
function heightFor(source: Rect | null): number {
  return Math.min(Math.max(source?.h ?? FALLBACK_H, MIN_H), MAX_H);
}

/**
 * Find a free rect near `source` for an artifact of the given aspect ratio.
 *
 * When there is no source sketch to sit beside, `anchor` is used — callers
 * pass the top-left of whatever is already on the board, so a spawn always
 * lands next to content the user can see.
 */
export function findFreeRect(
  source: Rect | null,
  aspect: number,
  occupied: readonly Rect[],
  anchor: { x: number; y: number },
): Rect {
  const h = heightFor(source);
  const w = h * aspect;
  const base: Rect = source
    ? { x: source.x + source.w + 80, y: source.y, w, h }
    : { x: anchor.x, y: anchor.y, w, h };

  // Rows descending from the anchor, each widening sideways from centered.
  for (let row = 0; row < 12; row++) {
    const y = base.y + row * (base.h + 60);
    for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const r: Rect = { x: base.x + k * STEP, y, w, h };
      if (!occupied.some((o) => overlaps(r, o))) return r;
    }
  }

  // Dense board: stack below the deepest thing in this column.
  const column = occupied.filter(
    (o) => o.x < base.x + base.w && o.x + o.w > base.x,
  );
  const bottom = column.reduce((m, o) => Math.max(m, o.y + o.h), -Infinity);
  return {
    ...base,
    y: bottom === -Infinity ? base.y : Math.max(base.y, bottom + 60),
  };
}
