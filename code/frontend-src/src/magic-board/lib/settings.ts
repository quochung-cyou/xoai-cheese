/**
 * Cấu hình Bảng Ma Thuật — thông tin xác thực mô hình, hoàn toàn do người dùng
 * cung cấp lúc chạy.
 *
 * Đây là ứng dụng thuần phía máy khách (client-side). Cố ý **không có cấu hình
 * lúc build**: không đọc gì từ `VITE_*`, nên không có thông tin xác thực nào bị
 * nhúng vào gói JS và mọi bản triển khai đều phát hành cùng một sản phẩm build.
 *
 * Tầng duy nhất là localStorage — đúng những gì người dùng đã nhập trong hộp
 * thoại Cài đặt của ứng dụng. `DEFAULT_CONFIG` chỉ khởi tạo các giá trị gợi ý
 * (placeholder) cho hộp thoại đó.
 *
 * Ở đây không có backend nào: những giá trị này được đọc trong trình duyệt và
 * gửi thẳng tới điểm cuối (endpoint) mô hình mà người dùng đã cấu hình.
 */

export interface LLMConfig {
  /** Điểm cuối (endpoint) gốc hoặc URL chat đầy đủ, ví dụ https://api.openai.com/v1. */
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** Mức trần token chỉ riêng cho lời gọi phân tích. Tài liệu phân tích ngắn,
   *  nên một giới hạn chặt là thứ giữ cho nó nhanh; luồng ai4edu tham chiếu
   *  cũng giới hạn các lời gọi trợ giúp theo cách tương tự. Bước tinh chỉnh vẫn
   *  dùng `max_tokens`. */
  analyze_max_tokens?: number;
  /** Mức trần token cho lời gọi phân loại (đường nhanh). */
  classify_max_tokens?: number;
  /**
   * `undefined` (mặc định) = thử đường nhanh dùng mẫu, nếu không khớp thì quay
   * về sinh đầy đủ. `true` = đường nhanh là quyết định. `false` = luôn sinh mới.
   */
  scenario_fast_path?: boolean;
  /** off | low | medium | high — gửi theo kiểu reasoning của OpenRouter/OpenAI. */
  reasoning_effort?: 'off' | 'low' | 'medium' | 'high';
  /** Ngân sách token suy luận chính xác; đè lên reasoning_effort khi cả hai được đặt. */
  reasoning_max_tokens?: number;
  /** Văn bản chèn trước thẻ kết thúc suy luận khi hết ngân sách
   *  (chỉ llama.cpp — nơi khác bỏ qua). */
  reasoning_budget_message?: string;
}

const STORAGE_KEY = 'magic-board.llm-config';
const HOTKEY_KEY = 'magic-board.analyze-hotkey';

/** Giá trị khởi tạo cho hộp thoại Cài đặt. `api_key` luôn rỗng: khóa là dữ
 *  liệu nhập lúc chạy, không bao giờ được commit hay biên dịch vào. */
const DEFAULT_CONFIG: LLMConfig = {
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o',
  temperature: undefined,
  max_tokens: 16000,
  // Cố ý nhỏ: tài liệu phân tích ngắn, và một giới hạn chặt giúp nó
  // trả về nhanh. Tăng lên nếu mô phỏng trả về bị cụt.
  analyze_max_tokens: 4096,
  // Bộ phân loại chỉ phát ra một đối tượng JSON nhỏ. Mô hình suy luận vẫn có
  // thể tiêu vào việc suy nghĩ, nên nó có núm riêng.
  classify_max_tokens: 1024,
};

/** Chuẩn hóa điểm cuối (endpoint) do người dùng dán thành URL chat-completions
 *  đầy đủ.
 *  - 'https://api.openai.com/v1'                -> .../v1/chat/completions
 *  - 'https://host/api/v1/chat'                 -> giữ nguyên
 *  - 'https://host/api/v1/chat/completions'     -> giữ nguyên
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

/** True khi bảng đã có đủ mọi thứ cần thiết để thực hiện một lời gọi. */
export function isConfigured(cfg: LLMConfig): boolean {
  return Boolean(cfg.base_url.trim() && cfg.model.trim() && cfg.api_key.trim());
}

/** Nhãn ngắn cho chip cài đặt / viên trạng thái của ô soạn thảo. */
export function modelLabel(cfg: LLMConfig): string {
  if (!cfg.model.trim()) return 'chưa đặt mô hình';
  const host = (() => {
    try {
      return new URL(cfg.base_url).host;
    } catch {
      return cfg.base_url || 'chưa có điểm cuối (endpoint)';
    }
  })();
  return `${cfg.model} · ${host}`;
}

// ---- Phím tắt phân tích --------------------------------------------------

const DEFAULT_HOTKEY = 'g';

/** Lưu dưới dạng KeyboardEvent.key (một ký tự viết thường, hoặc tên phím như
 *  'F2', 'Enter'). Rỗng/khoảng trắng sẽ quay về giá trị mặc định. */
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
