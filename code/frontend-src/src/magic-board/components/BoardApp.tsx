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
 * Bảng Ma Thuật — toàn bộ ứng dụng.
 *
 * Vẽ phác thảo lên bảng, bấm Phân tích (hoặc dùng phím nóng), mô hình sẽ đọc
 * bản vẽ rồi đặt một mô phỏng tương tác hoặc một sơ đồ chỉnh sửa được trở lại
 * bảng, nối với bản phác thảo nguồn bằng một mũi tên. Chọn bất kỳ kết quả nào
 * đã tạo và tinh chỉnh nó bằng lời ở bảng bên phải.
 *
 * Các bảng và mọi kết quả đã tạo đều được lưu trong localStorage, nên có thể
 * đặt lại kết quả lên bảng — từng cái một hoặc tất cả cùng lúc — trên bất kỳ
 * bảng nào.
 */
export default function BoardApp() {
  const [board, setBoard] = useState<Board>(() => loadOrCreateActiveBoard());
  const [boardList, setBoardList] = useState<BoardSummary[]>(() => listBoards());
  const [cachedOutputs, setCachedOutputs] = useState<CachedOutput[]>(() =>
    listCachedOutputs(),
  );
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Show the visual catalog immediately; after it is closed the floating
  // "Thêm nội dung" button remains as the persistent way back in.
  const [pickerOpen, setPickerOpen] = useState(true);
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

  // Trạng thái trực tiếp mới nhất cho gói dữ liệu tự động lưu + sổ sách kết quả.
  const sceneRef = useRef<RawScene | null>(null);
  const excalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const chatRef = useRef<ChatMessage[]>(chat);
  const artifactsRef = useRef<Artifact[]>(artifacts);
  const cacheKeysRef = useRef<string[]>(board.cacheKeys ?? []);
  const boardRef = useRef<Board>(board);
  boardRef.current = board;
  const cfgRef = useRef<LLMConfig>(llmCfg);
  cfgRef.current = llmCfg;

  /** Những kết quả mà các phần tử đã tạo của chúng bị xóa khỏi bảng vẽ — phần
   *  dữ liệu vẫn còn (tinh chỉnh vẫn chạy được), chỉ là không hiển thị ở đâu. */
  const [detachedIds, setDetachedIds] = useState<ReadonlySet<string>>(new Set());

  /** Bảng mà bảng vẽ đã khôi phục xong các kết quả đã lưu tạm. */
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
    // Chưa có ảnh chụp = bảng vẽ còn đang gắn — bỏ qua `scene` để tự động lưu
    // không ghi đè cảnh đã lưu bằng {} trong khoảng trống đó.
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

  // Trỏ tầng tự động lưu vào bảng đã tải, một lần duy nhất.
  useEffect(() => {
    adopt(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Nạp lại danh sách cho bộ chuyển bảng + bảng kết quả đã lưu từ bộ nhớ. */
  const refreshLists = useCallback(() => {
    setBoardList(listBoards());
    setCachedOutputs(listCachedOutputs());
  }, []);

  // ---------------------------------------------------------------- bảng

  /** Nạp một bảng vào mọi mảnh trạng thái trực tiếp. */
  const applyBoard = useCallback(
    (next: Board) => {
      dropPending();
      sceneRef.current = null; // bảng vẽ được gắn lại sẽ tự nạp lại
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
      // Lưu bảng đang mở trước, rồi mới bàn giao.
      flushNow();
      const next = readBoard(id);
      if (!next) {
        setAnalyzeError('Không mở được bảng đó — có thể bảng đã bị xóa.');
        return;
      }
      applyBoard(next);
    },
    [flushNow, applyBoard],
  );

  const handleCreateBoard = useCallback(() => {
    flushNow();
    const created = createBoardRecord(`Bảng ${listBoards().length + 1}`);
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
      // Bảng đang mở đã bị xóa — mở bảng còn lại, hoặc tạo bảng mới.
      const nextId = remaining[0]?.id ?? createBoardRecord('Bảng của tôi').id;
      const next = readBoard(nextId);
      if (next) applyBoard(next);
      refreshLists();
    },
    [applyBoard, refreshLists],
  );

  // ------------------------------------------------------------- vị trí đặt

  /** Các hình chữ nhật trên bảng vẽ hiện đang bị phần tử nào đó chiếm. */
  const occupiedRects = useCallback(
    (elements: readonly ExcalidrawElement[]): Rect[] =>
      elements
        .filter((el) => !el.isDeleted)
        .map((el) => ({ x: el.x, y: el.y, w: el.width, h: el.height })),
    [],
  );

  /** Điểm neo cho lần đặt không có bản phác thảo nguồn: góc trên bên trái của
   *  những gì đã có trên bảng (để kết quả luôn nằm trong tầm nhìn). */
  const anchorRect = useCallback(
    (elements: readonly ExcalidrawElement[]): { x: number; y: number } => {
      const b = boundsOf(elements.filter((el) => !el.isDeleted));
      return b ? { x: b.x, y: b.y } : { x: 0, y: 0 };
    },
    [],
  );

  /**
   * Đặt một kết quả lên bảng vẽ hiện tại. Trả về hình chữ nhật nó chiếm để một
   * lô có thể xếp cái tiếp theo bên cạnh.
   *
   * Dùng cho mọi đường chèn: bảng chọn vật thể (danh mục + kết quả đã tạo),
   * "đặt kết quả đã lưu", và lượt khôi phục. `cacheKey` cho phép đường phân
   * tích khóa dòng bộ nhớ tạm của nó theo hash bản phác thảo, nhờ vậy hai bản
   * phác thảo khác nhau mà tình cờ cho ra cùng một tài liệu vẫn giữ được phần
   * phân tích riêng của mình.
   */
  const spawnArtifactOnBoard = useCallback(
    (
      artifact: Artifact,
      sourceBounds: Rect | null,
      force = false,
      /** Dòng đã tồn tại trong bộ nhớ tạm kết quả, khi bên gọi có sẵn. */
      existingEntryId?: string,
      /** Khóa bộ nhớ tạm cho dòng mới — đường phân tích truyền hash bản phác thảo. */
      cacheKey?: string,
    ): { rect: Rect; artifact: Artifact; cachedEntryId: string } | null => {
      const api = excalApiRef.current;
      if (!api) return null;
      if (!force && artifactElements(api.getSceneElements(), artifact.id).length) {
        return null; // đã có trên bảng này rồi
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

      // Đăng ký kết quả để phần tinh chỉnh nhắm tới được nó.
      if (!artifactsRef.current.some((a) => a.id === artifact.id)) {
        setArtifactsState([...artifactsRef.current, artifact]);
      }

      // Lưu tạm và ghi nhớ liên kết để bảng mở lại khôi phục được kết quả của
      // nó. Dòng bộ nhớ tạm được dùng chung cho mọi lần đặt cùng nội dung.
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

  /** Đặt một kết quả đã lưu tạm, dùng lại đúng dòng bộ nhớ tạm của nó. */
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
   * Đặt một vật thể trong danh mục: dựng template của nó rồi thả thẳng lên
   * bảng vẽ với tham số mặc định của vật thể. Không gọi mô hình — tức thì.
   */
  const handleSpawnCatalogItem = useCallback(
    async (item: CatalogItem) => {
      const inst = await instantiate(item.scenario, item.params);
      const artifact = scenarioArtifact(inst);
      setSpawnBusy(true);
      try {
        // force: chọn cùng một vật thể hai lần là chủ ý muốn thêm một bản nữa.
        const placed = spawnArtifactOnBoard(artifact, null, true);
        if (!placed) throw new Error('Bảng vẽ vẫn đang tải — hãy thử lại.');
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
        if (!placed) throw new Error('Bảng vẽ vẫn đang tải — hãy thử lại.');
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
        // Thứ tự theo bảng trước (bộ nhớ tạm đã dựng nên nó), rồi tới cái mới.
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
              ? 'Không có gì để đặt lên — chưa có kết quả nào được tạo.'
              : 'Mọi kết quả đã tạo đều đã có trên bảng này.',
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

  // ----------------------------------------------- đường phân tích trực tiếp

  /** Nơi kết quả phân tích trực tiếp tiếp theo hạ xuống: ô trống gần nhất theo
   *  kiểu first-fit, neo vào bản phác thảo vừa phân tích. */
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

  /** Hoạt họa vẽ dần cho mũi tên nối (~500ms, ease-out cubic). */
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

  /** Phân tích vừa chạy: đặt phần giữ chỗ đang tải vào đúng ô mà kết quả sẽ
   *  chiếm, kèm một mũi tên nối từ bản phác thảo đã phân tích xuống đó. */
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
   * Ghi một kết quả vừa phân tích vào bộ nhớ tạm kết quả và vào danh sách
   * liên kết bộ nhớ tạm của bảng này. Trả về id dòng bộ nhớ tạm.
   *
   * Tách riêng khỏi `spawnArtifactOnBoard` vì đường phân tích tự vẽ các phần tử
   * của nó (thăng cấp phần giữ chỗ, mũi tên) và chỉ cần phần ghi sổ —
   * `spawnArtifactOnBoard` sẽ dừng lại ở bước kiểm tra trùng.
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
        // Thăng cấp phần giữ chỗ ngay tại chỗ — người dùng có thể đã di chuyển
        // nó, nên phần tử đã được vẽ sẵn và chỉ còn phần ghi sổ.
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
        // Kết quả dạng sơ đồ: dùng lại hình chữ nhật của phần giữ chỗ; iframe
        // đang chờ và mũi tên của nó bị dọn đi, rồi một mũi tên mới trỏ vào
        // bộ khung.
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
          // Không có hình chữ nhật để dùng lại — quay về cách đặt và đăng ký
          // thông thường.
          api.updateScene({
            elements: markPendingArtifactsDeleted(api.getSceneElements(), pendingId),
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          spawnArtifactOnBoard(artifact, sourceBounds, true, undefined, sketchHash);
        }
      } else {
        // Không có phần giữ chỗ (phân tích chạy nhanh hơn bước dọn, hoặc chạy
        // theo lô): để đường chèn dùng chung vẽ và đăng ký nó.
        spawnArtifactOnBoard(artifact, sourceBounds, true, undefined, sketchHash);
      }

      setCachedOutputs(listCachedOutputs());
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifactRect, spawnArtifactOnBoard, linkFreshArtifact, markDirty],
  );

  // Dọn những phần giữ chỗ mà lượt chạy của chúng kết thúc mà không được thăng
  // cấp (lỗi, bị hủy).
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

  /* Cầu nối trạng thái iframe ↔ ứng dụng: các iframe kết quả chạy trong sandbox
   *  trên một origin đục (không có localStorage), nên chúng báo trạng thái qua
   *  postMessage. 'ready' nhận lại trạng thái đã lưu; 'state' ghi nó vào
   *  customData của phần tử — được tự động lưu cùng cảnh. */
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
          // boardBg trước tiên — các mô phỏng tô lại nền tài liệu đục của chúng
          // cho khớp với bảng vẽ (iframe trong sandbox không thể trong suốt).
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
        // updateScene phát onChange -> markDirty -> tự động lưu ghi xuống.
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

      // Nhắm mục tiêu tinh chỉnh theo lựa chọn: chọn một phần tử đã tạo (hoặc
      // một bản sao — artifactId đi kèm customData) là nhắm vào kết quả của nó.
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
          return prev; // giống hệt -> thoát, không render lại
        }
        return next;
      });

      notifyChange(elements, appState, files);
      markDirty();
    },
    [notifyChange, markDirty],
  );

  /**
   * Bảng vẽ sẵn sàng — chạy khi gắn lần đầu và sau mỗi lần chuyển bảng (bảng vẽ
   * được gắn lại theo id bảng). Nạp mốc so sánh độ cũ, rồi đặt lại các kết quả
   * đã lưu tạm của bảng này nếu cảnh của nó chưa hiển thị chúng.
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
      // Cảnh đã lưu đã chứa sẵn các phần tử được tạo.
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

  /** "Phân tích vùng" thủ công: lựa chọn phần tử của người dùng quyết định
   *  vùng — chỉ một phần tử khung thì nghĩa là nội dung của khung đó; không
   *  chọn gì thì nghĩa là cả bảng. Luôn kích hoạt cưỡng bức. */
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
    // Id lượt chạy duy nhất — phần giữ chỗ đang chờ và kết quả của nó gặp lại
    // nhau qua id này kể cả khi nhiều lượt phân tích chạy song song.
    snapshot = { ...snapshot, runId: crypto.randomUUID().slice(0, 8) };
    spawnPendingArtifact(snapshot);
    analyzeNow(snapshot);
  }, [analyzeNow, spawnPendingArtifact]);

  // Giữ một ref ổn định tới handler để bộ lắng nghe bàn phím không bao giờ cũ.
  const analyzeNowRef = useRef(handleAnalyzeNow);
  analyzeNowRef.current = handleAnalyzeNow;

  // Phím nóng toàn cục: phân tích khi bấm phím ở bất kỳ đâu ngoài ô nhập liệu.
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

  /** Tinh chỉnh xong: phản ánh dữ liệu mới lên bảng vẽ VÀ trong bộ nhớ tạm. */
  const handleArtifactPayload = useCallback(
    (artifactId: string, payload: Artifact['payload']) => {
      const updated = artifactsRef.current.map((a) =>
        a.id === artifactId
          ? {
              ...a,
              payload,
              // Một lần tinh chỉnh kịch bản sẽ tính lại những thứ này, nên mang
              // chúng theo luôn.
              ...(payload.title ? { title: payload.title } : {}),
              ...(payload.analysis !== undefined ? { analysis: payload.analysis } : {}),
            }
          : a,
      );
      setArtifactsState(updated);

      // Giữ bản lưu tạm khớp theo, nếu không lần đặt lại sẽ đưa ra mô phỏng cũ.
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
        // Dựng lại cả nhóm đã tạo tại đúng biên hiện tại của nó.
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
    void cachedOutputs; // tính lại mỗi khi bộ nhớ tạm thay đổi
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
              title="Hủy lượt phân tích đang chạy"
            >
              <Square size={11} className="fill-current" />
              Dừng
            </button>
          ) : (
            <button
              onClick={handleAnalyzeNow}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                status === 'suggested'
                  ? 'animate-pulse bg-primary text-primary-foreground'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={`Phân tích bảng (${hotkey}) — dùng phần bạn đang chọn nếu có, nếu không thì phân tích toàn bộ`}
            >
              <ScanLine size={12} />
              Phân tích
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] ${
              configured
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'bg-amber-500/15 text-amber-600'
            }`}
            title="Cài đặt mô hình"
          >
            <Settings2 size={13} />
            <span className="hidden font-mono text-[10px] md:inline">
              {configured ? modelLabel(llmCfg) : 'thiết lập mô hình'}
            </span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Bảng vẽ */}
        <div className="relative min-w-0 flex-1">
          <BoardCanvas
            key={board.id}
            scene={board.scene}
            onSceneChange={handleSceneChange}
            onApi={handleApi}
          />

          {/* Lớp phủ trạng thái */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            {status === 'analyzing' && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg">
                <Loader2 size={12} className="animate-spin" /> Đang đọc bản phác thảo…
              </div>
            )}
            {status === 'suggested' && (
              <button
                onClick={handleAnalyzeNow}
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg hover:bg-foreground/85"
                title="Bảng đã thay đổi kể từ lần phân tích trước"
              >
                <ScanLine size={12} /> Bảng đã thay đổi — nhấn{' '}
                <kbd className="rounded bg-white/20 px-1 font-mono text-[10px]">{hotkey}</kbd>{' '}
                hoặc bấm để phân tích
              </button>
            )}
            {status === 'error' && analyzeError && (
              <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive shadow ring-1 ring-destructive/30">
                <span className="min-w-0">{analyzeError}</span>
                <button
                  onClick={() => setAnalyzeError(null)}
                  className="shrink-0 font-semibold opacity-70 hover:opacity-100"
                  title="Bỏ qua"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Nút thêm nổi — bảng chọn vật thể. Nằm tránh viên trạng thái ở
              giữa phía dưới. */}
          {!pickerOpen && (
            <button
              onClick={() => setPickerOpen(true)}
              disabled={spawnBusy}
              className="group absolute bottom-4 right-4 z-20 flex h-12 items-center gap-2 rounded-full bg-primary px-3.5 text-primary-foreground shadow-xl transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
              title="Thêm một mục — hình khối 3D, giải phẫu, phương trình, vật lý…"
            >
              {spawnBusy ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Plus size={20} />
              )}
              <span className="text-xs font-semibold">Thêm nội dung</span>
            </button>
          )}

          {/* Gợi ý lần đầu sử dụng */}
          {artifacts.length === 0 && status === 'idle' && cachedOutputs.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              Hãy vẽ một bản phác thảo rồi bấm Phân tích — hoặc nhấn{' '}
              <span className="font-semibold text-foreground">+</span> để lấy hình khối 3D và giải phẫu
            </div>
          )}
        </div>

        {/* Bảng bên phải — phần trò chuyện tinh chỉnh. Kết quả đã tạo nằm ngay
            trên bảng vẽ dưới dạng iframe/phần tử. */}
        {panelCollapsed ? (
          <div className="m-2 flex w-10 shrink-0 flex-col items-center gap-1 self-start rounded-2xl border border-border bg-card py-2 shadow-sm">
            <button
              onClick={() => setPanelCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Hiện bảng tinh chỉnh"
            >
              <PanelRightOpen size={14} />
            </button>
          </div>
        ) : (
          <div className="m-2 flex w-[400px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex h-10 items-center gap-2 border-b border-border px-3.5">
              <span className="text-xs font-semibold">Tinh chỉnh</span>
              <button
                onClick={() => setPanelCollapsed(true)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Thu gọn bảng điều khiển"
              >
                <PanelRightClose size={13} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <ChatPanel
                getConfig={() => cfgRef.current}
                modelLabel={configured ? modelLabel(llmCfg) : 'chưa cấu hình'}
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
