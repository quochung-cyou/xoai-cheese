/**
 * Refine pipeline — port of the ai4edu backend's `app/services/refine.py`.
 *
 * Stored payload -> prompt -> provider stream -> scanned edit lifecycle
 * events -> atomic commit at 'done'. The caller gets the same RefineEvent
 * vocabulary the old SSE endpoint produced, so the chat UI is unchanged.
 *
 * Two contracts:
 *  - html_sim: the model emits SEARCH/REPLACE (or a full REWRITE) markers;
 *    edits are validated against a working copy as they arrive.
 *  - elements: the model emits {ops, message} JSON; ops apply atomically to
 *    the skeleton list.
 */
import { PROMPT_REFINE, PROMPT_REFINE_ELEMENTS } from './prompts';
import {
  applyEdits,
  applyElementOps,
  EditError,
  findMatchLine,
  type Edit,
} from './edits';
import { EditStreamScanner, type ScanEvent } from './editsStream';
import { LlmError, parseLlmJson, completeChatEvents, type CompletionEvent } from './llm';
import { refineScenarioArtifact } from './refineScenarios';
import type { LLMConfig } from './settings';
import type { Artifact, RefineEvent, SkeletonElement } from './types';

/** html_sim is an HTML doc edited via SEARCH/REPLACE markers. */
const HTML_KINDS = new Set(['html_sim', 'scenario']);

export interface RefineOptions {
  onEvent: (ev: RefineEvent) => void;
  signal?: AbortSignal;
}

function textPart(text: string) {
  return { type: 'text', text };
}

// ------------------------------------------------------------- elements

async function* streamElementsRefinement(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
): AsyncGenerator<RefineEvent> {
  const current = artifact.payload.elements ?? [];
  yield { type: 'status', stage: 'loading', lines: current.length };

  const doc = JSON.stringify(current, null, 0);
  const parts = [
    textPart(`Here is the current skeleton element list:\n\n${doc}`),
    textPart(`User instruction: "${instruction}"`),
  ];
  yield { type: 'status', stage: 'calling-model' };

  const rawParts: string[] = [];
  for await (const ev of completeChatEvents(
    cfg,
    PROMPT_REFINE_ELEMENTS,
    parts,
    { jsonMode: false },
    signal,
  )) {
    if (ev.kind === 'thinking') {
      yield { type: 'thinking', delta: ev.delta };
      continue;
    }
    rawParts.push(ev.delta);
  }

  const parsed = parseLlmJson(rawParts.join(''));
  const ops = (parsed as { ops?: unknown }).ops;
  if (!Array.isArray(ops) || !ops.length) {
    throw new LlmError(
      'The model returned no edits for the diagram. Try rephrasing the instruction.',
    );
  }

  let newElements: SkeletonElement[];
  try {
    newElements = applyElementOps(current, ops);
  } catch (e) {
    throw new LlmError(
      `The model's edit didn't match the diagram (${
        e instanceof Error ? e.message : e
      }). Try rephrasing, or analyze again.`,
    );
  }

  const message =
    String((parsed as { message?: unknown }).message ?? '') ||
    `Applied ${ops.length} edit(s).`;
  yield { type: 'done', payload: { elements: newElements }, message };
}

// ----------------------------------------------------------------- html

