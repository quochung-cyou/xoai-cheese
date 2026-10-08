import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { completeChat } from '../lib/llm';
import {
  endpointUrl,
  isConfigured,
  loadLLMConfig,
  saveAnalyzeHotkey,
  saveLLMConfig,
  type LLMConfig,
} from '../lib/settings';

const inputCls =
  'h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

const labelCls = 'text-xs font-medium text-foreground';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Model + key settings. Everything lives in localStorage, with build-time
 *  env values as the starting point. */
export default function SettingsDialog({
  open,
  onClose,
  onSaved,
  hotkey,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (cfg: LLMConfig) => void;
  hotkey: string;
}) {
  const [cfg, setCfg] = useState<LLMConfig>(() => loadLLMConfig());
  const [key, setKey] = useState(hotkey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Re-read on open so env/localStorage edits elsewhere show up.
  useEffect(() => {
    if (open) {
      setCfg(loadLLMConfig());
      setKey(hotkey);
      setTestResult(null);
    }
  }, [open, hotkey]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (p: Partial<LLMConfig>) => setCfg((c) => ({ ...c, ...p }));

  const save = () => {
    saveLLMConfig(cfg);
    saveAnalyzeHotkey(key.trim() || 'g');
    onSaved(cfg);
    onClose();
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await completeChat(cfg, 'Reply with the single word: pong', [
        { type: 'text', text: 'ping' },
      ]);
      setTestResult({ ok: true, text: `Connected — model replied "${reply.trim().slice(0, 40)}"` });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        style={{ animation: 'fade-up 180ms ease-out both' }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <KeyRound size={15} className="text-primary" />
          <h2 className="text-sm font-semibold">Model settings</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
          <Field
            label="Endpoint (base URL)"
            hint={`Chat completions URL: ${endpointUrl(cfg.base_url || '<url>')}`}
          >
            <input
              className={inputCls}
              value={cfg.base_url}
              onChange={(e) => patch({ base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </Field>

          <Field label="API key" hint="Stored in this browser only, and sent straight to the endpoint above.">
            <div className="relative">
              <input
                className={cn(inputCls, 'pr-9')}
                type={showKey ? 'text' : 'password'}
                value={cfg.api_key}
                onChange={(e) => patch({ api_key: e.target.value })}
                placeholder="sk-…"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>

          <Field
            label="Model"
            hint="Needs vision for the sketch analysis step (e.g. gpt-4o, claude-sonnet-4, gemini-2.5-flash, qwen2.5-vl)."
          >
            <input
              className={inputCls}
              value={cfg.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="gpt-4o"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Sketch matching"
            hint="How Analyze decides between a built-in template and generating a one-off simulation."
          >
            <select
              className={cn(inputCls, 'cursor-pointer')}
              value={
                cfg.scenario_fast_path === true
                  ? 'only'
                  : cfg.scenario_fast_path === false
                    ? 'never'
                    : 'auto'
              }
              onChange={(e) =>
                patch({
                  scenario_fast_path:
                    e.target.value === 'only'
                      ? true
                      : e.target.value === 'never'
                        ? false
                        : undefined,
                })
              }
            >
              <option value="auto">
                Match a built-in item first, then generate (recommended)
              </option>
              <option value="only">Only match built-in items (no generation)</option>
              <option value="never">Always generate, never match</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Analyze max tokens"
              hint="Cap for the analyze call only. Small = fast."
            >
              <input
                className={inputCls}
                type="number"
                min={256}
                value={cfg.analyze_max_tokens ?? ''}
                onChange={(e) =>
                  patch({
                    analyze_max_tokens: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="4096"
              />
            </Field>
            <Field label="Refine max tokens" hint="Raise it if sims come back cut off.">
              <input
                className={inputCls}
                type="number"
                min={256}
                value={cfg.max_tokens ?? ''}
                onChange={(e) =>
                  patch({
                    max_tokens: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="16000"
              />
            </Field>
          </div>

          <Field
            label="Match max tokens"
            hint="Cap for the classify call. A reasoning model can spend this thinking, so raise it if matching returns nothing."
          >
            <input
              className={inputCls}
              type="number"
              min={128}
              value={cfg.classify_max_tokens ?? ''}
              onChange={(e) =>
                patch({
                  classify_max_tokens: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              placeholder="1024"
            />
          </Field>

          <Field label="Temperature" hint="Unset = endpoint default.">
            <input
              className={inputCls}
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={cfg.temperature ?? ''}
              onChange={(e) =>
                patch({
                  temperature: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="default"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Reasoning effort" hint="For thinking models; off = fastest.">
              <select
                className={cn(inputCls, 'cursor-pointer')}
                value={cfg.reasoning_effort ?? ''}
                onChange={(e) =>
                  patch({
                    reasoning_effort: (e.target.value || undefined) as
                      | LLMConfig['reasoning_effort']
                      | undefined,
                  })
                }
              >
                <option value="">endpoint default</option>
                <option value="off">off</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
            <Field label="Thinking token budget" hint="Beats effort when set.">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={cfg.reasoning_max_tokens ?? ''}
                onChange={(e) =>
                  patch({
                    reasoning_max_tokens: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
                placeholder="unset"
              />
            </Field>
          </div>

          <Field
            label="Analyze hotkey"
            hint={`Press this key anywhere on the board to analyze. Single letters or keys like F2.`}
          >
            <input
              className={inputCls}
              value={key}
              onChange={(e) => setKey(e.target.value.slice(0, 12))}
              placeholder="g"
              spellCheck={false}
            />
          </Field>

          {testResult && (
            <p
              className={cn(
                'rounded-lg px-2.5 py-2 text-[11px] leading-snug',
                testResult.ok
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              {testResult.text}
            </p>
          )}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Deployments can pre-fill these with <code className="font-mono">VITE_LLM_BASE_URL</code>,{' '}
            <code className="font-mono">VITE_LLM_MODEL</code> and{' '}
            <code className="font-mono">VITE_LLM_API_KEY</code> (see{' '}
            <code className="font-mono">.env.example</code>); whatever you save here wins.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
            {testing && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            Test connection
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {isConfigured(cfg) ? 'Ready' : 'Endpoint, model and key required'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
