/**
 * Scenario registry — the ai4edu "quick-render" catalog, ported to run with no
 * backend.
 *
 * In ai4edu this was `backend/app/scenarios.py`: a file-based registry that
 * discovered `<id>.json` (metadata + param spec) next to `<id>.html` (a
 * template with `__PARAMS__`), then normalized params, rendered the template,
 * and derived a title/analysis. Everything server-side is gone here, so the
 * same pipeline runs in the browser against files in `public/mb-assets/`.
 *
 * Templates are fetched on demand rather than bundled: 25 of them are ~9-40 KB
 * of HTML each, and there is no reason to ship them in the JS graph.
 */
import type { Artifact, ArtifactAnalysis } from './types';

/**
 * Root of the copied asset tree. Override for a sub-path deployment.
 *
 * Read defensively: Vite substitutes the literal, but the property access has
 * to survive being imported outside a bundle (the script harnesses), where
 * `import.meta.env` does not exist.
 */
function envAssetBase(): string | undefined {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.VITE_MB_ASSET_BASE;
  return typeof value === 'string' && value ? value : undefined;
}

const ASSET_BASE = envAssetBase() ?? '/mb-assets';

export interface ScenarioMeta {
  id: string;
  match?: string;
  /** Human-readable param spec (only used by the model prompt in ai4edu). */
  params?: string;
  required_params?: string[];
  param_defaults?: Record<string, unknown>;
  title_template?: string;
  analysis?: {
    details_file?: string;
    key_param?: string;
    require_resolved?: boolean;
    observation_template?: string;
    notes_fields?: string[];
  };
}

export interface InstantiatedScenario {
  scenario: string;
  params: Record<string, unknown>;
  html: string;
  title: string;
  analysis: ArtifactAnalysis | null;
  /** False when a `require_resolved` lookup found nothing for the key param. */
  resolved: boolean;
}

// ------------------------------------------------------------------ loading

const metaCache = new Map<string, ScenarioMeta | null>();
const templateCache = new Map<string, string>();/** The scenario ids exported into `public/mb-assets/scenarios/`. Kept explicit
 *  so the catalog can be typed and a missing file is a clear error rather than
 *  a silent 404 at spawn time. `book` is excluded: its reader needs PDFs that
 *  are not in the repository. */
