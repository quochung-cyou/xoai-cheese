import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import {
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ScanLine,
  Settings2,
  Square,
} from 'lucide-react';

import { useAutoAnalyze, type Snapshot } from '../hooks/useAutoAnalyze';
import { useBoardAutosave, type BoardPayload } from '../hooks/useBoardAutosave';
import {
  artifactElements,
  artifactIdOf,
  artifactSceneElements,
  aspectFor,
  bindArrow,
  boundsOf,
  connectorRoute,
  ensureArtifactGlobals,
  isGeneratedElement,
  loadingArtifactHtml,
  makeConnectorArrow,
  makeSimIframeElement,
  markArtifactDeleted,
  markPendingArtifactsDeleted,
  pendingArtifactElements,
  pendingArtifactId,
  placementRect,
  promotePendingArtifact,
  setArrowProgress,
  setIframeState,
  skeletonToSceneElements,
  updateIframeHtml,
} from '../lib/artifacts';
import {
  artifactContentHash,
  cacheByteSize,
  clearCachedOutputs,
  hashSketch,
  listCachedOutputs,
  markCachedSpawned,
  putCachedOutput,
  removeCachedOutput,
  updateCachedArtifact,
  type CachedOutput,
} from '../lib/cache';
import { APP_NAME } from '../lib/boardTheme';
import type { CatalogItem } from '../lib/catalog';
import { findFreeRect } from '../lib/placement';
import { instantiate, scenarioArtifact } from '../lib/scenarios';
import { loadAnalyzeHotkey, loadLLMConfig, modelLabel, type LLMConfig } from '../lib/settings';
import {
  createBoard as createBoardRecord,
  deleteBoard as deleteBoardRecord,
  duplicateBoard as duplicateBoardRecord,
  listBoards,
  loadOrCreateActiveBoard,
  readBoard,
  renameBoard as renameBoardRecord,
  setActiveBoardId,
} from '../lib/storage';
import type {
  AnalyzeStatus,
  Artifact,
  Board,
  BoardScene,
  BoardSummary,
  ChatMessage,
  Rect,
} from '../lib/types';
import BoardCanvas from './BoardCanvas';
import BoardSwitcher from './BoardSwitcher';
import ChatPanel from './ChatPanel';
import ItemPicker from './ItemPicker';
import SettingsDialog from './SettingsDialog';

interface RawScene {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

/**
 * The Magic Board — the whole app.
 *
 * Sketch on the canvas, hit Analyze (or the hotkey), and the model reads the
 * drawing and drops an interactive simulation or an editable diagram back
 * onto the board, tied to its source sketch by a connector arrow. Select any
 * generated artifact and refine it in words in the right-hand panel.
 *
 * Boards and every generated output persist in localStorage, so outputs can
 * be re-spawned — individually or all at once — onto any board.
 */
export default function BoardApp() {
  const [board, setBoard] = useState<Board>(() => loadOrCreateActiveBoard());
  const [boardList, setBoardList] = useState<BoardSummary[]>(() => listBoards());
  const [cachedOutputs, setCachedOutputs] = useState<CachedOutput[]>(() =>
    listCachedOutputs(),
  );
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState<AnalyzeStatus>('idle');
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [spawnBusy, setSpawnBusy] = useState(false);
  const [llmCfg, setLlmCfg] = useState<LLMConfig>(() => loadLLMConfig());
  const [hotkey, setHotkey] = useState(() => loadAnalyzeHotkey());

  const [artifacts, setArtifacts] = useState<Artifact[]>(board.artifacts ?? []);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    board.artifacts?.length ? board.artifacts[board.artifacts.length - 1]!.id : null,
  );
  const [chat, setChat] = useState<ChatMessage[]>(board.chat_messages ?? []);

  // Latest live state for the autosave payload + artifact bookkeeping.
  const sceneRef = useRef<RawScene | null>(null);
  const excalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const chatRef = useRef<ChatMessage[]>(chat);
  const artifactsRef = useRef<Artifact[]>(artifacts);
  const cacheKeysRef = useRef<string[]>(board.cacheKeys ?? []);
  const boardRef = useRef<Board>(board);
  boardRef.current = board;
  const cfgRef = useRef<LLMConfig>(llmCfg);
  cfgRef.current = llmCfg;

  /** Artifacts whose generated elements were deleted from the canvas — the
   *  payload survives (refine still works), it just renders nowhere. */
  const [detachedIds, setDetachedIds] = useState<ReadonlySet<string>>(new Set());

