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

/** Cài đặt mô hình (model) + khóa API (API key). Mọi thứ nằm trong
 *  localStorage, với giá trị env lúc build làm điểm khởi đầu. */
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

  // Đọc lại mỗi lần mở để các thay đổi env/localStorage ở nơi khác hiện ra.
  useEffect(() => {
    if (open) {
      setCfg(loadLLMConfig());
      setKey(hotkey);
      setTestResult(null);
    }
  }, [open, hotkey]);

  // Nhấn Escape để đóng.
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
      setTestResult({
        ok: true,
        text: `Đã kết nối — mô hình (model) trả lời "${reply.trim().slice(0, 40)}"`,
      });
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
          <h2 className="text-sm font-semibold">Cài đặt mô hình</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Đóng"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
          <Field
            label="Điểm cuối (endpoint, base URL)"
            hint={`URL chat completions: ${endpointUrl(cfg.base_url || '<url>')}`}
          >
            <input
              className={inputCls}
              value={cfg.base_url}
              onChange={(e) => patch({ base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </Field>

          <Field label="Khóa API (API key)" hint="Chỉ được lưu trong trình duyệt này và gửi thẳng tới điểm cuối (endpoint) ở trên.">
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
                title={showKey ? 'Ẩn khóa' : 'Hiện khóa'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>

          <Field
            label="Mô hình (model)"
            hint="Cần khả năng thị giác (vision) cho bước phân tích bản phác thảo (ví dụ: gpt-4o, claude-sonnet-4, gemini-2.5-flash, qwen2.5-vl)."
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
            label="Khớp bản phác thảo"
            hint="Cách Phân tích quyết định giữa một mẫu có sẵn và việc tạo một mô phỏng dùng một lần."
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
                Khớp một mục có sẵn trước, sau đó mới tạo (khuyến nghị)
              </option>
              <option value="only">Chỉ khớp các mục có sẵn (không tạo mới)</option>
              <option value="never">Luôn tạo mới, không bao giờ khớp</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Token tối đa cho Phân tích"
              hint="Giới hạn chỉ cho lệnh gọi phân tích. Nhỏ = nhanh."
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
            <Field label="Token tối đa cho Tinh chỉnh" hint="Tăng lên nếu mô phỏng trả về bị cắt cụt.">
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
            label="Token tối đa cho Khớp"
            hint="Giới hạn cho lệnh gọi phân loại (classify). Mô hình suy luận có thể dùng phần này để suy nghĩ, nên hãy tăng lên nếu việc khớp không trả về gì."
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

          <Field label="Nhiệt độ (temperature)" hint="Không đặt = mặc định của điểm cuối (endpoint).">
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
            <Field label="Mức suy luận (reasoning effort)" hint="Dành cho mô hình có suy luận; tắt = nhanh nhất.">
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
                <option value="">mặc định của điểm cuối (endpoint)</option>
                <option value="off">tắt</option>
                <option value="low">thấp</option>
                <option value="medium">trung bình</option>
                <option value="high">cao</option>
              </select>
            </Field>
            <Field label="Ngân sách token suy luận" hint="Được ưu tiên hơn mức suy luận khi đã đặt.">
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
            label="Phím tắt Phân tích"
            hint={`Nhấn phím này ở bất kỳ đâu trên bảng để phân tích. Một chữ cái hoặc các phím như F2.`}
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
            Mọi thứ chạy trong trình duyệt của bạn. Cài đặt được lưu vào bộ nhớ
            cục bộ (local storage) của trình duyệt này và gửi thẳng tới điểm
            cuối (endpoint) của bạn — không có máy chủ nào, và không có khóa
            nào được nhúng sẵn trong ứng dụng.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
            {testing && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            Kiểm tra kết nối
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {isConfigured(cfg)
              ? 'Sẵn sàng'
              : 'Cần có điểm cuối (endpoint), mô hình (model) và khóa API (API key)'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Hủy
            </Button>
            <Button size="sm" onClick={save}>
              Lưu
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
