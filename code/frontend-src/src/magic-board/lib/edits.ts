/**
 * Search/replace edit application for model refine output.
 *
 * Direct port of the ai4edu backend's `app/edits.py` (aider `diff` /
 * Claude Code FileEdit semantics) so the refine contract behaves exactly as
 * it did server-side:
 *  - exact string match first; each search must occur exactly once
 *  - fallback: match a line-subsequence ignoring trailing whitespace
 *  - atomic: every edit applies to an in-memory copy, and any failure raises
 *    naming the offending edit — nothing is returned half-applied
 *
 * Plus id-based ops for `elements` artifacts: models are far more reliable
 * emitting {op,id,patch} than diffs over a JSON array.
 */
import type { SkeletonElement } from './types';

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

/** Start indices of `needle` in `doc` matched line-wise, ignoring trailing
 *  whitespace on every line. */
function lineMatches(doc: string, needle: string): number[] {
  const needleLines = needle.split('\n').map((ln) => ln.replace(/\s+$/, ''));
  if (!needleLines.length || (needleLines.length === 1 && needleLines[0] === '')) {
    return [];
  }
  // Keep the newlines so offsets line up with the original string.
  const docLines = doc.split('\n');
  const stripped = docLines.map((ln) => ln.replace(/\s+$/, ''));
  const offsets: number[] = [0];
  for (let i = 0; i < docLines.length - 1; i++) {
    offsets.push(offsets[i]! + docLines[i]!.length + 1);
  }
  const hits: number[] = [];
  const n = needleLines.length;
  for (let i = 0; i + n <= stripped.length; i++) {
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (stripped[i + k] !== needleLines[k]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(offsets[i]!);
  }
  return hits;
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** 1-based line where `needle` would apply in `doc`, or null when it doesn't
 *  match (exactly-once — exact match first, then the line-normalized
 *  fallback). Used to report "located at line N" while the replacement is
 *  still streaming in. */
export function findMatchLine(doc: string, needle: string): number | null {
  if (!needle) return null;
  if (occurrences(doc, needle) === 1) {
    return doc.slice(0, doc.indexOf(needle)).split('\n').length;
  }
  const hits = lineMatches(doc, needle);
  if (hits.length === 1) {
    return doc.slice(0, hits[0]!).split('\n').length;
  }
  return null;
}

export interface Edit {
  search: string;
  replace: string;
}

/** Apply [{search, replace}] blocks to `doc`. Atomic — throws EditError
 *  (naming the failing search excerpt) if any edit matches 0 or >1 times. */
export function applyEdits(doc: string, edits: Edit[]): string {
  let result = doc;
  edits.forEach((edit, i) => {
    const search = edit.search;
    const replace = edit.replace ?? '';
    if (typeof search !== 'string' || !search) {
      throw new EditError(`edit ${i}: missing/empty 'search' text`);
    }
    const firstLine = search.split('\n')[0] ?? '';
    const excerpt = firstLine.slice(0, 80) + (search.includes('\n') ? '…' : '');

    const count = occurrences(result, search);
    if (count === 1) {
      result = result.replace(search, replace);
      return;
    }

    const hits = count === 0 ? lineMatches(result, search) : [];
    if (hits.length === 1) {
      // Line-normalized match: splice by line boundaries — the matched span
      // is the n doc lines starting at the hit offset, which absorbs
      // trailing-whitespace differences between search and doc.
      const start = hits[0]!;
      const n = search.split('\n').length;
      const before = result.slice(0, start);
      const lineIdx = before.split('\n').length - 1;
      const docLines = result.split('\n');
      let end = start;
      for (let k = 0; k < n; k++) {
        const ln = docLines[lineIdx + k] ?? '';
        end += ln.length;
        if (k < n - 1) end += 1; // the newline that was split away
      }
      result = before + replace + result.slice(end);
      return;
    }

    const why =
      count === 0 && !hits.length
        ? 'not found'
        : `ambiguous (matched ${Math.max(count, hits.length)} times)`;
    throw new EditError(`edit ${i} ${why}: search text starting '${excerpt}'`);
  });
  return result;
}

// ---------- Skeleton-element ops (`elements` artifact kind) ----------

export type ElementOp =
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'add'; elements: SkeletonElement[] }
  | { op: 'remove'; ids: string[] };

/** Apply [{op: update|add|remove}] to a skeleton element list. Atomic —
 *  throws EditError naming the failing op; the input list is never mutated. */
export function applyElementOps(
  elements: SkeletonElement[],
  ops: unknown[],
): SkeletonElement[] {
  let result: SkeletonElement[] = elements.map((el) => ({ ...el }));

  const indexOf = (elId: unknown) =>
    result.findIndex((el) => el.id === elId);

  ops.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new EditError(`op ${i}: not an object`);
    }
    const op = raw as Record<string, unknown>;
    const kind = op.op;

    if (kind === 'update') {
      const patch = op.patch;
      if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
        throw new EditError(`op ${i}: update requires a non-empty 'patch'`);
      }
      const idx = indexOf(op.id);
      if (idx < 0) throw new EditError(`op ${i}: no element with id ${String(op.id)}`);
      // ids are identity — never rewritable.
      const { id: _drop, ...fields } = patch as Record<string, unknown>;
      result[idx] = { ...result[idx]!, ...fields };
      return;
    }

    if (kind === 'add') {
      const newEls = op.elements;
      if (!Array.isArray(newEls) || !newEls.length) {
        throw new EditError(`op ${i}: add requires a non-empty 'elements'`);
      }
      const existing = new Set(result.map((el) => el.id));
      for (const el of newEls) {
        if (!el || typeof el !== 'object' || !(el as SkeletonElement).id) {
          throw new EditError(`op ${i}: added element missing required 'id'`);
        }
        const id = (el as SkeletonElement).id!;
        if (existing.has(id)) {
          throw new EditError(`op ${i}: added element id '${id}' already exists`);
        }
        existing.add(id);
      }
      result = result.concat(newEls as SkeletonElement[]);
      return;
    }

    if (kind === 'remove') {
      const ids = op.ids;
      if (!Array.isArray(ids) || !ids.length) {
        throw new EditError(`op ${i}: remove requires a non-empty 'ids'`);
      }
      for (const elId of ids) {
        if (indexOf(elId) < 0) {
          throw new EditError(`op ${i}: no element with id ${String(elId)}`);
        }
      }
      const drop = new Set(ids);
      result = result.filter((el) => !drop.has(el.id));
      return;
    }

    throw new EditError(`op ${i}: unknown op ${JSON.stringify(kind)}`);
  });

  return result;
}
