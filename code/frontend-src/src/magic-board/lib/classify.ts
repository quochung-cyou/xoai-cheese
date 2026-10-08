/**
 * Sketch classification — the fast path of the ai4edu analyze pipeline.
 *
 * Port of `backend/app/services/analysis.py` phase 0 plus
 * `backend/prompts/classify.txt`: one cheap vision call decides whether the
 * sketch clearly matches a built-in template, and if it does, the template is
 * instantiated locally. No simulation code is generated at all.
 *
 * Why this matters beyond speed: asking a model to write a whole HTML
 * simulation in one shot makes a reasoning model spend its entire budget
 * thinking (`finish_reason: "length"`, `content: ""`, every token counted as
 * `reasoning_tokens`). Classifying is a ~100-token decision, so it answers fast
 * and cannot be starved by its own reasoning.
 *
 * Embedding-based retrieval is deliberately not ported — the catalog is small
 * enough to hand the classifier whole, exactly as ai4edu does when retrieval is
 * off.
 */
import { chat, LlmError, parseLlmJson } from './llm';
import { PROMPT_CLASSIFY } from './prompts';
import {
  buildCatalogText,
  instantiate,
  loadAllMetas,
  scenarioArtifact,
  type ClassifyHint,
} from './scenarios';
import type { LLMConfig } from './settings';
import type { Artifact } from './types';

/** Token budget for the classifier. It emits one small JSON object; the
 *  reference used 2048 and measured ~3s thinking for ~100 tokens of output. */
export const DEFAULT_CLASSIFY_MAX_TOKENS = 1024;

export interface ClassifyResult extends ClassifyHint {
  /** The template id actually matched, or null. */
  scenario: string | null;
}

/** The model's raw view of a sketch: scenario id + params + one-line caption. */
export async function classifySketch(
  cfg: LLMConfig,
  imageBase64: string,
  opts: { mimeType?: string; maxTokens?: number } = {},
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  const metas = await loadAllMetas();
  const systemPrompt = PROMPT_CLASSIFY.replace(
    '{{SCENARIOS}}',
    buildCatalogText(metas),
  );

  const content = [
    {
      type: 'image_url',
      image_url: {
        url: `data:${opts.mimeType ?? 'image/png'};base64,${imageBase64}`,
      },
    },
    { type: 'text', text: 'Classify this sketch.' },
  ];

  const { text } = await chat(
    cfg,
    systemPrompt,
    content,
    {
      jsonMode: true,
      maxTokens: opts.maxTokens ?? cfg.classify_max_tokens ?? DEFAULT_CLASSIFY_MAX_TOKENS,
    },
    signal,
  );

  const parsed = parseLlmJson(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new LlmError('The classifier returned an unexpected shape.');
  }
  const p = parsed as Record<string, unknown>;

  const rawScenario = typeof p.scenario === 'string' ? p.scenario.trim() : '';
  // Only ids we actually ship count; anything else falls back to generation.
  const scenario = rawScenario && rawScenario in metas ? rawScenario : null;

  return {
    scenario,
    params:
      p.params && typeof p.params === 'object' && !Array.isArray(p.params)
        ? (p.params as Record<string, unknown>)
        : {},
    observation: typeof p.observation === 'string' ? p.observation : '',
  };
}

/**
 * Classify, then instantiate the matched template locally.
 *
 * Returns null when the sketch does not clearly match anything, so the caller
 * can fall back to full generation (the ai4edu "generate anyway" path).
 */
export async function tryScenarioFastPath(
  cfg: LLMConfig,
  imageBase64: string,
  opts: { mimeType?: string; maxTokens?: number } = {},
  signal?: AbortSignal,
): Promise<Artifact | null> {
  const hint = await classifySketch(cfg, imageBase64, opts, signal);
  if (!hint.scenario) return null;

  const inst = await instantiate(hint.scenario, hint.params);
  // A template that cannot satisfy the sketch's params must not ship a wrong
  // viewer — fall back to generation, as the reference does.
  if (!inst.resolved) return null;

  // Lead the analysis with the classifier's own reading of the sketch, which is
  // what the user actually drew.
  if (hint.observation) {
    inst.analysis = {
      observation: inst.analysis?.observation
        ? `${hint.observation} ${inst.analysis.observation}`
        : hint.observation,
      derived_models: inst.analysis?.derived_models ?? [],
      notes: inst.analysis?.notes ?? '',
    };
  }
  return scenarioArtifact(inst);
}
