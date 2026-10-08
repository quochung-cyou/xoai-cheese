/**
 * LLM client for the Magic Board — the entire "backend" of the original
 * ai4edu app, reduced to what the browser actually needs.
 *
 * What moved here from the FastAPI service:
 *  - provider adapter (OpenAI-style /chat/completions) — one plain POST per
 *    call, no SSE
 *  - the analyze pipeline (vision prompt -> JSON -> artifact)
 *  - the refine pipeline (model response -> SEARCH/REPLACE scanner -> payload)
 *
 * Prompts and pipeline stages are unchanged from the reference; only the
 * transport differs. The refine scanner already handles a whole response
 * arriving at once, so feeding it a single event is equivalent to the old
 * token stream — the UI simply updates in one step instead of progressively.
 *
 * What was deliberately dropped: scenario classification + template
 * retrieval, embeddings, Gemini's native API, SQLite persistence, auth.
 * The board calls the model endpoint directly with the user's own key.
 */
import { endpointUrl, type LLMConfig } from './settings';
import { PROMPT_ANALYZE_USER, PROMPT_SIMULATION } from './prompts';
import type { Artifact, ArtifactAnalysis, SkeletonElement } from './types';

// ---------------------------------------------------------------- errors

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** Turn a fetch/HTTP failure into something a human can act on. */
function explainFailure(status: number, bodyText: string, url: string): string {
  let detail = bodyText.slice(0, 300);
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    const msg = parsed.error?.message ?? parsed.message;
    if (typeof msg === 'string' && msg) detail = msg;
  } catch {
    /* non-JSON error body */
  }
  if (status === 401 || status === 403) {
    return `The endpoint rejected the API key (${status}). Check it in Settings. — ${detail}`;
  }
  if (status === 404) {
    return `No model endpoint at ${url} (404). Check the base URL and model name. — ${detail}`;
  }
  if (status === 429) {
    return `Rate limited or out of quota (429). — ${detail}`;
  }
  return `Endpoint ${url} returned ${status}: ${detail}`;
}

/** Fetch that explains a CORS/network failure instead of surfacing
 *  "TypeError: Failed to fetch", which tells the user nothing. */
async function postJson(
  cfg: LLMConfig,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const url = endpointUrl(cfg.base_url);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new LlmError(
      `Could not reach ${url}. Either the network is down, the URL is wrong, ` +
        `or the endpoint blocks browser requests (CORS) — a local model ` +
        `server needs --cors/Origin enabled. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(explainFailure(res.status, text, url), res.status);
  }
  return res;
}

// ------------------------------------------------------------- json parse

/** Parse an LLM JSON response, tolerating markdown fences, the common
 *  invalid escape sequences models emit, and prose around the object. */
export function parseLlmJson(text: string | null | undefined): unknown {
  if (!text) throw new LlmError('The model returned an empty response.');
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  clean = clean.replace(/\\_/g, '_').replace(/\\'/g, "'");
  try {
    return JSON.parse(clean);
  } catch {
    /* fall through to the brace-scanning attempt */
  }
  // Long HTML inside JSON is a common truncation point; try the outermost
  // object before giving up.
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = clean.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      throw new LlmError(
        `The model's response was not valid JSON (${e instanceof Error ? e.message : e}). ` +
          'If it keeps happening the output is probably being cut off — raise max tokens in Settings.',
      );
    }
  }
  throw new LlmError('The model returned data in an unexpected shape.');
}

// ------------------------------------------------------------- completion

/**
 * One completion event. Every call is a single POST, so there is exactly one
 * `output` and at most one `thinking` — the shape is kept because the refine
 * pipeline (marker scanner + reducers) consumes these and is unchanged from
 * the ai4edu reference.
 */
export interface CompletionEvent {
  kind: 'thinking' | 'output';
  delta: string;
}

/**
 * Reasoning text in a NON-streaming response message. OpenRouter normalizes
 * provider shapes onto `reasoning` / `reasoning_content` (strings) or
 * `reasoning_details[]` ({text|summary}). Prefer the flat fields so a provider
 * that sets both does not have every token reported twice.
 */
function reasoningText(message: Record<string, unknown>): string {
  for (const key of ['reasoning', 'reasoning_content']) {
    const val = message[key];
    if (typeof val === 'string' && val) return val;
  }
  const details = message.reasoning_details;
  if (Array.isArray(details)) {
    const out: string[] = [];
    for (const det of details) {
      if (!det || typeof det !== 'object') continue;
      const d = det as Record<string, unknown>;
      const piece = d.text ?? d.summary;
      if (typeof piece === 'string' && piece) out.push(piece);
    }
    return out.join('');
  }
  return '';
}

