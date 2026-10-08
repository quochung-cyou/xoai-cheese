/**
 * Trình khách LLM (LLM client) cho Bảng Ma Thuật — toàn bộ "backend" của ứng
 * dụng ai4edu gốc, rút gọn còn đúng những gì trình duyệt thực sự cần.
 *
 * Những gì được chuyển từ dịch vụ FastAPI sang đây:
 *  - bộ thích ứng nhà cung cấp (provider adapter, kiểu OpenAI
 *    /chat/completions) — mỗi lời gọi là một POST đơn giản, không dùng SSE
 *  - đường ống phân tích (prompt thị giác -> JSON -> kết quả)
 *  - đường ống tinh chỉnh (phản hồi mô hình -> bộ quét SEARCH/REPLACE -> payload)
 *
 * Prompt và các bước của đường ống giữ nguyên như bản tham chiếu; chỉ phần
 * truyền tải là khác. Bộ quét tinh chỉnh vốn đã xử lý được cả phản hồi đến một
 * lần, nên nạp cho nó một sự kiện duy nhất tương đương với luồng token cũ —
 * giao diện chỉ cập nhật một bước thay vì cập nhật dần.
 *
 * Những gì bị cố ý bỏ: phân loại kịch bản + truy hồi mẫu (template), embedding,
 * API gốc của Gemini, lưu trữ SQLite, xác thực.
 * Bảng gọi thẳng điểm cuối (endpoint) mô hình bằng khóa của chính người dùng.
 */
import { endpointUrl, type LLMConfig } from './settings';
import { PROMPT_ANALYZE_USER, PROMPT_SIMULATION } from './prompts';
import type { Artifact, ArtifactAnalysis, SkeletonElement } from './types';

// ------------------------------------------------------------------- lỗi

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** Biến một lỗi fetch/HTTP thành thông báo mà con người có thể xử lý được. */
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
    /* phần thân lỗi không phải JSON */
  }
  if (status === 401 || status === 403) {
    return `Điểm cuối (endpoint) từ chối khóa API (API key) (${status}). Hãy kiểm tra trong phần Cài đặt. — ${detail}`;
  }
  if (status === 404) {
    return `Không có điểm cuối (endpoint) mô hình tại ${url} (404). Hãy kiểm tra URL gốc và tên mô hình. — ${detail}`;
  }
  if (status === 429) {
    return `Bị giới hạn tốc độ hoặc hết hạn mức (429). — ${detail}`;
  }
  return `Điểm cuối (endpoint) ${url} trả về ${status}: ${detail}`;
}

