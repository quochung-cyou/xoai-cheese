/**
 * Analyze pipeline — suggestion model, no automatic requests.
 *
 * Ported from ai4edu's `hooks/useAutoAnalyze.ts` with the server call swapped
 * for a direct browser call to the model endpoint.
 *
 * onChange -> 2s idle debounce -> per-artifact staleness check ->
 * 'suggested' status -> the user triggers analyzeNow() -> export PNG ->
 * analyzeSketch() -> latest-wins versioning.
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
  /** Frame the snapshot came from — becomes the artifact's source_frame_id. */
  frameId?: string;
  /** Correlates this run's pending placeholder with its result when several
   *  analyses run in parallel. Assigned by the caller. */
  runId?: string;
}

/** Content hash of the elements an artifact was generated from:
 *  id:version:nonce for each stored source id (missing ids flag as
 *  "deleted"). Cheap — no PNG. */
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

/** Ids the artifact should record as its source: the analyzed sketch elements
 *  minus frame containers. */
function sourceIdsFor(sketch: ExcalidrawElement[]): string[] {
  return sketch
    .filter((el) => el.type !== 'frame' && el.type !== 'magicframe')
    .map((el) => el.id);
}

/** PNG bytes -> base64, chunked so a large sketch can't blow the argument
 *  limit of String.fromCharCode. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface Options {
  /** Read at call time so the hook never holds a stale key. */
  getConfig: () => LLMConfig;
  /** Artifacts drive staleness. */
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
  /** In-flight run count — analyses run in parallel; the status settles only
   *  when the last one ends. */
  const inFlightRef = useRef(0);
  const dirtyRef = useRef(false);
  const hadErrorRef = useRef(false);
  const abortsRef = useRef<Set<AbortController>>(new Set());
  /** artifactId -> source-content hash captured at the last successful
   *  analyze (or seeded lazily on first suggest). */
  const analyzedHashesRef = useRef<Map<string, string>>(new Map());

  const cbRef = useRef({ onResult, onError, setStatus, getConfig });
  cbRef.current = { onResult, onError, setStatus, getConfig };
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;

  /** Cancel everything in flight (unmount / manual cancel). */
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

  /** @param override Snapshot to analyze instead of the last onChange one
   *  (manual "analyze selection" / "analyze frame" uses this). */
  const fire = useCallback(async (override?: Snapshot) => {
    const snapshot = override ?? snapshotRef.current;
    if (!snapshot) return;
    // Generated output never goes back into an analysis request.
    const sketchElements = snapshot.elements.filter(
      (el) => !el.isDeleted && !isGeneratedElement(el),
    );
    if (!sketchElements.length) {
      cbRef.current.onError('Nothing to analyze — draw something first.');
      return;
    }

    const cfg = cbRef.current.getConfig();
    if (!cfg.api_key.trim() || !cfg.model.trim()) {
      cbRef.current.setStatus('error');
      cbRef.current.onError(
        'No model configured yet. Open Settings and fill in the endpoint, model and API key.',
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
      cbRef.current.onError('Could not export the sketch to an image.');
      return;
    }

    const sourceIds = sourceIdsFor(sketchElements);
    const abort = new AbortController();
    abortsRef.current.add(abort);
    inFlightRef.current += 1;
    cbRef.current.setStatus('analyzing');
    try {
      // Fast path first: one cheap classify call. A clear match instantiates
      // the template locally, so nothing has to generate a simulation — which
      // is what keeps this quick and stops a reasoning model from burning its
      // whole budget thinking.
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
          // Classification is an optimisation — never let it sink the request
          // when the user has explicitly asked for it to be authoritative.
          if (abort.signal.aborted) throw e;
          if (cfg.scenario_fast_path === true) throw e;
          result = null;
        }
      }

      if (result) {
        // A template match is already placed; its source ids still drive the
        // "board changed since analyze" staleness check.
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
      // A user cancel rejects with AbortError — never an error state.
      if (!abort.signal.aborted) {
        hadErrorRef.current = true;
        cbRef.current.onError(e instanceof Error ? e.message : 'Analysis failed');
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

  /** Per-artifact staleness after the idle debounce: an artifact is stale
   *  when the elements it was generated from changed (or were deleted) since
   *  its analysis. Before any artifact exists, any change suggests. */
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

  /** Manual trigger: pass a snapshot to analyze a selection or a frame —
   *  always forced, a click bypasses dedupe. */
  const analyzeNow = useCallback(
    (override?: Snapshot) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void fire(override ?? snapshotRef.current ?? undefined);
    },
    [fire],
  );

  /** Cancel every in-flight analyze request (no-op when idle). Status settles
   *  in fire()'s finally once the last fetch rejects. */
  const cancel = useCallback(() => {
    abortAll();
  }, [abortAll]);

  /** Seed the staleness baseline for artifacts restored from storage so a
   *  reloaded board doesn't immediately look stale. */
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
