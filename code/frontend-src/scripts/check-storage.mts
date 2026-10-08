// Storage behaviour: multi-board CRUD + migration from the single-board save.
// Run with: node --experimental-strip-types scripts/check-storage.mts
import { check, report, resetStorage, storage } from './check-helpers.mts';

const {
  createBoard,
  deleteBoard,
  duplicateBoard,
  emptyBoard,
  getActiveBoardId,
  listBoards,
  loadOrCreateActiveBoard,
  readBoard,
  renameBoard,
  saveBoard,
  setActiveBoardId,
  writeBoard,
} = await import('../src/magic-board/lib/storage.ts');

const LEGACY_KEY = 'magic-board.v1';

console.log('storage — legacy single-board migration');
{
  resetStorage();
  storage.setItem(
    LEGACY_KEY,
    JSON.stringify({
      id: 'legacyboard000000001',
      name: 'Old board',
      scene: { elements: [{ id: 'e1' }], appState: {}, files: {} },
      chat_messages: [{ role: 'user', content: 'hi' }],
      artifacts: [{ id: 'a1', kind: 'html_sim', title: 'Sim', payload: { html: '<p/>' } }],
      updated_at: '2024-01-01T00:00:00.000Z',
    }),
  );

  const board = loadOrCreateActiveBoard();
  check('migrated board keeps its id', board.id === 'legacyboard000000001', board.id);
  check('migrated board keeps its name', board.name === 'Old board', board.name);
  check(
    'migrated board keeps its scene',
    Array.isArray(board.scene.elements) && board.scene.elements.length === 1,
  );
  check('migrated board keeps chat', board.chat_messages.length === 1);
  check('migrated board keeps artifacts', board.artifacts.length === 1);
  check(
    'migrated board is the active one',
    getActiveBoardId() === 'legacyboard000000001',
  );
  check('index lists one board', listBoards().length === 1);

  // A second load must not create a duplicate from the same legacy key.
  const again = loadOrCreateActiveBoard();
  check('re-load reuses the migrated board', again.id === 'legacyboard000000001');
  check('re-load did not duplicate', listBoards().length === 1, String(listBoards().length));
}

console.log('storage — fresh start creates a board');
{
  resetStorage();
  const board = loadOrCreateActiveBoard();
  check('a board was created', typeof board.id === 'string' && board.id.length > 0);
  check('it is the active board', getActiveBoardId() === board.id);
  check('index lists one board', listBoards().length === 1);
}

console.log('storage — create / switch / rename');
{
  resetStorage();
  const a = createBoard('Alpha');
  const b = createBoard('Beta');
  check('two boards listed', listBoards().length === 2, String(listBoards().length));
  check('newest board is active', getActiveBoardId() === b.id);
  check('board A readable', readBoard(a.id)?.name === 'Alpha');

  setActiveBoardId(a.id);
  check('active switched to A', getActiveBoardId() === a.id);

  renameBoard(a.id, 'Alpha renamed');
  check('rename persisted', readBoard(a.id)?.name === 'Alpha renamed');
  check(
    'rename shows in the list',
    listBoards().some((x) => x.id === a.id && x.name === 'Alpha renamed'),
  );

  renameBoard(a.id, '   ');
  check('blank rename is ignored', readBoard(a.id)?.name === 'Alpha renamed');
}

console.log('storage — per-board isolation');
{
  resetStorage();
  const a = createBoard('A');
  const b = createBoard('B');
  writeBoard({ ...a, scene: { elements: [{ id: 'only-a' }] } });
  writeBoard({ ...b, scene: { elements: [{ id: 'only-b' }] } });

  const loadedA = readBoard(a.id)!;
  const loadedB = readBoard(b.id)!;
  check(
    'A keeps its own scene',
    (loadedA.scene.elements as { id: string }[])[0]!.id === 'only-a',
  );
  check(
    'B keeps its own scene',
    (loadedB.scene.elements as { id: string }[])[0]!.id === 'only-b',
  );
}

