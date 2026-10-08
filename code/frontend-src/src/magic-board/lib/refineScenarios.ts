/**
 * Tinh chỉnh một kết quả kịch bản.
 *
 * Bản chuyển từ `_stream_scenario_refinement` của ai4edu: một kịch bản là một
 * mẫu cộng với các params có tên, nên mô hình không sửa mã — nó phát ra một bản
 * vá params, bản vá được trộn lên params hiện tại, mẫu được kết xuất lại, và
 * html/params/tiêu đề/phân tích mới trở thành payload của kết quả.
 *
 * Ở đây không có gì biết từng kịch bản nói về điều gì, nên các mục mới trong
 * danh mục tự động có được đường xử lý này.
 */
import { LlmError, parseLlmJson, completeChatEvents } from './llm';
import { PROMPT_REFINE_SCENARIO } from './prompts';
import { getMeta, instantiate, loadDetails, rerender, resolveTerm } from './scenarios';
import type { ScenarioMeta } from './scenarios';
import type { LLMConfig } from './settings';
import type { Artifact, RefineEvent } from './types';

/** Số lượng giá trị đã biết là đúng để hiển thị cho mô hình với một param khóa
 *  dạng văn bản tự do. */
const SAMPLE_VALUES = 60;

/**
 * Đặc tả đã khai báo cho một kịch bản, kèm một mẫu các giá trị hợp lệ cho param
 * khóa của nó. Nếu không có mẫu, một mô hình được yêu cầu "hiện hộp sọ" sẽ không
 * có cách nào biết tập bản đồ viết nó là "skull", "cranium" hay "FMA46565".
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
      // Ưu tiên những khóa mà bảng bí danh thực sự phân giải được — đó là những
      // chuỗi người dùng sẽ gõ và bộ phân giải chấp nhận.
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
 * Chạy một lượt tinh chỉnh kịch bản. Trả về payload mới (vắng mặt khi yêu cầu
 * không thể diễn đạt được qua params của mẫu) và một thông báo dành cho người
 * dùng.
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
    throw new LlmError('Kết quả này không có mẫu nào để tinh chỉnh.');
  }
  const meta = await getMeta(scenarioId);
  if (!meta) {
    throw new LlmError(`Mẫu không xác định "${scenarioId}".`);
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
    // Kết quả là JSON thô — không bao giờ kể nó vào chat. Bản tóm tắt sạch sẽ
    // đến trong `message` của kết quả.
    rawParts.push(ev.delta);
  }

  const parsed = parseLlmJson(rawParts.join('')) as {
    params?: unknown;
    message?: unknown;
  };
  const message = String(parsed?.message ?? '').trim();

  if (parsed?.params === null || parsed?.params === undefined) {
    // Mô hình nói điều này không diễn đạt được qua params của mẫu — hãy báo lại
    // và không thay đổi gì.
    return {
      message:
        message ||
        'Điều đó không thể diễn đạt được qua các tùy chọn của tài liệu này — ' +
        'không có gì thay đổi.',
    };
  }
  if (typeof parsed.params !== 'object' || Array.isArray(parsed.params)) {
    throw new LlmError(
      'Mô hình trả về các tùy chọn sai định dạng. Hãy thử diễn đạt lại.',
    );
  }

  const merged = { ...currentParams, ...(parsed.params as Record<string, unknown>) };

  // Khởi tạo lại: chuẩn hóa theo meta, kết xuất lại, và suy ra lại tiêu đề +
  // phân tích để việc đổi tiêu điểm đổi tên "Anatomy: heart" -> "Anatomy: brain".
  let inst;
  try {
    inst = await instantiate(scenarioId, merged);
  } catch (e) {
    return {
      message:
        message ||
        `Các tùy chọn đó không hợp với tài liệu này (${
          e instanceof Error ? e.message : String(e)
        }) — không có gì thay đổi.`,
    };
  }
  if (!inst.resolved) {
    return {
      message:
        message ||
        'Điều đó không có trong dữ liệu của tài liệu này — vẫn giữ khung nhìn ' +
          'hiện tại.',
    };
  }

  return {
    message: message || `Đã cập nhật ${inst.title}.`,
    payload: {
      scenario: scenarioId,
      params: inst.params,
      html: await rerender(scenarioId, inst.params),
      title: inst.title,
      analysis: inst.analysis,
    },
  };
}
