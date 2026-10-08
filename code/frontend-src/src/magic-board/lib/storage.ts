/**
 * Lưu trữ bảng — API bảng dùng FastAPI + SQLite của ai4edu, được thay bằng
 * localStorage. Nay có hỗ trợ thật sự cho nhiều bảng.
 *
 * Bố cục:
 *   magic-board.index        -> { boards: [{id,name,updated_at}], activeId }
 *   magic-board.board.<id>   -> bản ghi Board đầy đủ
 *
 * Bản dựng một-bảng ban đầu ghi mọi thứ vào một khóa `magic-board.v1`;
 * `migrateLegacy()` nâng cấp tại chỗ trong lần đầu mô-đun này chạy, nên một
 * phiên làm việc đang có vẫn giữ nguyên bảng vẽ.
 */
import type { Artifact, Board, BoardScene, BoardSummary, ChatMessage } from './types';

const SLUG = 'magic-board';
const INDEX_KEY = `${SLUG}.index`;
const BOARD_PREFIX = `${SLUG}.board.`;
const LEGACY_KEY = `${SLUG}.v1`;
const MIGRATED_KEY = `${SLUG}.migrated`;

export function newBoardId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function emptyBoard(name = 'Bảng chưa đặt tên'): Board {
  return {
    id: newBoardId(),
    name,
    scene: {},
    chat_messages: [],
    artifacts: [],
    cacheKeys: [],
    updated_at: new Date().toISOString(),
  };
}

interface BoardIndex {
  boards: BoardSummary[];
  activeId: string | null;
}

function readIndex(): BoardIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { boards: [], activeId: null };
    const parsed = JSON.parse(raw) as Partial<BoardIndex>;
    return {
      boards: Array.isArray(parsed.boards) ? parsed.boards : [],
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return { boards: [], activeId: null };
  }
}

function writeIndex(index: BoardIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.error('Không thể ghi chỉ mục (index) của bảng', e);
  }
}

function normalizeBoard(parsed: Partial<Board>): Board {
  const base = emptyBoard();
  return {
    ...base,
    ...parsed,
    id: typeof parsed.id === 'string' && parsed.id ? parsed.id : base.id,
    name: typeof parsed.name === 'string' && parsed.name ? parsed.name : base.name,
    scene: parsed.scene ?? {},
    chat_messages: parsed.chat_messages ?? [],
    artifacts: parsed.artifacts ?? [],
    cacheKeys: parsed.cacheKeys ?? [],
  };
}

/** Đọc một bảng theo id (không đụng tới chỉ mục). */
export function readBoard(id: string): Board | null {
  try {
    const raw = localStorage.getItem(BOARD_PREFIX + id);
    if (!raw) return null;
    return normalizeBoard(JSON.parse(raw) as Partial<Board>);
  } catch (e) {
    console.error('Không đọc được bảng đã lưu', e);
    return null;
  }
}

/** Ghi một bảng và làm mới dòng chỉ mục của nó. */
export function writeBoard(board: Board): Board {
  const next: Board = { ...board, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(BOARD_PREFIX + next.id, JSON.stringify(next));
  } catch (e) {
    // Hết dung lượng là lỗi thực tế hay gặp — cảnh có nhúng HTML mô phỏng sẽ phình ra.
    console.error('Không thể lưu bảng vào máy cục bộ', e);
  }
  const index = readIndex();
  const summary: BoardSummary = {
    id: next.id,
    name: next.name,
    updated_at: next.updated_at,
  };
  const at = index.boards.findIndex((b) => b.id === next.id);
  if (at >= 0) index.boards[at] = summary;
  else index.boards.push(summary);
  writeIndex(index);
  return next;
}

/**
 * Cập nhật một phần trạng thái đã lưu của bảng. `scene` bị bỏ qua khi chưa có
 * ảnh chụp bảng vẽ, nhờ vậy thao tác tự lưu giữa chừng lúc gắn kết (mount)
 * không bao giờ xóa trắng một bảng đã lưu.
 */
