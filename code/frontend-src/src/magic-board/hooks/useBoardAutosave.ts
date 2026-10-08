/**
 * Debounced local autosave (~800ms idle) — the ai4edu boards API replaced by
 * per-board localStorage records.
 *
 * markDirty() restarts the timer; flushNow() writes immediately (used before
 * a board switch and when the tab is hidden).
 *
 * The hook owns the "base" board object so a save always patches the full
 * record: BoardApp hands it the board it just loaded/switched to via adopt(),
 * and every save reports the updated record back through onSaved.
 */
import { useCallback, useEffect, useRef } from 'react';
import { saveBoard } from '../lib/storage';
import type { Artifact, Board, BoardScene, ChatMessage } from '../lib/types';

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface BoardPayload {
  /** Omitted when no scene snapshot exists yet (canvas still mounting) — the
   *  saver skips missing keys, so this never wipes a saved scene. */
  scene?: BoardScene;
  chat_messages?: ChatMessage[];
  artifacts?: Artifact[];
  cacheKeys?: string[];
}

export function useBoardAutosave(
  boardId: string | null,
  getPayload: () => BoardPayload,
  onSaved: (board: Board) => void,
) {
  const timerRef = useRef<number | null>(null);
  const getPayloadRef = useRef(getPayload);
  getPayloadRef.current = getPayload;
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  /** The last adopted board object, so a save patches the full record. */
  const baseRef = useRef<Board | null>(null);

  const persist = useCallback((base: Board) => {
    const next = saveBoard(base, getPayloadRef.current());
    baseRef.current = next;
    onSavedRef.current(next);
  }, []);

  const markDirty = useCallback(() => {
    if (!boardIdRef.current || !baseRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (boardIdRef.current && baseRef.current) persist(baseRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [persist]);

  /**
   * Write pending changes to the board the hook is currently pointed at.
   * Call this BEFORE adopt()-ing a different board, otherwise the outgoing
   * board's scene would be written under the new board's id.
   *
   * `getPayload` reads the live canvas, so once the canvas has remounted for
   * the new board the pending flag must be dropped instead — that is what
   * `dropPending` is for.
   */
  const flushNow = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (boardIdRef.current && baseRef.current) persist(baseRef.current);
  }, [persist]);

  /** Cancel a pending save without writing (board already switched). */
  const dropPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Point the autosave layer at a board (on load and on every switch). */
  const adopt = useCallback((board: Board) => {
    baseRef.current = board;
    boardIdRef.current = board.id;
  }, []);

  // Flush pending work when the tab is hidden or closed — the debounce would
  // otherwise lose the last few strokes.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushNow]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { markDirty, flushNow, dropPending, adopt };
}