  /** Board whose cached outputs the canvas has already restored. */
  const restoredForRef = useRef<string | null>(null);

  const setArtifactsState = (a: Artifact[]) => {
    setArtifacts(a);
    artifactsRef.current = a;
  };
  const setChatState = (m: ChatMessage[]) => {
    setChat(m);
    chatRef.current = m;
  };
  const setCacheKeysState = (keys: string[]) => {
    cacheKeysRef.current = keys;
  };

  const getPayload = useCallback((): BoardPayload => {
    const raw = sceneRef.current;
    // No snapshot yet = canvas still mounting — omit `scene` so autosave
    // can't overwrite the stored scene with {} during the gap.
    if (raw === null) {
      return {
        chat_messages: chatRef.current,
        artifacts: artifactsRef.current,
        cacheKeys: cacheKeysRef.current,
      };
    }
    let scene: BoardScene = {};
    if (raw.elements.length > 0) {
      try {
        scene = JSON.parse(
          serializeAsJSON(raw.elements, raw.appState, raw.files, 'local'),
        ) as BoardScene;
      } catch {
        scene = {};
      }
    }
    return {
      scene,
      chat_messages: chatRef.current,
      artifacts: artifactsRef.current,
      cacheKeys: cacheKeysRef.current,
    };
  }, []);

  const { markDirty, flushNow, dropPending, adopt } = useBoardAutosave(
    board.id,
    getPayload,
    setBoard,
  );