export const SCENARIO_IDS = [
  'anatomy_3d',
  'backprop',
  'bubble_sort',
  'cone',
  'conv_pipeline',
  'cylinder',
  'function_plot',
  'gaussian',
  'helix',
  'hyperboloid',
  'knot',
  'lathe',
  'matrix_mult',
  'mobius',
  'neural_network',
  'paraboloid',
  'pendulum',
  'platonic',
  'projectile',
  'rc_circuit',
  'saddle',
  'sphere',
  'tetrahedron',
  'torus',
  'wave',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export function asset(path: string): string {
  return `${ASSET_BASE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function getMeta(id: string): Promise<ScenarioMeta | null> {
  if (metaCache.has(id)) return metaCache.get(id) ?? null;
  try {
    const res = await fetch(asset(`scenarios/${id}.json`));
    if (!res.ok) throw new Error(`${res.status}`);
    const meta = (await res.json()) as ScenarioMeta;
    metaCache.set(id, meta);
    return meta;
  } catch {
    metaCache.set(id, null);
    return null;
  }
}

async function loadTemplate(id: string): Promise<string> {
  const cached = templateCache.get(id);
  if (cached) return cached;
  const res = await fetch(asset(`scenarios/${id}.html`));
  if (!res.ok) throw new Error(`Scenario template "${id}" is missing (${res.status}).`);
  const html = await res.text();
  templateCache.set(id, html);
  return html;
}

/** Re-render a template with new params (used by the scenario refine path,
 *  which merges a params patch and needs the fresh document). */
export async function rerender(
  id: string,
  params: Record<string, unknown>,
): Promise<string> {
  return renderTemplate(await loadTemplate(id), params);
}

// ------------------------------------------------------------------- render

/**
 * Merge spawn-time params over the scenario's defaults and check that every
 * required param is present. Returns null when the scenario is unknown or a
 * required param has no value (the caller falls back to full generation).
 */
export function normalizeParams(
  meta: ScenarioMeta | null,
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const merged: Record<string, unknown> = { ...(meta.param_defaults ?? {}) };
  if (params && typeof params === 'object') Object.assign(merged, params);
  for (const key of meta.required_params ?? []) {
    if (merged[key] === undefined || merged[key] === null) return null;
  }
  return merged;
}

/** Inject params into the template. `JSON.stringify` keeps the substituted
 *  value safe inside the template's `const PARAMS = __PARAMS__;` literal. */
export function renderTemplate(html: string, params: Record<string, unknown>): string {
  return html.replace('__PARAMS__', JSON.stringify(params));
}

// ------------------------------------------------------- analysis / titles

interface StructureEntry {
  meshId?: string;
  name?: string;
  system?: string;
  conceptName?: string;
  description?: string;
  summary?: string;
  region?: string;
  type?: string;
}
interface ConceptEntry {
  name?: string;
  elements?: string[];
}
export interface DetailsData {
  structures?: Record<string, StructureEntry>;
  entries?: Record<string, StructureEntry>;
  concepts?: Record<string, ConceptEntry>;
  aliases?: Record<string, unknown>;
  systems?: Record<string, string[]>;
  systemColors?: Record<string, string>;
}

const detailsCache = new Map<string, Promise<DetailsData | null>>();

export function loadDetails(rel: string): Promise<DetailsData | null> {
  if (!detailsCache.has(rel)) {
    detailsCache.set(
      rel,
      fetch(asset(rel))
        .then((r) => (r.ok ? (r.json() as Promise<DetailsData>) : null))
        .catch(() => null),
    );
  }
  return detailsCache.get(rel)!;
}

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Port of ai4edu's `_resolve_term`: free text -> matching entry keys, plus a
 *  flag for whether the term means anything at all in this data set. */
export function resolveTerm(
  data: DetailsData,
  term: string,
): { keys: string[]; recognized: boolean } {
  const entries = data.structures ?? data.entries ?? {};
  const aliases = data.aliases ?? {};
  const concepts = data.concepts ?? {};
  const conceptByName = new Map<string, ConceptEntry>();
  for (const c of Object.values(concepts)) {
    if (c?.name) conceptByName.set(c.name.toLowerCase(), c);
  }

  const t = term.trim().toLowerCase();
  const key = t.replace(/ /g, '_');
  if (key in entries) return { keys: [key], recognized: true };

  const apply = (spec: Record<string, unknown>): string[] => {
    const out: string[] = [];
    for (const cid of asList(spec.concept)) {
      const c =
        concepts[String(cid)] ?? conceptByName.get(String(cid).toLowerCase());
      if (c) out.push(...(c.elements ?? []).filter((e) => e in entries));
    }
    for (const sys of asList(spec.system)) {
      for (const [k, e] of Object.entries(entries)) {
        if (e.system === sys) out.push(k);
      }
    }
    for (const sub of asList(spec.substr)) {
      for (const [k, e] of Object.entries(entries)) {
        if (String(e.name ?? '').toLowerCase().includes(String(sub).toLowerCase())) {
          out.push(k);
        }
      }
    }
    for (const m of asList(spec.mesh)) if (String(m) in entries) out.push(String(m));
    return out;
  };

  const spec = aliases[t] ?? aliases[key];
  if (typeof spec === 'string') {
    return { keys: spec in entries ? [spec] : [], recognized: true };
  }
  if (spec && typeof spec === 'object') {
    return { keys: apply(spec as Record<string, unknown>), recognized: true };
  }

  const c = conceptByName.get(t);
  if (c) {
    return { keys: (c.elements ?? []).filter((e) => e in entries), recognized: true };
  }

  const hits = Object.entries(entries)
    .filter(([, e]) => t && String(e.name ?? '').toLowerCase().includes(t))
    .map(([k]) => k);
  return { keys: hits, recognized: hits.length > 0 };
}

/** Naive `{key}` substitution — `String.format`-style templates with stray
 *  braces would explode a real formatter, and params are model-shaped. */
function fill(template: string, values: Record<string, unknown>): string {
  let out = template;
  for (const [k, v] of Object.entries(values)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/**
 * Params -> (analysis, title, resolved) for a scenario's `analysis` /
 * `title_template` blocks. The details-file lookup maps a free-text param to
 * named entries so the title can read "Anatomy: Heart" without the model.
 */
export async function buildAnalysis(
  id: string,
  meta: ScenarioMeta,
  params: Record<string, unknown>,
): Promise<{ analysis: ArtifactAnalysis | null; title: string; resolved: boolean }> {
  const spec = meta.analysis ?? {};
  const keyParam = spec.key_param;
  const values: Record<string, unknown> = { ...params, label: '' };
  if (keyParam && params[keyParam] != null) values.label = String(params[keyParam]);

  let matched: StructureEntry[] = [];
  let resolved = true;

  const details = spec.details_file ? await loadDetails(spec.details_file) : null;
  if (details && keyParam && values.label) {
    const { keys, recognized } = resolveTerm(details, String(values.label));
    const entries = details.structures ?? details.entries ?? {};
    matched = keys.map((k) => entries[k]).filter((e): e is StructureEntry => !!e);
    resolved = matched.length > 0 || recognized;
  }

  const observation: string[] = [];
  if (spec.observation_template) {
    observation.push(fill(spec.observation_template, values).trim());
  }
  if (matched.length) {
    const names = [...new Set(matched.map((m) => m.name).filter(Boolean))];
    values.matched_names = names.join(', ');
    let clause = `Matched: ${names.join(', ')}`;
    if (matched[0]!.region) clause += ` (${String(matched[0]!.region).replace(/_/g, ' ')})`;
    observation.push(clause + '.');
    const summary = matched[0]!.summary ?? matched[0]!.description;
    if (summary) observation.push(String(summary));
  }

  const notes: string[] = [];
  if (details && keyParam && values.label && !matched.length && !resolved) {
    notes.push(`"${String(values.label)}" is not in the bundled model set.`);
  }
  for (const field of spec.notes_fields ?? []) {
    const vals = matched
      .map((m) => (m as Record<string, unknown>)[field])
      .filter((v): v is string => typeof v === 'string' && !!v);
    if (vals.length) notes.push(vals.slice(0, 3).join('\n\n'));
  }

  const analysis: ArtifactAnalysis | null =
    observation.length || notes.length
      ? {
          observation: observation.filter(Boolean).join(' ').trim(),
          derived_models: [],
          notes: notes.join('\n\n').trim(),
        }
      : null;

  let title = meta.title_template
    ? fill(meta.title_template, values)
    : id.replace(/_/g, ' ');
  title = title.trim().replace(/:$/, '') || id.replace(/_/g, ' ');

  // A missing/empty key param means "whole model", which always resolves.
  if (spec.require_resolved) {
    const label = keyParam ? String(params[keyParam] ?? '').trim() : '';
    resolved = resolved || !label;
  }

  return { analysis, title, resolved };
}

// -------------------------------------------------------------- entry point

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}

/**
 * One call for the picker path: normalize params, render the template, derive
 * title + analysis. Throws ScenarioError with a user-facing message.
 */
export async function instantiate(
  id: string,
  params: Record<string, unknown> = {},
): Promise<InstantiatedScenario> {
  const meta = await getMeta(id);
  if (!meta) throw new ScenarioError(`Unknown item "${id}".`);
  const merged = normalizeParams(meta, params);
  if (!merged) {
    throw new ScenarioError(
      `"${id}" needs ${(meta.required_params ?? []).join(', ')} — which the picker did not supply.`,
    );
  }
  const html = renderTemplate(await loadTemplate(id), merged);
  const { analysis, title, resolved } = await buildAnalysis(id, meta, merged);
  return { scenario: id, params: merged, html, title, analysis, resolved };
}

/** Turn an instantiated scenario into a board artifact ready to place. */
export function scenarioArtifact(inst: InstantiatedScenario): Artifact {
  return {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    kind: 'scenario',
    title: inst.title,
    source_element_ids: [],
    payload: {
      scenario: inst.scenario,
      params: inst.params,
      html: inst.html,
    },
    analysis: inst.analysis,
    updated_at: new Date().toISOString(),
  };
}

export { ASSET_BASE };