export function saveBoard(
  board: Board,
  data: {
    scene?: BoardScene;
    chat_messages?: ChatMessage[];
    artifacts?: Artifact[];
    cacheKeys?: string[];
  },
): Board {
  return writeBoard({
    ...board,
    scene: data.scene !== undefined ? data.scene : board.scene,
    chat_messages: data.chat_messages ?? board.chat_messages,
    artifacts: data.artifacts ?? board.artifacts,
    cacheKeys: data.cacheKeys ?? board.cacheKeys ?? [],
  });
}

export function listBoards(): BoardSummary[] {
  return [...readIndex().boards].sort((a, b) =>
    a.updated_at < b.updated_at ? 1 : -1,
  );
}

export function getActiveBoardId(): string | null {
  return readIndex().activeId;
}

export function setActiveBoardId(id: string): void {
  const index = readIndex();
  index.activeId = id;
  writeIndex(index);
}

export function createBoard(name = 'Bảng chưa đặt tên'): Board {
  const board = emptyBoard(name);
  writeBoard(board);
  setActiveBoardId(board.id);
  return board;
}

export function renameBoard(id: string, name: string): void {
  const board = readBoard(id);
  if (!board) return;
  writeBoard({ ...board, name: name.trim() || board.name });
}

/** Nhãn hậu tố cho bản sao — tách ra để đổi được mà không phải sửa logic. */
export const COPY_SUFFIX = '(bản sao)';

/**
 * Nhân bản một bảng. `name` cho phép đặt tên tường minh; mặc định là
 * "<tên gốc> (bản sao)".
 */
export function duplicateBoard(id: string, name?: string): Board | null {
  const source = readBoard(id);
  if (!source) return null;
  // Cấp id mới cho mọi phần tử được sinh ra sẽ phá vỡ liên kết kết quả <-> phần
  // tử, nên id của các kết quả được cấp lại theo cả tập hợp và giữ nguyên.
  const copy: Board = {
    ...source,
    id: newBoardId(),
    name: name ?? `${source.name} ${COPY_SUFFIX}`,
    scene: JSON.parse(JSON.stringify(source.scene)) as BoardScene,
    chat_messages: JSON.parse(JSON.stringify(source.chat_messages)) as ChatMessage[],
    artifacts: JSON.parse(JSON.stringify(source.artifacts)) as Artifact[],
    updated_at: new Date().toISOString(),
  };
  writeBoard(copy);
  return copy;
}

export function deleteBoard(id: string): void {
  try {
    localStorage.removeItem(BOARD_PREFIX + id);
  } catch {
    /* bỏ qua */
  }
  const index = readIndex();
  index.boards = index.boards.filter((b) => b.id !== id);
  if (index.activeId === id) index.activeId = index.boards[0]?.id ?? null;
  writeIndex(index);
}

/**
 * Xác định bảng cần mở lúc khởi động, tạo mới nếu chưa có bảng nào.
 * Chạy bước di trú từ bản một-bảng cũ trước tiên.
 */
export function loadOrCreateActiveBoard(): Board {
  migrateLegacy();
  const index = readIndex();
  const active = index.activeId ? readBoard(index.activeId) : null;
  if (active) return active;

  // Chỉ mục vẫn còn nhưng bản ghi đang hoạt động đã mất (hoặc chưa từng được
  // đặt): quay về bảng mới nhất, nếu không có thì tạo một bảng mới.
  const latest = listBoards()[0];
  if (latest) {
    const board = readBoard(latest.id);
    if (board) {
      setActiveBoardId(board.id);
      return board;
    }
  }
  return createBoard('Bảng của tôi');
}

/** Nâng cấp bản ghi `magic-board.v1` từ thời một-bảng sang bố cục mới. */
export function migrateLegacy(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
    if (!raw || localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Board>;
    const board = normalizeBoard(parsed);
    writeBoard(board);
    setActiveBoardId(board.id);
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch (e) {
    console.error('Không thể di trú bản lưu một-bảng trước đó', e);
  }
}