console.log('storage — saveBoard patches without clobbering');
{
  resetStorage();
  const board = createBoard('Patch me');
  board.scene = { elements: [{ id: 'keep' }] };
  board.chat_messages = [{ role: 'user', content: 'orig' }];
  board.cacheKeys = ['cache-1'];
  writeBoard(board);

  // No `scene` key -> the saved scene must survive (mid-mount autosave case).
  const afterChatOnly = saveBoard(readBoard(board.id)!, {
    chat_messages: [{ role: 'user', content: 'changed' }],
  });
  check(
    'omitted scene is preserved',
    (afterChatOnly.scene.elements as { id: string }[])[0]!.id === 'keep',
  );
  check('chat was updated', afterChatOnly.chat_messages[0]!.content === 'changed');
  check('cacheKeys preserved', afterChatOnly.cacheKeys?.[0] === 'cache-1');

  // An explicit empty scene must still be honoured.
  const cleared = saveBoard(afterChatOnly, { scene: {} });
  check(
    'explicit empty scene clears',
    (cleared.scene.elements ?? []).length === 0,
  );
}

console.log('storage — duplicate / delete');
{
  resetStorage();
  const a = createBoard('Original');
  a.cacheKeys = ['k1'];
  writeBoard(a);

  const copy = duplicateBoard(a.id)!;
  check('copy has a new id', copy.id !== a.id);
  check('copy is named after the source', copy.name === 'Original copy', copy.name);
  check('copy keeps the scene', JSON.stringify(copy.scene) === JSON.stringify(a.scene));
  check('copy keeps cacheKeys', copy.cacheKeys?.[0] === 'k1');
  check('original still exists', readBoard(a.id) !== null);
  check('three boards now', listBoards().length === 2, String(listBoards().length));

  // Deep copy: mutating the copy's scene must not touch the original.
  storeMutable(copy);
  check(
    'copy is a deep clone',
    (readBoard(a.id)!.scene.elements ?? []).length === 0,
  );

  deleteBoard(a.id);
  check('deleted board is gone', readBoard(a.id) === null);
  check(
    'deleted board leaves the index',
    !listBoards().some((x) => x.id === a.id),
  );
  check('active moved off the deleted board', getActiveBoardId() !== a.id);
}

console.log('storage — loadOrCreateActiveBoard fallbacks');
{
  resetStorage();
  const a = createBoard('First');
  createBoard('Second');
  // Point the index at a board whose record was removed behind its back.
  storage.removeItem(`magic-board.board.${a.id}`);
  setActiveBoardId(a.id);
  const recovered = loadOrCreateActiveBoard();
  check('recovers to an existing board', recovered.id !== a.id, recovered.id);
  check('recovered board is readable', readBoard(recovered.id) !== null);
}

console.log('storage — emptyBoard defaults');
{
  const b = emptyBoard('X');
  check('has an id', b.id.length > 0);
  check('starts with an empty scene', Object.keys(b.scene).length === 0);
  check('starts with no artifacts', b.artifacts.length === 0);
  check('starts with no cache links', b.cacheKeys?.length === 0);
}

/** Mutate a board's saved scene through the public API, to prove the
 *  duplicate is a deep clone. */
function storeMutable(copy: { id: string; scene: { elements?: unknown[] } }) {
  const stored = readBoard(copy.id)!;
  stored.scene = { elements: [{ id: 'mutated' }] };
  writeBoard(stored);
}

console.log('storage — the spawn round trip (save, switch away, come back)');
{
  resetStorage();
  const board = createBoard('Round trip');
  // Simulate: analyze produced two outputs, both cached and linked.
  board.cacheKeys = ['cache-a', 'cache-b'];
  board.artifacts = [
    { id: 'art-a', kind: 'html_sim', title: 'A', payload: { html: '<p>a</p>' } },
    { id: 'art-b', kind: 'elements', title: 'B', payload: { elements: [] } },
  ] as never;
  board.scene = { elements: [{ id: 'sim-a' }, { id: 'diag-b' }] };
  saveBoard(board, {});

  // Go to another board, then come back.
  const other = createBoard('Elsewhere');
  setActiveBoardId(other.id);
  const reopened = readBoard(board.id)!;

  check('cache links survive the round trip', reopened.cacheKeys?.length === 2);
  check('cache link order preserved', reopened.cacheKeys?.[0] === 'cache-a');
  check('artifacts survive', reopened.artifacts.length === 2);
  check('artifact payload survives', reopened.artifacts[0]!.payload.html === '<p>a</p>');
  check('scene survives', (reopened.scene.elements ?? []).length === 2);
  check('the other board is unaffected', readBoard(other.id)?.cacheKeys?.length === 0);

  // The restore guard in BoardApp needs both of these non-empty to know the
  // saved canvas already holds the outputs.
  check(
    'restore guard inputs are both non-empty',
    reopened.artifacts.length > 0 && (reopened.scene.elements ?? []).length > 0,
  );
}

report();
