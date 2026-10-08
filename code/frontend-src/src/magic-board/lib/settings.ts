/**
 * Magic Board settings — where the model credentials actually come from.
 *
 * Two layers, in priority order:
 *  1. localStorage  — whatever the user typed in the in-app Settings dialog.
 *  2. build-time env — VITE_LLM_API_KEY / VITE_LLM_BASE_URL / VITE_LLM_MODEL,
 *     so a deployment can ship with a key already filled in ("key can be
 *     filled from our side") and the dialog still works as an override.
 *
 * Nothing here is a backend: these values are read in the browser and sent
 * straight to the model endpoint the user configured.
 */

export interface LLMConfig {
  /** Endpoint root or full chat URL, e.g. https://api.openai.com/v1. */
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** Token ceiling for the analyze call only. The analyze document is short,
   *  so a tight cap is what keeps it fast; the reference ai4edu flow capped its
   *  helper calls the same way. Refine keeps using `max_tokens`. */
  analyze_max_tokens?: number;
  /** off | low | medium | high — sent as OpenRouter/OpenAI-style reasoning. */
  reasoning_effort?: 'off' | 'low' | 'medium' | 'high';
  /** Exact thinking-token budget; beats reasoning_effort when both set. */
  reasoning_max_tokens?: number;
  /** Text injected before the end-of-thinking tag when the budget runs out
   *  (llama.cpp only — ignored elsewhere). */
  reasoning_budget_message?: string;
}

const STORAGE_KEY = 'magic-board.llm-config';
const HOTKEY_KEY = 'magic-board.analyze-hotkey';

/**
 * Build-time env, read defensively.
 *
 * Vite replaces `import.meta.env` with an object literal, but the property
 * access has to survive being imported outside a Vite bundle (the script
 * harnesses) where `import.meta.env` is undefined.
 */
function envVar(name: string): string {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === 'string' ? value : '';
}

/** Build-time defaults. Empty strings stay empty so the dialog reports the
 *  gap honestly instead of pretending a key exists. */
export const ENV_DEFAULTS: LLMConfig = {
  base_url: envVar('VITE_LLM_BASE_URL'),
  api_key: envVar('VITE_LLM_API_KEY'),
  model: envVar('VITE_LLM_MODEL'),
};

const DEFAULT_CONFIG: LLMConfig = {
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o',
  temperature: undefined,
  max_tokens: 16000,
  // Small on purpose: the analyze document is short, and a tight cap makes it
  // come back fast. Raise it if a simulation comes back truncated.
  analyze_max_tokens: 4096,
  // Env values win over the literal defaults, per-field.
  ...(ENV_DEFAULTS.base_url ? { base_url: ENV_DEFAULTS.base_url } : {}),
  ...(ENV_DEFAULTS.api_key ? { api_key: ENV_DEFAULTS.api_key } : {}),
  ...(ENV_DEFAULTS.model ? { model: ENV_DEFAULTS.model } : {}),
};

/** Normalize a user-pasted endpoint into a full chat-completions URL.
 *  - 'https://api.openai.com/v1'                -> .../v1/chat/completions
 *  - 'https://host/api/v1/chat'                 -> kept as-is
 *  - 'https://host/api/v1/chat/completions'     -> kept as-is
 */
export function endpointUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '');
  if (b.endsWith('/chat') || b.endsWith('/chat/completions')) return b;
  return `${b}/chat/completions`;
}

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(raw) as Partial<LLMConfig>;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveLLMConfig(cfg: LLMConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** True when the board has everything it needs to make a call. */
export function isConfigured(cfg: LLMConfig): boolean {
  return Boolean(cfg.base_url.trim() && cfg.model.trim() && cfg.api_key.trim());
}

/** Short label for the composer's settings chip / status pill. */
export function modelLabel(cfg: LLMConfig): string {
  if (!cfg.model.trim()) return 'no model set';
  const host = (() => {
    try {
      return new URL(cfg.base_url).host;
    } catch {
      return cfg.base_url || 'no endpoint';
    }
  })();
  return `${cfg.model} · ${host}`;
}

// ---- Analyze hotkey ------------------------------------------------------

const DEFAULT_HOTKEY = 'g';

/** Stored as KeyboardEvent.key (single char lowercased, or named keys like
 *  'F2', 'Enter'). Empty/whitespace falls back to the default. */
export function loadAnalyzeHotkey(): string {
  try {
    const raw = localStorage.getItem(HOTKEY_KEY);
    return raw && raw.trim() ? raw : DEFAULT_HOTKEY;
  } catch {
    return DEFAULT_HOTKEY;
  }
}

export function saveAnalyzeHotkey(key: string): void {
  localStorage.setItem(HOTKEY_KEY, key);
}

export { DEFAULT_CONFIG, DEFAULT_HOTKEY };
