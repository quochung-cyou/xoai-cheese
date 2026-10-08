/**
 * Board persistence — the ai4edu FastAPI + SQLite boards API, replaced by
 * localStorage. Now with real multi-board support.
 *
 * Layout:
 *   magic-board.index        -> { boards: [{id,name,updated_at}], activeId }
 *   magic-board.board.<id>   -> the full Board record
 *
 * The original single-board build wrote everything to one `magic-board.v1`
 * key; `migrateLegacy()` upgrades that in place the first time this module
 * runs, so an existing session keeps its canvas.
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

export function emptyBoard(name = 'Untitled board'): Board {
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
    console.error('Could not write the board index', e);
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

/** Read one board by id (without touching the index). */
export function readBoard(id: string): Board | null {
  try {
    const raw = localStorage.getItem(BOARD_PREFIX + id);
    if (!raw) return null;
    return normalizeBoard(JSON.parse(raw) as Partial<Board>);
  } catch (e) {
    console.error('Saved board was unreadable', e);
    return null;
  }
}

/** Write one board and refresh its index row. */
export function writeBoard(board: Board): Board {
  const next: Board = { ...board, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(BOARD_PREFIX + next.id, JSON.stringify(next));
  } catch (e) {
    // Quota is the realistic failure — scenes with embedded sim HTML add up.
    console.error('Could not save the board locally', e);
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
 * Patch a board's saved state. `scene` is omitted when no canvas snapshot
 * exists yet, so a mid-mount autosave can never blank a saved board.
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

export function createBoard(name = 'Untitled board'): Board {
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

export function duplicateBoard(id: string): Board | null {
  const source = readBoard(id);
  if (!source) return null;
  // Fresh ids for every generated element would break the artifact<->element
  // linkage, so the artifact ids are re-minted as a set and carried over.
  const copy: Board = {
    ...source,
    id: newBoardId(),
    name: `${source.name} copy`,
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
    /* ignoring */
  }
  const index = readIndex();
  index.boards = index.boards.filter((b) => b.id !== id);
  if (index.activeId === id) index.activeId = index.boards[0]?.id ?? null;
  writeIndex(index);
}

/**
 * Resolve the board to open at startup, creating one when there is none.
 * Runs the legacy single-board migration first.
 */
export function loadOrCreateActiveBoard(): Board {
  migrateLegacy();
  const index = readIndex();
  const active = index.activeId ? readBoard(index.activeId) : null;
  if (active) return active;

  // Index present but the active record is gone (or never set): fall back to
  // the most recent board, else make a fresh one.
  const latest = listBoards()[0];
  if (latest) {
    const board = readBoard(latest.id);
    if (board) {
      setActiveBoardId(board.id);
      return board;
    }
  }
  return createBoard('My board');
}

/** Upgrade a pre-multi-board `magic-board.v1` record into the new layout. */
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
    console.error('Could not migrate the previous single-board save', e);
  }
}
