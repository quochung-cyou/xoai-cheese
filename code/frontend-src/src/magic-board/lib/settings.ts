/**
 * Magic Board settings — model credentials, supplied entirely at runtime.
 *
 * This is a pure client-side app. There is deliberately **no build-time
 * configuration**: nothing is read from `VITE_*`, so no credential is ever
 * baked into the JS bundle and every deployment ships the same artifact.
 *
 * The only layer is localStorage — whatever the user typed in the in-app
 * Settings dialog. `DEFAULT_CONFIG` just seeds the dialog's placeholders.
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
  /** Token ceiling for the classify call (the fast path). */
  classify_max_tokens?: number;
  /**
   * `undefined` (default) = try the template fast path, fall back to full
   * generation if nothing matches. `true` = the fast path is authoritative.
   * `false` = always generate.
   */
  scenario_fast_path?: boolean;
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

/** Seed values for the Settings dialog. `api_key` is always empty: a key is
 *  runtime input and must never be committed or compiled in. */
const DEFAULT_CONFIG: LLMConfig = {
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o',
  temperature: undefined,
  max_tokens: 16000,
  // Small on purpose: the analyze document is short, and a tight cap makes it
  // come back fast. Raise it if a simulation comes back truncated.
  analyze_max_tokens: 4096,
  // The classifier emits one small JSON object. A reasoning model can still
  // spend this on thinking, so it gets its own knob.
  classify_max_tokens: 1024,
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
