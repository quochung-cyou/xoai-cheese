/**
 * Phân loại bản phác thảo — đường nhanh của đường ống phân tích ai4edu.
 *
 * Bản chuyển từ giai đoạn 0 của `backend/app/services/analysis.py` cộng với
 * `backend/prompts/classify.txt`: một lời gọi thị giác rẻ tiền quyết định xem
 * bản phác thảo có khớp rõ ràng với một mẫu dựng sẵn hay không, và nếu có thì
 * mẫu được khởi tạo ngay tại chỗ. Không có mã mô phỏng nào được sinh ra cả.
 *
 * Vì sao điều này quan trọng hơn cả tốc độ: yêu cầu mô hình viết cả một mô phỏng
 * HTML trong một lần khiến mô hình suy luận tiêu hết ngân sách vào việc suy nghĩ
 * (`finish_reason: "length"`, `content: ""`, mọi token đều bị tính là
 * `reasoning_tokens`). Phân loại chỉ là một quyết định tốn ~100 token, nên nó
 * trả lời nhanh và không thể bị chính việc suy luận của mình bỏ đói.
 *
 * Truy hồi dựa trên embedding bị cố ý không chuyển sang — danh mục đủ nhỏ để đưa
 * nguyên vẹn cho bộ phân loại, đúng như ai4edu làm khi tắt truy hồi.
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

/** Ngân sách token cho bộ phân loại. Nó chỉ phát ra một đối tượng JSON nhỏ; bản
 *  tham chiếu dùng 2048 và đo được ~3 giây suy nghĩ cho ~100 token kết quả. */
export const DEFAULT_CLASSIFY_MAX_TOKENS = 1024;

export interface ClassifyResult extends ClassifyHint {
  /** Id mẫu thực sự được khớp, hoặc null. */
  scenario: string | null;
}

/** Góc nhìn thô của mô hình về một bản phác thảo: id kịch bản + params + chú
 *  thích một dòng. */
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
    throw new LlmError('Bộ phân loại trả về cấu trúc không mong đợi.');
  }
  const p = parsed as Record<string, unknown>;

  const rawScenario = typeof p.scenario === 'string' ? p.scenario.trim() : '';
  // Chỉ những id thực sự được phát hành mới được tính; mọi thứ khác đều quay về
  // sinh mới.
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
 * Phân loại, rồi khởi tạo mẫu được khớp ngay tại chỗ.
 *
 * Trả về null khi bản phác thảo không khớp rõ ràng với mẫu nào, để bên gọi có
 * thể quay về sinh đầy đủ (đường "cứ sinh thôi" của ai4edu).
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
  // Một mẫu không đáp ứng được params của bản phác thảo thì không được phát hành
  // một trình xem sai — hãy quay về sinh mới, đúng như bản tham chiếu làm.
  if (!inst.resolved) return null;

  // Mở đầu phần phân tích bằng chính cách bộ phân loại đọc bản phác thảo, tức
  // là thứ người dùng thực sự đã vẽ.
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