async function* streamHtmlRefinement(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
): AsyncGenerator<RefineEvent> {
  const currentCode = artifact.payload.html ?? '';
  yield {
    type: 'status',
    stage: 'loading',
    lines: currentCode.split('\n').length,
  };

  const parts = [
    textPart(`Here is the current simulation HTML document:\n\n${currentCode}`),
    textPart(`User instruction: "${instruction}"`),
  ];
  yield { type: 'status', stage: 'calling-model' };

  const scanner = new EditStreamScanner();
  const narrationParts: string[] = [];
  const rawParts: string[] = [];
  const edits: Edit[] = [];
  const failed = new Set<number>();
  const located = new Map<number, number | null>();
  let working = currentCode;
  let rewriteCode: string | null = null;

  function* emitFrom(scanEvents: ScanEvent[]): Generator<RefineEvent> {
    for (const se of scanEvents) {
      switch (se.type) {
        case 'narration':
          narrationParts.push(se.delta);
          yield { type: 'narration', delta: se.delta };
          break;
        case 'edit-start':
          yield { type: 'edit-start', index: se.index };
          break;
        case 'edit-search': {
          // The search text is known while the replacement is still
          // generating — validate it against the working copy now.
          const lineNo = findMatchLine(working, se.search);
          located.set(se.index, lineNo);
          if (lineNo === null) {
            failed.add(se.index);
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: 'search text not found in document',
              search: se.search,
            };
          } else {
            yield {
              type: 'edit-located',
              index: se.index,
              line: lineNo,
              excerpt: (se.search.split('\n')[0] ?? '').slice(0, 120),
            };
          }
          break;
        }
        case 'edit-end': {
          const edit: Edit = { search: se.search, replace: se.replace };
          if (failed.has(se.index)) {
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: 'skipped — search text did not match',
              search: se.search,
              replace: se.replace,
            };
            break;
          }
          try {
            working = applyEdits(working, [edit]);
            edits.push(edit);
            yield {
              type: 'edit-applied',
              index: se.index,
              line: located.get(se.index) ?? undefined,
              search: se.search,
              replace: se.replace,
            };
          } catch (e) {
            failed.add(se.index);
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: e instanceof EditError ? e.message : String(e),
              search: se.search,
              replace: se.replace,
            };
          }
          break;
        }
        case 'rewrite-start':
          yield { type: 'rewrite-start' };
          break;
        case 'rewrite-progress':
          yield { type: 'rewrite-progress', lines: se.lines };
          break;
        case 'rewrite-end':
          rewriteCode = se.code;
          break;
      }
    }
  }

  for await (const ev of completeChatEvents(
    cfg,
    PROMPT_REFINE,
    parts,
    { jsonMode: false },
    signal,
  )) {
    if (ev.kind === 'thinking') {
      yield { type: 'thinking', delta: ev.delta };
      continue;
    }
    rawParts.push(ev.delta);
    yield* emitFrom(scanner.feed(ev.delta));
  }
  yield* emitFrom(scanner.flush());

  const narration = narrationParts.join('').trim();

  // --- Resolve the final document ---
  if (rewriteCode) {
    const code: string = rewriteCode;
    yield {
      type: 'done',
      payload: { html: code },
      message: narration || 'Rewrote the simulation.',
    };
    return;
  }

  if (edits.length && !failed.size) {
    yield {
      type: 'done',
      payload: { html: working },
      message: narration || `Applied ${edits.length} edit(s).`,
    };
    return;
  }

  // Fallback: a model that ignored the marker contract may still have
  // produced the legacy JSON shape — try it before declaring failure.
  const raw = rawParts.join('');
  try {
    const parsed = parseLlmJson(raw) as Record<string, unknown>;
    if (typeof parsed.simulation_code === 'string' && parsed.simulation_code) {
      yield {
        type: 'done',
        payload: { html: parsed.simulation_code },
        message: String(parsed.message ?? '') || narration || 'Done.',
      };
      return;
    }
    if (Array.isArray(parsed.edits) && parsed.edits.length) {
      const newCode = applyEdits(currentCode, parsed.edits as Edit[]);
      yield {
        type: 'done',
        payload: { html: newCode },
        message: String(parsed.message ?? '') || narration || 'Done.',
      };
      return;
    }
  } catch {
    /* not the legacy shape either — fall through to the failure below */
  }

  if (failed.size) {
    throw new LlmError(
      `The model's edit didn't match the document (edit(s) ${[
        ...failed,
      ].sort((a, b) => a - b)} failed to apply). Try rephrasing, or analyze again.`,
    );
  }
  throw new LlmError(
    'The model returned no usable edits for this document. Try rephrasing the instruction.',
  );
}

// ------------------------------------------------------------- entrypoint

/**
 * Refine one artifact by natural-language instruction, emitting semantic
 * progress events. Errors are raised (the caller turns them into an 'error'
 * event / chat reply); the final payload arrives via a 'done' event.
 *
 * Three contracts, chosen by artifact kind:
 *  - elements : {ops, message} JSON applied to the skeleton list
 *  - scenario : {params, message} JSON merged and re-rendered from template
 *  - html_sim : SEARCH/REPLACE (or REWRITE) markers over the document
 */
export async function* refineArtifact(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
  onEvent?: (ev: RefineEvent) => void,
): AsyncGenerator<RefineEvent> {
  if (!instruction.trim()) throw new LlmError('An instruction is required.');

  if (artifact.kind === 'elements') {
    if (!artifact.payload.elements?.length) {
      throw new LlmError('This diagram has no elements to refine.');
    }
    yield* streamElementsRefinement(cfg, artifact, instruction, signal);
    return;
  }

  // Template-backed artifacts are refined through their params, never by
  // editing the rendered document. That path is a plain function, so its
  // progress events are forwarded through onEvent and only the result is
  // yielded here.
  if (artifact.payload.scenario) {
    const result = await refineScenarioArtifact(
      cfg,
      artifact,
      instruction,
      onEvent ?? (() => {}),
      signal,
    );
    yield { type: 'done', payload: result.payload, message: result.message };
    return;
  }

  if (HTML_KINDS.has(artifact.kind)) {
    if (!(artifact.payload.html ?? '').trim()) {
      throw new LlmError('This artifact has no document to refine.');
    }
    yield* streamHtmlRefinement(cfg, artifact, instruction, signal);
    return;
  }

  throw new LlmError(`Unknown artifact kind ${JSON.stringify(artifact.kind)}.`);
}

/** Convenience wrapper: run a refinement and hand every event to a callback.
 *  Resolves with the final payload (undefined = the model answered but
 *  changed nothing). */
export async function refineArtifactToCallback(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  onEvent: (ev: RefineEvent) => void,
  signal?: AbortSignal,
): Promise<PendingOutcome> {
  const outcome: PendingOutcome = {};
  try {
    for await (const ev of refineArtifact(cfg, artifact, instruction, signal, onEvent)) {
      if (ev.type === 'done') {
        outcome.payload = ev.payload;
        outcome.message = ev.message;
        if (ev.payload) {
          outcome.artifact = { ...artifact, ...(ev.payload as object) } as Artifact;
        }
        continue;
      }
      if (ev.type === 'error') {
        outcome.error = ev.detail;
        continue;
      }
      onEvent(ev);
    }
  } catch (e) {
    if (signal?.aborted) {
      outcome.aborted = true;
    } else {
      outcome.error = e instanceof Error ? e.message : String(e);
    }
  }
  return outcome;
}

export interface PendingOutcome {
  /** The artifact's payload as returned by the model's 'done' event. */
  payload?: Artifact['payload'];
  /** The full updated artifact — carries a refreshed title/analysis for
   *  scenario refinements. */
  artifact?: Artifact;
  message?: string;
  error?: string;
  aborted?: boolean;
}

export type { CompletionEvent };
