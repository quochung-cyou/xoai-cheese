/**
 * Incremental scanner for the refine stream contract — port of the ai4edu
 * backend's `app/edits_stream.py`.
 *
 * The model emits plain text: narration interleaved with marker blocks
 * (<<<<<<< SEARCH / ======= / >>>>>>> REPLACE, or <<<<<<< REWRITE /
 * >>>>>>> END). This scanner turns the token stream into per-block lifecycle
 * events as each marker line arrives.
 *
 * It is a line-oriented state machine, NOT a brace counter: a search block is
 * known-complete only when its marker line arrives.
 */

const SEARCH = '<<<<<<< SEARCH';
const REPLACE = '>>>>>>> REPLACE';
const SPLIT = '=======';
const REWRITE = '<<<<<<< REWRITE';
const END = '>>>>>>> END';

export type ScanEvent =
  | { type: 'narration'; delta: string }
  | { type: 'edit-start'; index: number }
  | { type: 'edit-search'; index: number; search: string }
  | { type: 'edit-end'; index: number; search: string; replace: string }
  | { type: 'rewrite-start' }
  | { type: 'rewrite-progress'; lines: number }
  | { type: 'rewrite-end'; code: string };

type State = 'text' | 'search' | 'replace' | 'rewrite';

const isMarker = (line: string): boolean => {
  const s = line.trim();
  return (
    s === SEARCH || s === REPLACE || s === SPLIT || s === REWRITE || s === END ||
    s.startsWith('```')
  );
};

export class EditStreamScanner {
  private state: State = 'text';
  private buf = '';
  private blockLines: string[] = [];
  private searchText = '';
  private index = 0;
  private rewriteLines = 0;

  /** Consume an output delta; return scan events completed so far. */
  feed(text: string): ScanEvent[] {
    this.buf += text;
    const events: ScanEvent[] = [];

    // Process only lines that are definitely complete. The still-open tail
    // is held back until its newline arrives: emitting it early would either
    // leak a marker prefix (`<`, ```) into the narration or, if the finished
    // line then turned out to be a marker, duplicate prose the caller
    // already received. Model output is heavily line-broken, so narration
    // still streams at a natural pace.
    const parts = this.buf.split('\n');
    const tail = parts.pop() ?? '';
    for (const line of parts) events.push(...this.line(line));
    this.buf = tail;
    return events;
  }

  /** End of stream: emit any leftover text as narration. Incomplete blocks
   *  are NOT emitted — the caller treats a run with no closed blocks as a
   *  malformed response. */
  flush(): ScanEvent[] {
    const events: ScanEvent[] = [];
    if (this.state === 'text' && this.buf.trim()) {
      events.push({ type: 'narration', delta: this.buf });
    }
    this.buf = '';
    return events;
  }

  private line(line: string): ScanEvent[] {
    const s = line.trim();

    if (this.state === 'text') {
      if (s === SEARCH) {
        this.state = 'search';
        this.blockLines = [];
        this.index += 1;
        return [{ type: 'edit-start', index: this.index }];
      }
      if (s === REWRITE) {
        this.state = 'rewrite';
        this.blockLines = [];
        this.rewriteLines = 0;
        return [{ type: 'rewrite-start' }];
      }
      if (isMarker(line)) return []; // stray marker / code fence — drop
      return [{ type: 'narration', delta: line + '\n' }];
    }

    if (this.state === 'search') {
      if (s === SPLIT) {
        this.state = 'replace';
        this.searchText = this.blockLines.join('\n');
        this.blockLines = [];
        return [{ type: 'edit-search', index: this.index, search: this.searchText }];
      }
      this.blockLines.push(line);
      return [];
    }

    if (this.state === 'replace') {
      if (s === REPLACE) {
        this.state = 'text';
        const replace = this.blockLines.join('\n');
        this.blockLines = [];
        return [
          {
            type: 'edit-end',
            index: this.index,
            search: this.searchText,
            replace,
          },
        ];
      }
      this.blockLines.push(line);
      return [];
    }

    // rewrite
    if (s === END) {
      this.state = 'text';
      const code = this.blockLines.join('\n');
      this.blockLines = [];
      return [{ type: 'rewrite-end', code }];
    }
    this.blockLines.push(line);
    this.rewriteLines += 1;
    return [{ type: 'rewrite-progress', lines: this.rewriteLines }];
  }
}