/** Content from a non-streaming choice. Some gateways hand back an array of
 *  parts instead of a plain string. */
function contentText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          return typeof p.text === 'string' ? p.text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** Build the request payload for one chat call. Generation knobs are only
 *  sent when configured — unknown fields are ignored by most endpoints.
 *
 *  `stream` is always false: these are plain request/response POSTs. */
export function buildPayload(
  cfg: LLMConfig,
  systemPrompt: string,
  content: unknown[],
  opts: { jsonMode: boolean; maxTokens?: number },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
  };
  if (opts.jsonMode) payload.response_format = { type: 'json_object' };
  if (cfg.temperature != null) payload.temperature = cfg.temperature;
  const maxTokens = opts.maxTokens ?? cfg.max_tokens;
  if (maxTokens != null) payload.max_tokens = maxTokens;
  if (cfg.top_p != null) payload.top_p = cfg.top_p;
  if (cfg.reasoning_max_tokens != null) {
    // Explicit budget beats the effort shorthand (OpenRouter treats them as
    // mutually exclusive). The extra fields are llama.cpp per-request
    // overrides and are harmless elsewhere.
    payload.reasoning = { max_tokens: cfg.reasoning_max_tokens };
    payload.thinking_budget_tokens = cfg.reasoning_max_tokens;
    payload.reasoning_budget_tokens = cfg.reasoning_max_tokens;
  } else if (cfg.reasoning_effort) {
    payload.reasoning =
      cfg.reasoning_effort === 'off'
        ? { enabled: false }
        : { effort: cfg.reasoning_effort };
  }
  if (cfg.reasoning_budget_message) {
    payload.reasoning_budget_message = cfg.reasoning_budget_message;
  }
  return payload;
}

export interface ChatResult {
  /** The model's output text. */
  text: string;
  /** Reasoning/thinking, when the endpoint returns it. */
  thinking: string;
}

/**
 * Pull `{ text, thinking }` out of a non-streaming chat-completions body.
 *
 * Pure and exported so the wire contract can be tested without a browser.
 * Handles the three shapes that show up in practice: a plain string content, an
 * array of content parts, and a `finish_reason` of `length` (the tell-tale of
 * a budget that was too small).
 */
export function parseChatResponse(body: unknown): ChatResult {
  if (!body || typeof body !== 'object') {
    throw new LlmError('The endpoint returned an unexpected body.');
  }
  const b = body as Record<string, unknown>;

  // Endpoints report failures in the body even with a 200 status.
  if (b.error) {
    const raw = b.error;
    const msg =
      raw && typeof raw === 'object'
        ? ((raw as Record<string, unknown>).message ?? JSON.stringify(raw))
        : String(raw);
    throw new LlmError(`The endpoint returned an error: ${msg}`);
  }

  const choices = b.choices;
  if (!Array.isArray(choices) || !choices.length) {
    throw new LlmError('The endpoint returned no choices.');
  }
  const choice = choices[0] as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const finish = choice.finish_reason;
  const text = contentText(message);
  const thinking = reasoningText(message);

  if (!text.trim()) {
    // A truncated response is the common cause: the model spent the whole
    // budget thinking, or the document did not fit.
    if (finish === 'length') {
      throw new LlmError(
        'The response was cut off before any output — raise max tokens in Settings.',
      );
    }
    throw new LlmError(
      'The model returned nothing. A reasoning model can burn its whole ' +
        'token budget thinking — raise max tokens in Settings and try again.',
    );
  }
  return { text, thinking };
}

/**
 * One plain POST to the chat endpoint and the whole answer back.
 *
 * No SSE, no incremental framing: the response arrives as a single JSON body
 * (`choices[0].message`). Reasoning, when the endpoint reports it, is returned
 * alongside rather than discarded so the refine UI can still show it.
 */
export async function chat(
  cfg: LLMConfig,
  systemPrompt: string,
  content: unknown[],
  opts: { jsonMode: boolean; maxTokens?: number },
  signal?: AbortSignal,
): Promise<ChatResult> {
  const payload = buildPayload(cfg, systemPrompt, content, opts);
  const res = await postJson(cfg, payload, signal);

  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    throw new LlmError(
      `The endpoint returned a non-JSON body (${e instanceof Error ? e.message : e}).`,
    );
  }
  return parseChatResponse(body);
}