/** Fetch có giải thích lỗi CORS/mạng thay vì để lộ ra "TypeError: Failed to
 *  fetch", vốn chẳng nói gì cho người dùng. */
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
      `Không thể kết nối tới ${url}. Có thể mạng đang hỏng, URL sai, ` +
        `hoặc điểm cuối (endpoint) chặn yêu cầu từ trình duyệt (CORS) — máy chủ ` +
        `mô hình cục bộ cần bật --cors/Origin. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(explainFailure(res.status, text, url), res.status);
  }
  return res;
}

// --------------------------------------------------------- phân tích JSON

/** Phân tích cú pháp phản hồi JSON của LLM, chấp nhận hàng rào markdown, các
 *  chuỗi escape sai thường gặp mà mô hình phát ra, và phần văn xuôi bao quanh
 *  đối tượng. */
export function parseLlmJson(text: string | null | undefined): unknown {
  if (!text) throw new LlmError('Mô hình trả về phản hồi rỗng.');
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  clean = clean.replace(/\\_/g, '_').replace(/\\'/g, "'");
  try {
    return JSON.parse(clean);
  } catch {
    /* chuyển sang lần thử quét theo dấu ngoặc nhọn */
  }
  // HTML dài nằm trong JSON là chỗ hay bị cắt cụt; hãy thử đối tượng ngoài cùng
  // trước khi bỏ cuộc.
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = clean.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      throw new LlmError(
        `Phản hồi của mô hình không phải JSON hợp lệ (${e instanceof Error ? e.message : e}). ` +
          'Nếu việc này lặp lại thì nhiều khả năng kết quả đang bị cắt cụt — hãy tăng số token tối đa trong phần Cài đặt.',
      );
    }
  }
  throw new LlmError('Mô hình trả về dữ liệu với cấu trúc không mong đợi.');
}

// --------------------------------------------------------------- hoàn tất

/**
 * Một sự kiện hoàn tất (completion event). Mỗi lời gọi là một POST duy nhất,
 * nên có đúng một `output` và nhiều nhất một `thinking` — cấu trúc này được giữ
 * vì đường ống tinh chỉnh (bộ quét dấu mốc + bộ rút gọn) tiêu thụ chúng và vẫn
 * không đổi so với bản tham chiếu ai4edu.
 */
export interface CompletionEvent {
  kind: 'thinking' | 'output';
  delta: string;
}

/**
 * Văn bản suy luận trong một thông điệp phản hồi KHÔNG truyền dần (non-stream).
 * OpenRouter chuẩn hóa hình dạng của các nhà cung cấp về `reasoning` /
 * `reasoning_content` (chuỗi) hoặc `reasoning_details[]` ({text|summary}). Ưu
 * tiên các trường phẳng để nhà cung cấp đặt cả hai không khiến mọi token bị báo
 * hai lần.
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

/** Nội dung từ một lựa chọn (choice) không truyền dần. Một số cổng vào
 *  (gateway) trả về một mảng các phần thay vì một chuỗi thuần. */
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

/** Dựng payload yêu cầu cho một lời gọi chat. Các núm điều chỉnh sinh nội dung
 *  chỉ được gửi khi đã cấu hình — hầu hết điểm cuối (endpoint) bỏ qua các trường
 *  lạ.
 *
 *  `stream` luôn là false: đây là các POST yêu cầu/phản hồi thuần. */
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
    // Ngân sách tường minh thắng cách viết tắt theo mức nỗ lực (OpenRouter coi
    // chúng là loại trừ nhau). Các trường thêm là ghi đè theo từng yêu cầu của
    // llama.cpp và vô hại ở nơi khác.
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
  /** Văn bản kết quả của mô hình. */
  text: string;
  /** Phần suy luận/suy nghĩ, khi điểm cuối (endpoint) trả về nó. */
  thinking: string;
}

/**
 * Lấy `{ text, thinking }` ra khỏi phần thân (body) chat-completions không
 * truyền dần.
 *
 * Hàm thuần và được export để có thể kiểm thử giao kèo truyền tải mà không cần
 * trình duyệt. Xử lý ba hình dạng thường gặp trong thực tế: nội dung là chuỗi
 * thuần, mảng các phần nội dung, và `finish_reason` bằng `length` (dấu hiệu của
 * một ngân sách token quá nhỏ).
 */
export function parseChatResponse(body: unknown): ChatResult {
  if (!body || typeof body !== 'object') {
    throw new LlmError('Điểm cuối (endpoint) trả về phần thân không mong đợi.');
  }
  const b = body as Record<string, unknown>;

  // Điểm cuối (endpoint) báo lỗi trong phần thân ngay cả khi trạng thái là 200.
  if (b.error) {
    const raw = b.error;
    const msg =
      raw && typeof raw === 'object'
        ? ((raw as Record<string, unknown>).message ?? JSON.stringify(raw))
        : String(raw);
    throw new LlmError(`Điểm cuối (endpoint) trả về lỗi: ${msg}`);
  }

  const choices = b.choices;
  if (!Array.isArray(choices) || !choices.length) {
    throw new LlmError('Điểm cuối (endpoint) không trả về lựa chọn (choice) nào.');
  }
  const choice = choices[0] as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const finish = choice.finish_reason;
  const text = contentText(message);
  const thinking = reasoningText(message);

  if (!text.trim()) {
    // Nguyên nhân phổ biến là phản hồi bị cắt cụt: mô hình đã tiêu hết ngân
    // sách vào việc suy nghĩ, hoặc tài liệu không vừa.
    if (finish === 'length') {
      throw new LlmError(
        'Phản hồi bị cắt cụt trước khi có bất kỳ kết quả nào — hãy tăng số token tối đa trong phần Cài đặt.',
      );
    }
    throw new LlmError(
      'Mô hình không trả về gì cả. Mô hình suy luận có thể đốt hết ngân sách ' +
        'token vào việc suy nghĩ — hãy tăng số token tối đa trong phần Cài đặt rồi thử lại.',
    );
  }
  return { text, thinking };
}

/**
 * Một POST đơn giản tới điểm cuối (endpoint) chat và nhận về toàn bộ câu trả
 * lời.
 *
 * Không SSE, không đóng gói tăng dần: phản hồi đến dưới dạng một phần thân JSON
 * duy nhất (`choices[0].message`). Phần suy luận, khi điểm cuối (endpoint) báo
 * cáo, được trả về kèm chứ không bị bỏ đi, để giao diện tinh chỉnh vẫn hiển thị
 * được.
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
      `Điểm cuối (endpoint) trả về phần thân không phải JSON (${e instanceof Error ? e.message : e}).`,
    );
  }
  return parseChatResponse(body);
}

/**
 * Bộ thích ứng trình bày phản hồi của một POST duy nhất dưới dạng chuỗi sự kiện
 * mà đường ống tinh chỉnh tiêu thụ. Bản thân đường ống (bộ quét dấu mốc, kiểm
 * tra hợp lệ chỉnh sửa, thao tác trên phần tử) vẫn y nguyên — chỉ phần truyền
 * tải đổi từ SSE sang một yêu cầu/phản hồi thuần.
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

/** Lời gọi có gom đệm (buffered) cho những nơi không cần phần suy luận
 *  (phân tích). */
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

// -------------------------------------------------------------- phân tích

export interface AnalyzeRequest {
  /** Ảnh PNG của bản phác thảo, dạng base64 không kèm tiền tố data-URL. */
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
 * Một lượt phân tích: ảnh bản phác thảo vào, kết quả ra. POST thuần, một phản
 * hồi.
 *
 * Prompt và đường ống giữ nguyên như bản tham chiếu ai4edu; chỉ phần truyền tải
 * là khác. `maxTokens` cho phép bên gọi giữ phản hồi trong một ngân sách nhỏ —
 * tài liệu phân tích ngắn, nên một giới hạn chặt là thứ khiến nó có cảm giác
 * tức thời.
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
    throw new LlmError('Mô hình trả về dữ liệu với cấu trúc không mong đợi.');
  }
  const g = gen as Record<string, unknown>;

  let kind: Artifact['kind'] = g.kind as Artifact['kind'];
  if (kind !== 'html_sim' && kind !== 'elements') {
    // Phương án dự phòng tương thích ngược: một mô hình bỏ qua schema nhưng
    // vẫn tạo ra tài liệu HTML thì vẫn được coi là html_sim.
    if (typeof g.simulation_code === 'string' && g.simulation_code) {
      kind = 'html_sim';
      g.html = g.simulation_code;
    } else if (typeof g.html === 'string' && g.html) {
      kind = 'html_sim';
    } else {
      throw new LlmError(
        'Mô hình không trả về mô phỏng hay sơ đồ nào. Hãy thử phân tích lại.',
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
        'Mô hình chọn đầu ra là sơ đồ nhưng không trả về phần tử nào dùng được. Hãy thử phân tích lại.',
      );
    }
    payload = { elements };
  } else {
    const html = g.html;
    if (typeof html !== 'string' || !html.trim()) {
      throw new LlmError(
        'Mô hình trả về tài liệu mô phỏng rỗng. Hãy thử phân tích lại.',
      );
    }
    payload = { html };
  }

  const title =
    String(g.title ?? '').trim() || (kind === 'elements' ? 'Sơ đồ' : 'Mô phỏng');

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