  // Point the autosave layer at the loaded board once.
  useEffect(() => {
    adopt(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refresh the switcher list + cache panel from storage. */
  const refreshLists = useCallback(() => {
    setBoardList(listBoards());
    setCachedOutputs(listCachedOutputs());
  }, []);

  // ---------------------------------------------------------------- boards

  /** Load a board into every piece of live state. */
  const applyBoard = useCallback(
    (next: Board) => {
      dropPending();
      sceneRef.current = null; // repopulated by the remounted canvas
      restoredForRef.current = null;
      setActiveBoardId(next.id);
      adopt(next);
      setBoard(next);
      setArtifactsState(next.artifacts ?? []);
      setCacheKeysState(next.cacheKeys ?? []);
      setChatState(next.chat_messages ?? []);
      setActiveArtifactId(
        next.artifacts?.length ? next.artifacts[next.artifacts.length - 1]!.id : null,
      );
      setDetachedIds(new Set());
      setAnalyzeError(null);
      setStatus('idle');
      refreshLists();
    },
    [dropPending, adopt, refreshLists],
  );

  const selectBoard = useCallback(
    (id: string) => {
      if (id === boardRef.current.id) return;
      // Persist the outgoing board first, then hand over.
      flushNow();
      const next = readBoard(id);
      if (!next) {
        setAnalyzeError('That board could not be loaded — it may have been deleted.');
        return;
      }
      applyBoard(next);
    },
    [flushNow, applyBoard],
  );

  const handleCreateBoard = useCallback(() => {
    flushNow();
    const created = createBoardRecord(`Board ${listBoards().length + 1}`);
    applyBoard(created);
  }, [flushNow, applyBoard]);

  const handleRenameBoard = useCallback(
    (id: string, name: string) => {
      renameBoardRecord(id, name);
      if (id === boardRef.current.id) {
        setBoard((b) => ({ ...b, name }));
        boardRef.current = { ...boardRef.current, name };
      }
      refreshLists();
    },
    [refreshLists],
  );

  const handleDuplicateBoard = useCallback(
    (id: string) => {
      const copy = duplicateBoardRecord(id);
      refreshLists();
      if (copy) applyBoard(copy);
    },
    [refreshLists, applyBoard],
  );

  const handleDeleteBoard = useCallback(
    (id: string) => {
      const remaining = listBoards().filter((b) => b.id !== id);
      deleteBoardRecord(id);
      refreshLists();
      if (id !== boardRef.current.id) return;
      // The active board went away — open whatever is left, or make one.
      const nextId = remaining[0]?.id ?? createBoardRecord('My board').id;
      const next = readBoard(nextId);
      if (next) applyBoard(next);
      refreshLists();
    },
    [applyBoard, refreshLists],
  );

  // ------------------------------------------------------------- placement

  /** Canvas rectangles currently occupied by any live element. */
  const occupiedRects = useCallback(
    (elements: readonly ExcalidrawElement[]): Rect[] =>
      elements
        .filter((el) => !el.isDeleted)
        .map((el) => ({ x: el.x, y: el.y, w: el.width, h: el.height })),
    [],
  );

  /** Anchor for a spawn with no source sketch: the top-left of whatever is
   *  already on the board (so the result is always in view). */
  const anchorRect = useCallback(
    (elements: readonly ExcalidrawElement[]): { x: number; y: number } => {
      const b = boundsOf(elements.filter((el) => !el.isDeleted));
      return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
    },
    [],
  );

  /**
   * Spawn one artifact onto the current canvas. Returns the rect it occupied
   * so a batch can pack the next one beside it.
   *
   * Used by every insert path: the item picker (catalog + previous results),
   * "spawn cached", and the restore pass. `cacheKey` lets the analyze path key
   * its cache row by the sketch hash, so two different sketches that happen to
   * render the same document still keep their own analysis text.
   */
  const spawnArtifactOnBoard = useCallback(
    (
      artifact: Artifact,
      sourceBounds: Rect | null,
      force = false,
      /** Row that already exists in the output cache, when the caller has one. */
      existingEntryId?: string,
      /** Cache key for a new row — the analyze path passes its sketch hash. */
      cacheKey?: string,
    ): { rect: Rect; artifact: Artifact; cachedEntryId: string } | null => {
      const api = excalApiRef.current;
      if (!api) return null;
      if (!force && artifactElements(api.getSceneElements(), artifact.id).length) {
        return null; // already on this board
      }
      const existing = api.getSceneElements();
      const rect = findFreeRect(
        sourceBounds,
        aspectFor(artifact.kind),
        occupiedRects(existing),
        anchorRect(existing),
      );
      const created = artifactSceneElements(artifact, rect);
      if (!created.length) return null;

      api.updateScene({
        elements: [...existing, ...created],
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      // Register the artifact so refine can target it.
      if (!artifactsRef.current.some((a) => a.id === artifact.id)) {
        setArtifactsState([...artifactsRef.current, artifact]);
      }

      // Cache it and remember the link so a reopened board can restore its
      // outputs. The cache row is shared by every spawn of the same content.
      const entry =
        existingEntryId !== undefined
          ? { id: existingEntryId }
          : putCachedOutput(cacheKey ?? artifactContentHash(artifact), artifact, sourceBounds);
      if (!cacheKeysRef.current.includes(entry.id)) {
        setCacheKeysState([...cacheKeysRef.current, entry.id]);
      }
      setActiveArtifactId(artifact.id);
      markCachedSpawned(entry.id);

      return { rect: boundsOf(created) ?? rect, artifact, cachedEntryId: entry.id };
    },
    [occupiedRects, anchorRect],
  );

  /** Spawn a cached output, reusing its existing cache row. */
  const spawnCachedOutput = useCallback(
    (entry: CachedOutput, force = false) =>
      spawnArtifactOnBoard(
        entry.artifact,
        entry.sourceBounds,
        force,
        entry.id,
        entry.hash,
      ),
    [spawnArtifactOnBoard],
  );

  /**
   * Spawn a catalog item: render its template and drop it straight onto the
   * canvas with the item's default params. No model call — this is instant.
   */
  const handleSpawnCatalogItem = useCallback(
    async (item: CatalogItem) => {
      const inst = await instantiate(item.scenario, item.params);
      const artifact = scenarioArtifact(inst);
      setSpawnBusy(true);
      try {
        // force: picking the same item twice is a deliberate request for
        // another copy.
        const placed = spawnArtifactOnBoard(artifact, null, true);
        if (!placed) throw new Error('The canvas is still loading — try again.');
        setAnalyzeError(null);
        setCachedOutputs(listCachedOutputs());
        markDirty();
      } finally {
        setSpawnBusy(false);
      }
    },
    [spawnArtifactOnBoard, markDirty],
  );

  const handleSpawnOne = useCallback(
    async (entry: CachedOutput) => {
      setSpawnBusy(true);
      try {
        const placed = spawnCachedOutput(entry, true);
        if (!placed) throw new Error('The canvas is still loading — try again.');
        setAnalyzeError(null);
        setCachedOutputs(listCachedOutputs());
        markDirty();
      } finally {
        setSpawnBusy(false);
      }
    },
    [spawnCachedOutput, markDirty],
  );

  const handleSpawnAll = useCallback(
    (options: { includeCopies: boolean }) => {
      setSpawnBusy(true);
      try {
        const onBoard = new Set(artifactsRef.current.map((a) => a.id));
        // Board order first (the cache it was built from), then anything new.
        const byId = new Map(cachedOutputs.map((c) => [c.id, c]));
        const ordered: CachedOutput[] = [
          ...cacheKeysRef.current
            .map((k) => byId.get(k))
            .filter((c): c is CachedOutput => !!c),
          ...cachedOutputs.filter((c) => !cacheKeysRef.current.includes(c.id)),
        ];

        let spawned = 0;
        const seen = new Set<string>();
        for (const entry of ordered) {
          if (seen.has(entry.artifact.id)) continue;
          if (!options.includeCopies && onBoard.has(entry.artifact.id)) continue;
          seen.add(entry.artifact.id);
          if (spawnCachedOutput(entry, options.includeCopies)) {
            spawned += 1;
            onBoard.add(entry.artifact.id);
          }
        }

        setCachedOutputs(listCachedOutputs());
        markDirty();
        if (spawned === 0) {
          setAnalyzeError(
            options.includeCopies
              ? 'Nothing to spawn — there are no generated results yet.'
              : 'Every generated result is already on this board.',
          );
        } else {
          setAnalyzeError(null);
        }
      } finally {
        setSpawnBusy(false);
      }
    },
    [cachedOutputs, spawnCachedOutput, markDirty],
  );

  const handleRemoveCached = useCallback(
    (id: string) => {
      removeCachedOutput(id);
      setCacheKeysState(cacheKeysRef.current.filter((k) => k !== id));
      setCachedOutputs(listCachedOutputs());
      markDirty();
    },
    [markDirty],
  );

  const handleClearCache = useCallback(() => {
    clearCachedOutputs();
    setCacheKeysState([]);
    setCachedOutputs([]);
    markDirty();
  }, [markDirty]);

  // ------------------------------------------------------ live analyze path

  /** Where the next live-analyzed artifact lands: first-fit nearest free
   *  slot, anchored to the analyzed sketch. */
  const artifactRect = useCallback(
    (snapshot: Snapshot, aspect: number) => {
      const api = excalApiRef.current;
      if (!api) return null;
      const sketch = snapshot.elements.filter(
        (el) => !el.isDeleted && !isGeneratedElement(el),
      );
      const scene = api.getSceneElements();
      return findFreeRect(
        boundsOf(sketch),
        aspect,
        occupiedRects(scene),
        anchorRect(scene),
      );
    },
    [occupiedRects, anchorRect],
  );

  /** Draw-in animation for a connector arrow (~500ms, ease-out cubic). */
  const animateArrowIn = useCallback((arrowId: string) => {
    const t0 = performance.now();
    const tick = () => {
      const api = excalApiRef.current;
      if (!api) return;
      const p = Math.min(1, (performance.now() - t0) / 500);
      api.updateScene({
        elements: setArrowProgress(api.getSceneElements(), arrowId, p),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  /** Analyze just fired: drop the loading placeholder on the slot the result
   *  will occupy, plus a bound arrow from the analyzed sketch down into it. */
  const spawnPendingArtifact = useCallback(
    (snapshot: Snapshot) => {
      const api = excalApiRef.current;
      if (!api || !snapshot.runId) return;
      const pendingId = pendingArtifactId(snapshot.runId);
      const rect = artifactRect(snapshot, aspectFor('html_sim'));
      if (!rect) return;
      const iframe = makeSimIframeElement(rect, loadingArtifactHtml(), pendingId);
      const cleared = api.getSceneElements();
      const frame = snapshot.frameId
        ? cleared.find((el) => el.id === snapshot.frameId && !el.isDeleted)
        : undefined;
      const sketch = snapshot.elements.filter(
        (el) => !el.isDeleted && !isGeneratedElement(el),
      );
      const sourceRect = frame ? boundsOf([frame]) : boundsOf(sketch);
      const route = sourceRect ? connectorRoute(cleared, sourceRect, rect) : null;
      const arrow = sourceRect
        ? makeConnectorArrow(sourceRect, rect, {
            sourceId: frame?.id,
            targetId: iframe.id,
            artifactId: pendingId,
            bow: route?.bow,
            band: route?.band,
          })
        : null;
      let next = [...cleared, iframe, ...(arrow ? [arrow] : [])];
      if (arrow) next = bindArrow(next, arrow.id, frame?.id, iframe.id);
      api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
      if (arrow) animateArrowIn(arrow.id);
    },
    [artifactRect, animateArrowIn],
  );

  /**
   * Record a freshly analyzed artifact in the output cache and on this board's
   * cache-link list. Returns the cache row id.
   *
   * Kept separate from `spawnArtifactOnBoard` because the analyze path draws
   * its own elements (placeholder promotion, arrows) and only needs the
   * bookkeeping — `spawnArtifactOnBoard` would bail on the duplicate check.
   */
  const linkFreshArtifact = useCallback(
    (artifact: Artifact, sourceBounds: Rect | null, cacheKey: string): string => {
      const entry = putCachedOutput(cacheKey, artifact, sourceBounds);
      if (!artifactsRef.current.some((a) => a.id === artifact.id)) {
        setArtifactsState([...artifactsRef.current, artifact]);
      }
      if (!cacheKeysRef.current.includes(entry.id)) {
        setCacheKeysState([...cacheKeysRef.current, entry.id]);
      }
      return entry.id;
    },
    [],
  );

  const handleResult = useCallback(
    (artifact: Artifact, snapshot: Snapshot) => {
      const sketch = snapshot.elements.filter(
        (el) => !el.isDeleted && !isGeneratedElement(el),
      );
      const sourceBounds = boundsOf(sketch);
      const sketchHash = hashSketch(sketch);

      setActiveArtifactId(artifact.id);
      setAnalyzeError(null);

      const api = excalApiRef.current;
      const pendingId = snapshot.runId ? pendingArtifactId(snapshot.runId) : null;
      const pending =
        api && pendingId
          ? pendingArtifactElements(api.getSceneElements(), pendingId)
          : [];

      if (api && pendingId && pending.length && artifact.kind !== 'elements') {
        // Promote the placeholder in place — the user may have moved it, so the
        // element is already drawn and only the bookkeeping is left.
        api.updateScene({
          elements: promotePendingArtifact(
            api.getSceneElements(),
            pendingId,
            artifact.id,
            artifact.payload.html ?? '',
          ),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        linkFreshArtifact(artifact, sourceBounds, sketchHash);
      } else if (api && pendingId && pending.length) {
        // Diagram artifact: reuse the placeholder's rect; the pending iframe
        // and its arrow are swept, then a fresh arrow points at the skeleton.
        const pendingRect = boundsOf(pending);
        const rect = pendingRect ?? artifactRect(snapshot, aspectFor('elements'));
        const cleared = markPendingArtifactsDeleted(api.getSceneElements(), pendingId);
        if (rect) {
          const skeleton = skeletonToSceneElements(
            artifact.payload.elements ?? [],
            rect,
            artifact.id,
          );
          const frame = snapshot.frameId
            ? cleared.find((el) => el.id === snapshot.frameId && !el.isDeleted)
            : undefined;
          const sourceRect = frame ? boundsOf([frame]) : sourceBounds;
          const route = sourceRect ? connectorRoute(cleared, sourceRect, rect) : null;
          const arrow = sourceRect
            ? makeConnectorArrow(sourceRect, rect, {
                sourceId: frame?.id,
                artifactId: artifact.id,
                bow: route?.bow,
                band: route?.band,
              })
            : null;
          let next = [...cleared, ...skeleton, ...(arrow ? [arrow] : [])];
          if (arrow) next = bindArrow(next, arrow.id, frame?.id);
          api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
          if (arrow) animateArrowIn(arrow.id);
          linkFreshArtifact(artifact, sourceBounds, sketchHash);
        } else {
          // No rect to reuse — fall back to a plain place-and-register.
          api.updateScene({
            elements: markPendingArtifactsDeleted(api.getSceneElements(), pendingId),
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          spawnArtifactOnBoard(artifact, sourceBounds, true, undefined, sketchHash);
        }
      } else {
        // No placeholder (analyze raced the sweep, or a batch run): let the
        // shared insert path draw and register it.
        spawnArtifactOnBoard(artifact, sourceBounds, true, undefined, sketchHash);
      }

      setCachedOutputs(listCachedOutputs());
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifactRect, spawnArtifactOnBoard, linkFreshArtifact, markDirty],
  );

  // Sweep placeholders whose runs ended without promotion (error, abort).
  useEffect(() => {
    if (status === 'analyzing') return;
    const api = excalApiRef.current;
    if (!api) return;
    const scene = api.getSceneElements();
    if (!pendingArtifactElements(scene).length) return;
    api.updateScene({
      elements: markPendingArtifactsDeleted(scene),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [status]);

  /* iframe ↔ host state bridge: artifact iframes run sandboxed on an opaque
   *  origin (no localStorage), so they report state over postMessage. 'ready'
   *  gets a reply with the saved state; 'state' writes it onto the element's
   *  customData — autosaved with the scene. */
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        source?: string;
        type?: string;
        artifactId?: string;
        state?: Record<string, unknown>;
      } | null;
      if (!d || d.source !== 'magic-board' || typeof d.artifactId !== 'string') return;
      const api = excalApiRef.current;
      const scene = sceneRef.current;
      if (!api || !scene) return;
      const match = scene.elements.find(
        (el) =>
          el.type === 'iframe' &&
          !el.isDeleted &&
          (el.customData as Record<string, unknown> | undefined)?.artifactId ===
            d.artifactId,
      );
      if (d.type === 'ready') {
        const saved = (match?.customData as Record<string, unknown> | undefined)?.state;
        if (ev.source) {
          // boardBg first — sims repaint their opaque doc bg to match the
          // canvas (sandboxed iframes can't be transparent).
          (ev.source as Window).postMessage(
            {
              source: 'magic-board',
              type: 'board',
              boardBg: api.getAppState().viewBackgroundColor,
            },
            '*',
          );
          if (saved) {
            (ev.source as Window).postMessage(
              { source: 'magic-board', type: 'state', state: saved },
              '*',
            );
          }
        }
        return;
      }
      if (d.type === 'state' && d.state && match) {
        // updateScene fires onChange -> markDirty -> autosave persists it.
        api.updateScene({
          elements: setIframeState(scene.elements, d.artifactId, d.state),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const { notifyChange, analyzeNow, cancel, seedHashes } = useAutoAnalyze({
    getConfig: () => cfgRef.current,
    artifacts,
    onResult: handleResult,
    onError: setAnalyzeError,
    setStatus,
  });

  const handleSceneChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      sceneRef.current = { elements, appState, files };

      // Selection-driven refine target: picking a generated element (or a
      // duplicated copy — artifactId travels with customData) targets its
      // artifact.
      const selected = elements.filter((el) => appState.selectedElementIds[el.id]);
      const gen = selected.find((el) => artifactIdOf(el));
      if (gen) {
        const targetId = artifactIdOf(gen);
        if (targetId) {
          setActiveArtifactId((prev) => (prev === targetId ? prev : targetId));
        }
      }

      setDetachedIds((prev) => {
        const next = new Set(
          artifactsRef.current
            .filter((a) => artifactElements(elements, a.id).length === 0)
            .map((a) => a.id),
        );
        if (prev.size === next.size && [...prev].every((id) => next.has(id))) {
          return prev; // identical -> bail out, no re-render
        }
        return next;
      });

      notifyChange(elements, appState, files);
      markDirty();
    },
    [notifyChange, markDirty],
  );

  /**
   * Canvas ready — fires on initial mount and after every board switch (the
   * canvas remounts on board id). Seeds staleness, then re-spawns this
   * board's cached outputs if its scene does not already show them.
   */
  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      excalApiRef.current = api;
      const els = api.getSceneElements();
      if (artifactsRef.current.length && els.length) {
        seedHashes(artifactsRef.current, ensureArtifactGlobals(els));
      }

      const boardId = boardRef.current.id;
      if (restoredForRef.current === boardId) return;
      restoredForRef.current = boardId;

      const keys = cacheKeysRef.current;
      if (!keys.length) return;
      // The saved scene already holds the generated elements.
      if (artifactsRef.current.length > 0 && els.length > 0) return;

      const byId = new Map(listCachedOutputs().map((c) => [c.id, c]));
      const entries = keys
        .map((k) => byId.get(k))
        .filter((e): e is CachedOutput => e !== undefined);
      if (!entries.length) return;

      const occupied: Rect[] = occupiedRects(els);
      const anchor = anchorRect(els);
      const added: ExcalidrawElement[] = [];
      const restoredArtifacts: Artifact[] = [];
      for (const entry of entries) {
        const rect = findFreeRect(
          entry.sourceBounds,
          aspectFor(entry.artifact.kind),
          occupied,
          anchor,
        );
        const created = artifactSceneElements(entry.artifact, rect);
        if (!created.length) continue;
        added.push(...created);
        occupied.push(boundsOf(created) ?? rect);
        restoredArtifacts.push(entry.artifact);
        markCachedSpawned(entry.id);
      }
      if (!added.length) return;

      api.updateScene({
        elements: [...els, ...added],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      setArtifactsState(restoredArtifacts);
      setActiveArtifactId(restoredArtifacts.at(-1)?.id ?? null);
      setCachedOutputs(listCachedOutputs());
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedHashes, occupiedRects, anchorRect, markDirty],
  );

  /** Manual "analyze area": the user's element selection defines the area — a
   *  frame element alone means its contents; no selection means the whole
   *  board. Force-fired. */
  const handleAnalyzeNow = useCallback(() => {
    const api = excalApiRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const selected = elements.filter((el) => appState.selectedElementIds[el.id]);

    let snapshot: Snapshot;
    const selectedFrames = selected.filter(
      (el) => el.type === 'frame' || el.type === 'magicframe',
    );
    const sketchSelected = selected.filter((el) => !isGeneratedElement(el));
    if (selectedFrames.length === 1) {
      const frame = selectedFrames[0]!;
      snapshot = {
        elements: [frame, ...elements.filter((el) => el.frameId === frame.id)],
        appState,
        files,
        frameId: frame.id,
      };
    } else if (sketchSelected.length > 0) {
      const frameIds = new Set(sketchSelected.map((el) => el.frameId).filter(Boolean));
      snapshot = {
        elements: sketchSelected,
        appState,
        files,
        frameId: frameIds.size === 1 ? ([...frameIds][0] as string) : undefined,
      };
    } else {
      snapshot = { elements, appState, files };
    }
    // Unique run id — the pending placeholder and its result meet again
    // through it even when several analyses run in parallel.
    snapshot = { ...snapshot, runId: crypto.randomUUID().slice(0, 8) };
    spawnPendingArtifact(snapshot);
    analyzeNow(snapshot);
  }, [analyzeNow, spawnPendingArtifact]);

  // Keep a stable ref to the handler so the key listener never goes stale.
  const analyzeNowRef = useRef(handleAnalyzeNow);
  analyzeNowRef.current = handleAnalyzeNow;

  // Global hotkey: analyze on keypress anywhere outside text inputs.
  useEffect(() => {
    const target = hotkey.length === 1 ? hotkey.toLowerCase() : hotkey;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return;
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === target) {
        e.preventDefault();
        analyzeNowRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey]);

  /** Refine done: reflect the new payload on the canvas AND in the cache. */
  const handleArtifactPayload = useCallback(
    (artifactId: string, payload: Artifact['payload']) => {
      const updated = artifactsRef.current.map((a) =>
        a.id === artifactId
          ? {
              ...a,
              payload,
              // A scenario refinement re-derives these, so take them along.
              ...(payload.title ? { title: payload.title } : {}),
              ...(payload.analysis !== undefined ? { analysis: payload.analysis } : {}),
            }
          : a,
      );
      setArtifactsState(updated);

      // Keep the cached copy in step, or a re-spawn would ship the old sim.
      const entry = listCachedOutputs().find((c) => c.artifact.id === artifactId);
      if (entry) {
        updateCachedArtifact(entry.id, payload);
        setCachedOutputs(listCachedOutputs());
      }

      const api = excalApiRef.current;
      if (!api) {
        markDirty();
        return;
      }
      const scene = api.getSceneElements();

      if (payload.html != null) {
        api.updateScene({
          elements: updateIframeHtml(scene, artifactId, payload.html),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } else if (payload.elements) {
        // Rebuild the whole generated group at its current bounds.
        const oldEls = artifactElements(scene, artifactId);
        const rect =
          boundsOf(oldEls) ??
          placementRect(
            boundsOf(scene.filter((el) => !el.isDeleted && !isGeneratedElement(el))),
            aspectFor('elements'),
          );
        const cleared = markArtifactDeleted(scene, artifactId);
        const rebuilt = skeletonToSceneElements(payload.elements, rect, artifactId);
        api.updateScene({
          elements: [...cleared, ...rebuilt],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markDirty],
  );

  const handleChatChange = (messages: ChatMessage[]) => {
    setChatState(messages);
    markDirty();
  };

  const activeArtifact = useMemo(
    () => artifacts.find((a) => a.id === activeArtifactId) ?? null,
    [artifacts, activeArtifactId],
  );

  const configured = Boolean(llmCfg.api_key.trim() && llmCfg.model.trim());

  const cacheSize = useMemo(() => {
    void cachedOutputs; // recompute whenever the cache changes
    return cacheByteSize();
  }, [cachedOutputs]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">
          M
        </span>
        <h1 className="mr-1 text-sm font-semibold tracking-tight">{APP_NAME}</h1>

        <BoardSwitcher
          boards={boardList}
          activeId={board.id}
          onSelect={selectBoard}
          onCreate={handleCreateBoard}
          onRename={handleRenameBoard}
          onDuplicate={handleDuplicateBoard}
          onDelete={handleDeleteBoard}
        />

        <div className="ml-auto flex items-center gap-2">
          {status === 'analyzing' ? (
            <button
              onClick={cancel}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background hover:bg-foreground/85"
              title="Cancel the running analysis"
            >
              <Square size={11} className="fill-current" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleAnalyzeNow}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                status === 'suggested'
                  ? 'animate-pulse bg-primary text-primary-foreground'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={`Analyze the board (${hotkey}) — uses your selection if any, otherwise everything`}
            >
              <ScanLine size={12} />
              Analyze
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] ${
              configured
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'bg-amber-500/15 text-amber-600'
            }`}
            title="Model settings"
          >
            <Settings2 size={13} />
            <span className="hidden font-mono text-[10px] md:inline">
              {configured ? modelLabel(llmCfg) : 'set up model'}
            </span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          <BoardCanvas
            key={board.id}
            scene={board.scene}
            onSceneChange={handleSceneChange}
            onApi={handleApi}
          />

          {/* Status overlay */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            {status === 'analyzing' && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg">
                <Loader2 size={12} className="animate-spin" /> Reading your sketch…
              </div>
            )}
            {status === 'suggested' && (
              <button
                onClick={handleAnalyzeNow}
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg hover:bg-foreground/85"
                title="The board changed since the last analysis"
              >
                <ScanLine size={12} /> Board changed — press{' '}
                <kbd className="rounded bg-white/20 px-1 font-mono text-[10px]">{hotkey}</kbd>{' '}
                or click to analyze
              </button>
            )}
            {status === 'error' && analyzeError && (
              <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive shadow ring-1 ring-destructive/30">
                <span className="min-w-0">{analyzeError}</span>
                <button
                  onClick={() => setAnalyzeError(null)}
                  className="shrink-0 font-semibold opacity-70 hover:opacity-100"
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Floating add button — the item picker. Sits clear of the
              bottom-centre status pill. */}
          <button
            onClick={() => setPickerOpen(true)}
            disabled={spawnBusy}
            className="absolute bottom-4 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
            title="Add an item — 3D shapes, anatomy, equations, physics…"
          >
            {spawnBusy ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Plus size={22} />
            )}
          </button>

          {/* First-run hint */}
          {artifacts.length === 0 && status === 'idle' && cachedOutputs.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              Draw a sketch and hit Analyze — or press{' '}
              <span className="font-semibold text-foreground">+</span> for 3D shapes and anatomy
            </div>
          )}
        </div>

        {/* Right panel — the refine chat. Generated output lives on the canvas
            itself as iframe/element artifacts. */}
        {panelCollapsed ? (
          <div className="m-2 flex w-10 shrink-0 flex-col items-center gap-1 self-start rounded-2xl border border-border bg-card py-2 shadow-sm">
            <button
              onClick={() => setPanelCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Show refine panel"
            >
              <PanelRightOpen size={14} />
            </button>
          </div>
        ) : (
          <div className="m-2 flex w-[400px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex h-10 items-center gap-2 border-b border-border px-3.5">
              <span className="text-xs font-semibold">Refine</span>
              <button
                onClick={() => setPanelCollapsed(true)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Collapse panel"
              >
                <PanelRightClose size={13} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <ChatPanel
                getConfig={() => cfgRef.current}
                modelLabel={configured ? modelLabel(llmCfg) : 'not configured'}
                artifacts={artifacts}
                activeArtifactId={activeArtifactId}
                onOpenSettings={() => setSettingsOpen(true)}
                onSelectArtifact={setActiveArtifactId}
                messages={chat}
                onMessagesChange={handleChatChange}
                onArtifactPayload={handleArtifactPayload}
                detachedIds={detachedIds}
                activeArtifact={activeArtifact}
              />
            </div>
          </div>
        )}
      </div>

      <ItemPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSpawnItem={handleSpawnCatalogItem}
        previous={cachedOutputs}
        previousBytes={cacheSize}
        onSpawnPrevious={handleSpawnOne}
        onSpawnAllPrevious={() => handleSpawnAll({ includeCopies: false })}
        onRemovePrevious={handleRemoveCached}
        onClearPrevious={handleClearCache}
      />

      <SettingsDialog
        open={settingsOpen}
        hotkey={hotkey}
        onClose={() => setSettingsOpen(false)}
        onSaved={(cfg) => {
          setLlmCfg(cfg);
          cfgRef.current = cfg;
          setHotkey(loadAnalyzeHotkey());
        }}
      />
    </div>
  );
}
