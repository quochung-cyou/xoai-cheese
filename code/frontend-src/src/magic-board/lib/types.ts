/**
 * Shared types for the Magic Board.
 *
 * Self-contained port of the ai4edu board types: the artifact/board/refine
 * shapes are kept identical so the canvas + chat logic ports over unchanged,
 * minus every server-owned concept (no auth, no classroom, no scenarios).
 */

/** The analysis half of an artifact. */
export interface ArtifactAnalysis {
  observation: string;
  derived_models: DerivedModel[];
  notes: string;
}

export interface DerivedModel {
  type: string;
  latex: string;
  parameters: Record<string, number | string>;
  explanation: string;
}

export type ArtifactKind = 'html_sim' | 'elements' | 'scenario';

/**
 * One generated thing on a board. payload shape depends on kind:
 *   html_sim -> { html }
 *   scenario -> { scenario, params, html }  (template + params, re-renderable)
 *   elements -> { elements }
 *
 * `title`/`analysis` are duplicated into the payload for scenario refinements:
 * a params change retitles the artifact ("Anatomy: heart" -> "Anatomy: brain"),
 * and the refine 'done' event carries the payload, so the refreshed title and
 * analysis have to travel with it.
 */
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** Ids of the sketch elements this artifact was generated from — drives
   *  per-artifact staleness, frame or not. */
  source_element_ids: string[];
  payload: {
    html?: string;
    elements?: SkeletonElement[];
    /** Scenario template id — present only for kind 'scenario'. */
    scenario?: string;
    /** Scenario params the html was rendered from. */
    params?: Record<string, unknown>;
    /** Refreshed title, set by a scenario refinement. */
    title?: string;
    /** Refreshed analysis, set by a scenario refinement. */
    analysis?: ArtifactAnalysis | null;
  };
  analysis: ArtifactAnalysis | null;
  updated_at: string;
}

/** Minimal Excalidraw element schema the model emits for "elements" output. */
export interface SkeletonElement {
  id?: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  label?: { text: string; fontSize?: number };
  start?: { id: string };
  end?: { id: string };
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  points?: unknown;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO timestamp — shown in the message header. */
  at?: string;
  /** Artifact the turn targeted (user request or assistant result). */
  artifact_id?: string | null;
  /** Reasoning captured from the refine run — rendered collapsed. */
  thinking?: string;
  /** Wall-clock time the run spent thinking, ms — drives "Thought for Ns". */
  thinking_ms?: number;
}

export interface BoardScene {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

/** A board now lives entirely in localStorage. */
export interface Board {
  id: string;
  name: string;
  scene: BoardScene;
  chat_messages: ChatMessage[];
  artifacts: Artifact[];
  /** Ids of cache entries this board's canvas was built from, in spawn order.
   *  Opening the board re-spawns them. */
  cacheKeys?: string[];
  updated_at: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  updated_at: string;
}

/** Axis-aligned canvas rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One framed event from a refine run (locally streamed, not SSE). The
 *  reducer turns the model's token stream into these semantic events — the
 *  raw output text never reaches the UI. */
export type RefineEvent =
  | { type: 'status'; stage: 'loading' | 'calling-model'; lines?: number }
  | { type: 'thinking'; delta: string }
  | { type: 'narration'; delta: string }
  | { type: 'edit-start'; index: number }
  | { type: 'edit-located'; index: number; line: number; excerpt: string }
  | {
      type: 'edit-invalid';
      index: number;
      reason: string;
      search?: string;
      replace?: string;
    }
  | {
      type: 'edit-applied';
      index: number;
      line?: number;
      search: string;
      replace: string;
    }
  | { type: 'rewrite-start' }
  | { type: 'rewrite-progress'; lines: number }
  | {
      type: 'done';
      /** The artifact's whole new payload. Absent = the model answered but
       *  changed nothing (unexpressible request). */
      payload?: Artifact['payload'];
      message: string;
    }
  | { type: 'error'; detail: string };

/** Live state of one refine run, built up by reducing RefineEvents. */
export interface RefineEditCard {
  index: number;
  status: 'locating' | 'patching' | 'applied' | 'failed';
  line?: number;
  excerpt?: string;
  reason?: string;
  search?: string;
  replace?: string;
}

export interface RefineRun {
  stage: 'loading' | 'calling-model' | 'streaming';
  docLines?: number;
  thinking: string;
  narration: string;
  edits: RefineEditCard[];
  /** line count while the model streams a full-document rewrite */
  rewriteLines: number | null;
  /** performance.now() stamp of the first thinking delta — internal. */
  thinkingStarted?: number;
  /** ms spent in the thinking phase, stamped when it ends. */
  thinkingMs?: number;
}

/** Board's analyze lifecycle. */
export type AnalyzeStatus = 'idle' | 'analyzing' | 'suggested' | 'error';
