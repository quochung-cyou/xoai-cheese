/**
 * Luồng phân tích — chỉ gợi ý, không tự động gửi yêu cầu.
 *
 * Chuyển từ `hooks/useAutoAnalyze.ts` của ai4edu, thay lời gọi máy chủ bằng
 * lời gọi trực tiếp từ trình duyệt tới endpoint của mô hình.
 *
 * onChange -> hoãn 2 giây khi rảnh -> kiểm tra độ cũ theo từng kết quả ->
 * trạng thái 'suggested' -> người dùng gọi analyzeNow() -> xuất PNG ->
 * analyzeSketch() -> phiên bản nào mới nhất thì thắng.
 */
import { useCallback, useEffect, useRef } from 'react';
import { exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

import { analyzeSketch } from '../lib/llm';
import { tryScenarioFastPath } from '../lib/classify';
import { isGeneratedElement } from '../lib/artifacts';
import type { LLMConfig } from '../lib/settings';
import type { AnalyzeStatus, Artifact } from '../lib/types';

const IDLE_DEBOUNCE_MS = 2000;

export interface Snapshot {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
  /** Khung chứa ảnh chụp — trở thành source_frame_id của kết quả. */
  frameId?: string;
  /** Nối phần giữ chỗ đang chờ của lượt chạy này với kết quả của nó khi có
   *  nhiều lượt phân tích chạy song song. Do bên gọi gán. */
  runId?: string;
}

/** Hash nội dung của các phần tử đã sinh ra một kết quả:
 *  id:version:nonce cho từng id nguồn đã lưu (id thiếu được đánh dấu là
 *  "đã xóa"). Rẻ — không cần PNG. */
function artifactSourceHash(
  artifact: Artifact,
  elements: readonly ExcalidrawElement[],
): string {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const parts = (artifact.source_element_ids ?? []).map((id) => {
    const el = byId.get(id);
    return el && !el.isDeleted
      ? `${id}:${el.version}:${el.versionNonce}`
      : `deleted:${id}`;
  });
  parts.sort();
  return parts.join(',');
}

/** Các id mà kết quả nên ghi làm nguồn: những phần tử phác thảo đã phân tích
 *  trừ đi các khung chứa. */
function sourceIdsFor(sketch: ExcalidrawElement[]): string[] {
  return sketch
    .filter((el) => el.type !== 'frame' && el.type !== 'magicframe')
    .map((el) => el.id);
}

/** Byte PNG -> base64, chia khối để bản phác thảo lớn không vượt giới hạn
 *  đối số của String.fromCharCode. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface Options {
  /** Đọc tại thời điểm gọi để hook không giữ khóa cũ. */
  getConfig: () => LLMConfig;
  /** Kết quả quyết định việc kiểm tra độ cũ. */
  artifacts: Artifact[];
  onResult: (artifact: Artifact, snapshot: Snapshot) => void;
  onError: (message: string) => void;
  setStatus: (s: AnalyzeStatus) => void;
}