/**
 * Adapter that presents the single POST response as the event sequence the
 * refine pipeline consumes. The pipeline itself (marker scanner, edit
 * validation, element ops) stays exactly what it was — only the transport
 * changed from SSE to one plain request/response.
 */
export async function* completeChatEvents(
  cfg: LLMConfig,
  systemPrompt: string,
  content: unknown[],
  opts: { jsonMode: boolean; maxTokens?: number },
  signal?: AbortSignal,
): AsyncGenerator<CompletionEvent> {
  const result = await chat(cfg, systemPrompt, content, opts, signal);
  if (result.thinking) yield { kind: 'thinking', delta: result.thinking };
  yield { kind: 'output', delta: result.text };
}

/** Buffered call for callers that don't need reasoning (analyze). */
export async function completeChat(
  cfg: LLMConfig,
  systemPrompt: string,
  content: unknown[],
  signal?: AbortSignal,
  maxTokens?: number,
): Promise<string> {
  const result = await chat(
    cfg,
    systemPrompt,
    content,
    { jsonMode: true, maxTokens },
    signal,
  );
  return result.text;
}

// ---------------------------------------------------------------- analyze

export interface AnalyzeRequest {
  /** PNG of the sketch, base64 without the data-URL prefix. */
  imageBase64: string;
  mimeType?: string;
  sourceElementIds: string[];
}

function isValidSkeletonElement(el: unknown): el is SkeletonElement {
  if (!el || typeof el !== 'object') return false;
  const o = el as Record<string, unknown>;
  if (typeof o.type !== 'string' || !o.type) return false;
  for (const k of ['x', 'y']) {
    const v = o[k];
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
  }
  return true;
}

/**
 * One analyze pass: sketch image in, artifact out. Plain POST, one response.
 *
 * The prompt and the pipeline are unchanged from the ai4edu reference; only the
 * transport differs. `maxTokens` lets callers hold the response to a small
 * budget — the analyze document is short, so a tight cap is what makes it feel
 * instant.
 */
export async function analyzeSketch(
  cfg: LLMConfig,
  req: AnalyzeRequest,
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<Artifact> {
  const content = [
    {
      type: 'image_url',
      image_url: {
        url: `data:${req.mimeType ?? 'image/png'};base64,${req.imageBase64}`,
      },
    },
    { type: 'text', text: PROMPT_ANALYZE_USER },
  ];

  const raw = await completeChat(
    cfg,
    PROMPT_SIMULATION,
    content,
    signal,
    maxTokens,
  );
  const gen = parseLlmJson(raw);
  if (!gen || typeof gen !== 'object') {
    throw new LlmError('The model returned data in an unexpected shape.');
  }
  const g = gen as Record<string, unknown>;

  let kind: Artifact['kind'] = g.kind as Artifact['kind'];
  if (kind !== 'html_sim' && kind !== 'elements') {
    // Backwards-tolerant fallback: a model that ignored the schema but
    // produced an HTML doc is still an html_sim.
    if (typeof g.simulation_code === 'string' && g.simulation_code) {
      kind = 'html_sim';
      g.html = g.simulation_code;
    } else if (typeof g.html === 'string' && g.html) {
      kind = 'html_sim';
    } else {
      throw new LlmError(
        'The model did not return a simulation or a diagram. Try analyzing again.',
      );
    }
  }

  let analysis: ArtifactAnalysis;
  try {
    analysis = {
      observation: String(g.observation ?? ''),
      derived_models: Array.isArray(g.derived_models)
        ? (g.derived_models as ArtifactAnalysis['derived_models'])
        : [],
      notes: String(g.notes ?? ''),
    };
  } catch {
    analysis = { observation: String(g.observation ?? ''), derived_models: [], notes: '' };
  }

  let payload: Artifact['payload'];
  if (kind === 'elements') {
    const rawElements = Array.isArray(g.elements) ? g.elements : [];
    const elements = rawElements.filter(isValidSkeletonElement);
    if (!elements.length) {
      throw new LlmError(
        'The model chose diagram output but returned no usable elements. Try analyzing again.',
      );
    }
    payload = { elements };
  } else {
    const html = g.html;
    if (typeof html !== 'string' || !html.trim()) {
      throw new LlmError(
        'The model returned an empty simulation document. Try analyzing again.',
      );
    }
    payload = { html };
  }

  const title =
    String(g.title ?? '').trim() || (kind === 'elements' ? 'Diagram' : 'Simulation');

  return {
    id: newId(),
    kind,
    title,
    source_element_ids: req.sourceElementIds,
    payload,
    analysis,
    updated_at: new Date().toISOString(),
  };
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
