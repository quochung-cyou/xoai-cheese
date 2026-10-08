/**
 * Refining a scenario artifact.
 *
 * Port of ai4edu's `_stream_scenario_refinement`: a scenario is a template plus
 * named params, so the model does not edit code — it emits a params patch, the
 * patch is merged over the current params, the template is re-rendered, and the
 * new html/params/title/analysis become the artifact payload.
 *
 * Nothing here knows what any individual scenario is about, so new catalog
 * entries get this path for free.
 */
import { LlmError, parseLlmJson, completeChatEvents } from './llm';
import { PROMPT_REFINE_SCENARIO } from './prompts';
import { getMeta, instantiate, loadDetails, rerender, resolveTerm } from './scenarios';
import type { ScenarioMeta } from './scenarios';
import type { LLMConfig } from './settings';
import type { Artifact, RefineEvent } from './types';

/** How many known-good values to show the model for a free-text key param. */
const SAMPLE_VALUES = 60;

/**
 * The declared spec for a scenario, plus a sample of valid values for its
 * key param. Without the sample a model asked to "show the skull" has no way
 * to know whether the atlas spells it "skull", "cranium" or "FMA46565".
 */
async function buildContext(
  meta: ScenarioMeta,
  params: Record<string, unknown>,
): Promise<string> {
  const spec = meta.analysis ?? {};
  let samples: string[] = [];
  if (spec.details_file && spec.key_param) {
    const details = await loadDetails(spec.details_file);
    if (details) {
      const concepts = details.concepts ?? {};
      const entries = details.structures ?? details.entries ?? {};
      const names = Object.values(concepts)
        .map((c) => c.name)
        .filter((n): n is string => !!n);
      // Prefer the keys the alias table actually resolves — those are the
      // strings a user would type and the resolver accepts.
      const aliasKeys = Object.keys(details.aliases ?? {});
      const recognizable = aliasKeys.filter((k) => {
        const { keys } = resolveTerm(details, k);
        return keys.length > 0;
      });
      samples = [...new Set([...recognizable, ...names])]
        .sort()
        .slice(0, SAMPLE_VALUES);
      if (!samples.length) samples = Object.keys(entries).slice(0, SAMPLE_VALUES);
    }
  }

  const payload: Record<string, unknown> = {
    scenario: meta.id ?? '',
    match: meta.match,
    params_spec: meta.params,
    current_params: params,
  };
  if (spec.key_param) payload.key_param = spec.key_param;
  if (samples.length) {
    payload.known_values_for_key_param = samples;
    payload.note =
      `"${spec.key_param}" must be one of known_values_for_key_param ` +
      '(case-insensitive); an empty string means the whole model.';
  }
  return JSON.stringify(payload, null, 2);
}

export interface ScenarioRefineResult {
  payload?: Artifact['payload'];
  message: string;
}

/**
 * Run one scenario refinement turn. Returns the new payload (absent when the
 * request could not be expressed through the template's params) and a
 * user-facing message.
 */
export async function refineScenarioArtifact(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  onEvent: (ev: RefineEvent) => void,
  signal?: AbortSignal,
): Promise<ScenarioRefineResult> {
  const scenarioId = artifact.payload.scenario;
  if (!scenarioId) {
    throw new LlmError('This artifact has no template to refine.');
  }
  const meta = await getMeta(scenarioId);
  if (!meta) {
    throw new LlmError(`Unknown template "${scenarioId}".`);
  }

  const currentParams = (artifact.payload.params ?? {}) as Record<string, unknown>;
  const context = await buildContext(meta, currentParams);

  onEvent({ type: 'status', stage: 'loading' });
  onEvent({ type: 'status', stage: 'calling-model' });

  const rawParts: string[] = [];
  for await (const ev of completeChatEvents(
    cfg,
    PROMPT_REFINE_SCENARIO,
    [
      { type: 'text', text: context },
      { type: 'text', text: `User instruction: "${instruction}"` },
    ],
    { jsonMode: false },
    signal,
  )) {
    if (ev.kind === 'thinking') {
      onEvent({ type: 'thinking', delta: ev.delta });
      continue;
    }
    // The output is raw JSON — never narrate it into the chat. The clean
    // summary arrives in the result's `message`.
    rawParts.push(ev.delta);
  }

  const parsed = parseLlmJson(rawParts.join('')) as {
    params?: unknown;
    message?: unknown;
  };
  const message = String(parsed?.message ?? '').trim();

  if (parsed?.params === null || parsed?.params === undefined) {
    // The model says this isn't expressible through the template's params —
    // report it and change nothing.
    return {
      message:
        message ||
        "That isn't expressible through this document's options — nothing changed.",
    };
  }
  if (typeof parsed.params !== 'object' || Array.isArray(parsed.params)) {
    throw new LlmError('The model returned malformed options. Try rephrasing.');
  }

  const merged = { ...currentParams, ...(parsed.params as Record<string, unknown>) };

  // Re-instantiate: normalize against the meta, re-render, and re-derive
  // title + analysis so a focus change retitles "Anatomy: heart" -> "Anatomy: brain".
  let inst;
  try {
    inst = await instantiate(scenarioId, merged);
  } catch (e) {
    return {
      message:
        message ||
        `Those options don't fit this document (${
          e instanceof Error ? e.message : String(e)
        }) — nothing changed.`,
    };
  }
  if (!inst.resolved) {
    return {
      message: message || "That isn't in this document's data — kept the current view.",
    };
  }

  return {
    message: message || `Updated ${inst.title}.`,
    payload: {
      scenario: scenarioId,
      params: inst.params,
      html: await rerender(scenarioId, inst.params),
      title: inst.title,
      analysis: inst.analysis,
    },
  };
}