export function useAutoAnalyze({
  getConfig,
  artifacts,
  onResult,
  onError,
  setStatus,
}: Options) {
  const timerRef = useRef<number | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  /** Số lượt chạy đang thực hiện — các phân tích chạy song song; trạng thái
   *  chỉ chốt lại khi lượt cuối cùng kết thúc. */
  const inFlightRef = useRef(0);
  const dirtyRef = useRef(false);
  const hadErrorRef = useRef(false);
  const abortsRef = useRef<Set<AbortController>>(new Set());
  /** artifactId -> hash nội dung nguồn ghi nhận ở lần phân tích thành công
   *  gần nhất (hoặc nạp dần ở lần gợi ý đầu tiên). */
  const analyzedHashesRef = useRef<Map<string, string>>(new Map());

  const cbRef = useRef({ onResult, onError, setStatus, getConfig });
  cbRef.current = { onResult, onError, setStatus, getConfig };
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;

  /** Hủy mọi thứ đang chạy (gỡ component / người dùng hủy). */
  const abortAll = useCallback(() => {
    for (const a of abortsRef.current) a.abort();
    abortsRef.current.clear();
  }, []);

  useEffect(
    () => () => {
      abortAll();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [abortAll],
  );

  /** @param override Ảnh chụp cần phân tích thay cho ảnh chụp onChange gần
   *  nhất (dùng cho "phân tích phần chọn" / "phân tích khung"). */
  const fire = useCallback(async (override?: Snapshot) => {
    const snapshot = override ?? snapshotRef.current;
    if (!snapshot) return;
    // Kết quả đã tạo không bao giờ được đưa ngược trở lại yêu cầu phân tích.
    const sketchElements = snapshot.elements.filter(
      (el) => !el.isDeleted && !isGeneratedElement(el),
    );
    if (!sketchElements.length) {
      cbRef.current.onError('Không có gì để phân tích — hãy vẽ gì đó trước.');
      return;
    }

    const cfg = cbRef.current.getConfig();
    if (!cfg.api_key.trim() || !cfg.model.trim()) {
      cbRef.current.setStatus('error');
      cbRef.current.onError(
        'Chưa cấu hình mô hình. Hãy mở Cài đặt và điền endpoint, mô hình cùng khóa API.',
      );
      return;
    }

    let imageBase64: string;
    try {
      const blob = await exportToBlob({
        elements: sketchElements as ExcalidrawElement[],
        appState: {
          ...snapshot.appState,
          exportBackground: true,
          exportWithDarkMode: false,
          viewBackgroundColor: '#ffffff',
        },
        files: snapshot.files,
        mimeType: 'image/png',
      });
      if (!blob) return;
      imageBase64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    } catch {
      cbRef.current.onError('Không xuất được bản phác thảo thành ảnh.');
      return;
    }

    const sourceIds = sourceIdsFor(sketchElements);
    const abort = new AbortController();
    abortsRef.current.add(abort);
    inFlightRef.current += 1;
    cbRef.current.setStatus('analyzing');
    try {
      // Ưu tiên đường nhanh: một lời gọi phân loại rẻ. Nếu khớp rõ ràng thì
      // dựng template ngay tại chỗ, không cần sinh mô phỏng — nhờ vậy thao tác
      // này nhanh và không để mô hình suy luận đốt hết hạn mức vào việc nghĩ.
      let result: Artifact | null = null;
      if (cfg.scenario_fast_path !== false) {
        try {
          result = await tryScenarioFastPath(
            cfg,
            imageBase64,
            { maxTokens: cfg.classify_max_tokens },
            abort.signal,
          );
        } catch (e) {
          // Phân loại chỉ là bước tối ưu — đừng để nó làm hỏng yêu cầu khi
          // người dùng đã yêu cầu rõ rằng nó là bắt buộc.
          if (abort.signal.aborted) throw e;
          if (cfg.scenario_fast_path === true) throw e;
          result = null;
        }
      }

      if (result) {
        // Template khớp đã được đặt sẵn; id nguồn của nó vẫn quyết định việc
        // kiểm tra "bảng đã thay đổi kể từ lần phân tích".
        analyzedHashesRef.current.set(
          result.id,
          artifactSourceHash(
            { ...result, source_element_ids: sourceIds },
            snapshot.elements,
          ),
        );
        cbRef.current.onResult(result, snapshot);
      } else {
        const generated = await analyzeSketch(
          cfg,
          { imageBase64, sourceElementIds: sourceIds },
          cfg.analyze_max_tokens,
          abort.signal,
        );
        analyzedHashesRef.current.set(
          generated.id,
          artifactSourceHash(
            { ...generated, source_element_ids: sourceIds },
            snapshot.elements,
          ),
        );
        cbRef.current.onResult(generated, snapshot);
      }
    } catch (e) {
      // Người dùng hủy thì promise bị từ chối với AbortError — không bao giờ
      // coi đó là trạng thái lỗi.
      if (!abort.signal.aborted) {
        hadErrorRef.current = true;
        cbRef.current.onError(e instanceof Error ? e.message : 'Phân tích thất bại');
      }
    } finally {
      abortsRef.current.delete(abort);
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) {
        cbRef.current.setStatus(
          hadErrorRef.current ? 'error' : dirtyRef.current ? 'suggested' : 'idle',
        );
        hadErrorRef.current = false;
        dirtyRef.current = false;
      }
    }
  }, []);

  /** Kiểm tra độ cũ theo từng kết quả sau khi hết thời gian hoãn: một kết quả
   *  bị coi là cũ khi các phần tử đã sinh ra nó thay đổi (hoặc bị xóa) kể từ
   *  lần phân tích của nó. Khi chưa có kết quả nào, mọi thay đổi đều gợi ý. */
  const suggest = useCallback(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot || snapshot.elements.length === 0) return;
    if (inFlightRef.current > 0) {
      dirtyRef.current = true;
      return;
    }

    const elements = snapshot.elements;
    const analyzed = analyzedHashesRef.current;
    let stale = false;
    let anyTracked = false;

    for (const artifact of artifactsRef.current) {
      if (!artifact.source_element_ids?.length) continue;
      anyTracked = true;
      const hash = artifactSourceHash(artifact, elements);
      const baseline = analyzed.get(artifact.id);
      if (baseline === undefined) {
        analyzed.set(artifact.id, hash);
      } else if (baseline !== hash) {
        stale = true;
        break;
      }
    }

    if (!anyTracked) stale = true;
    if (stale) cbRef.current.setStatus('suggested');
  }, []);

  const notifyChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      snapshotRef.current = { elements, appState, files };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(suggest, IDLE_DEBOUNCE_MS);
    },
    [suggest],
  );

  /** Kích hoạt thủ công: truyền một ảnh chụp để phân tích phần đang chọn hoặc
   *  một khung — luôn bắt buộc, một cú bấm sẽ bỏ qua bước chống trùng. */
  const analyzeNow = useCallback(
    (override?: Snapshot) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void fire(override ?? snapshotRef.current ?? undefined);
    },
    [fire],
  );

  /** Hủy mọi yêu cầu phân tích đang chạy (không làm gì khi đang rảnh). Trạng
   *  thái chốt lại trong khối finally của fire() khi fetch cuối cùng bị từ chối. */
  const cancel = useCallback(() => {
    abortAll();
  }, [abortAll]);

  /** Nạp mốc so sánh độ cũ cho các kết quả khôi phục từ bộ nhớ, để bảng vừa
   *  tải lại không trông như đã cũ ngay. */
  const seedHashes = useCallback(
    (loaded: Artifact[], elements: readonly ExcalidrawElement[]) => {
      for (const a of loaded) {
        if (!a.source_element_ids?.length) continue;
        analyzedHashesRef.current.set(a.id, artifactSourceHash(a, elements));
      }
    },
    [],
  );

  return { notifyChange, analyzeNow, cancel, seedHashes };
}
