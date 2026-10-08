/**
 * Tự động lưu cục bộ có hoãn (~800ms khi rảnh) — API boards của ai4edu được
 * thay bằng bản ghi localStorage cho từng bảng.
 *
 * markDirty() khởi động lại bộ đếm; flushNow() ghi ngay (dùng trước khi chuyển
 * bảng và khi tab bị ẩn).
 *
 * Hook này giữ đối tượng bảng "gốc" để mỗi lần lưu luôn vá vào bản ghi đầy đủ:
 * BoardApp đưa cho nó bảng vừa tải/vừa chuyển tới qua adopt(), và mỗi lần lưu
 * báo bản ghi đã cập nhật trở lại qua onSaved.
 */
import { useCallback, useEffect, useRef } from 'react';
import { saveBoard } from '../lib/storage';
import type { Artifact, Board, BoardScene, ChatMessage } from '../lib/types';

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface BoardPayload {
  /** Bỏ qua khi chưa có ảnh chụp cảnh (bảng vẽ còn đang gắn) — bộ lưu sẽ bỏ qua
   *  các khóa thiếu, nên việc này không bao giờ xóa mất cảnh đã lưu. */
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
  /** Đối tượng bảng được adopt gần nhất, để mỗi lần lưu vá vào bản ghi đầy đủ. */
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
   * Ghi các thay đổi đang chờ xuống bảng mà hook hiện đang trỏ tới.
   * Hãy gọi hàm này TRƯỚC khi adopt() một bảng khác, nếu không cảnh của bảng
   * đang rời đi sẽ bị ghi dưới id của bảng mới.
   *
   * `getPayload` đọc bảng vẽ trực tiếp, nên khi bảng vẽ đã được gắn lại cho
   * bảng mới thì phải bỏ cờ đang chờ — đó là việc của `dropPending`.
   */
  const flushNow = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (boardIdRef.current && baseRef.current) persist(baseRef.current);
  }, [persist]);

  /** Hủy một lần lưu đang chờ mà không ghi (bảng đã được chuyển rồi). */
  const dropPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Trỏ tầng tự động lưu vào một bảng (khi tải và mỗi lần chuyển bảng). */
  const adopt = useCallback((board: Board) => {
    baseRef.current = board;
    boardIdRef.current = board.id;
  }, []);

  // Ghi nốt phần đang chờ khi tab bị ẩn hoặc đóng — nếu không, bước hoãn sẽ
  // làm mất vài nét vẽ cuối.
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
