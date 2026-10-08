/**
 * Đường ống tinh chỉnh — bản chuyển từ `app/services/refine.py` của backend
 * ai4edu.
 *
 * Payload đã lưu -> prompt -> luồng từ nhà cung cấp -> các sự kiện vòng đời
 * chỉnh sửa đã được quét -> cam kết nguyên tử (atomic commit) tại 'done'. Bên
 * gọi nhận được đúng bộ từ vựng RefineEvent mà điểm cuối SSE cũ tạo ra, nên giao
 * diện chat không thay đổi.
 *
 * Hai giao kèo:
 *  - html_sim: mô hình phát ra các dấu mốc SEARCH/REPLACE (hoặc REWRITE toàn
 *    bộ); các chỉnh sửa được kiểm tra hợp lệ trên một bản sao làm việc ngay khi
 *    chúng đến.
 *  - elements: mô hình phát ra JSON {ops, message}; các op áp dụng nguyên tử lên
 *    danh sách phần tử khung.
 */
import { PROMPT_REFINE, PROMPT_REFINE_ELEMENTS } from './prompts';
import {
  applyEdits,
  applyElementOps,
  EditError,
  findMatchLine,
  type Edit,
} from './edits';
import { EditStreamScanner, type ScanEvent } from './editsStream';
import { LlmError, parseLlmJson, completeChatEvents, type CompletionEvent } from './llm';
import { refineScenarioArtifact } from './refineScenarios';
import type { LLMConfig } from './settings';
import type { Artifact, RefineEvent, SkeletonElement } from './types';

/** html_sim là một tài liệu HTML được sửa qua các dấu mốc SEARCH/REPLACE. */
const HTML_KINDS = new Set(['html_sim', 'scenario']);

export interface RefineOptions {
  onEvent: (ev: RefineEvent) => void;
  signal?: AbortSignal;
}

function textPart(text: string) {
  return { type: 'text', text };
}

// -------------------------------------------------------------- phần tử

async function* streamElementsRefinement(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
): AsyncGenerator<RefineEvent> {
  const current = artifact.payload.elements ?? [];
  yield { type: 'status', stage: 'loading', lines: current.length };

  const doc = JSON.stringify(current, null, 0);
  const parts = [
    textPart(`Here is the current skeleton element list:\n\n${doc}`),
    textPart(`User instruction: "${instruction}"`),
  ];
  yield { type: 'status', stage: 'calling-model' };

  const rawParts: string[] = [];
  for await (const ev of completeChatEvents(
    cfg,
    PROMPT_REFINE_ELEMENTS,
    parts,
    { jsonMode: false },
    signal,
  )) {
    if (ev.kind === 'thinking') {
      yield { type: 'thinking', delta: ev.delta };
      continue;
    }
    rawParts.push(ev.delta);
  }

  const parsed = parseLlmJson(rawParts.join(''));
  const ops = (parsed as { ops?: unknown }).ops;
  if (!Array.isArray(ops) || !ops.length) {
    throw new LlmError(
      'Mô hình không trả về chỉnh sửa nào cho sơ đồ. Hãy thử diễn đạt lại yêu cầu.',
    );
  }

  let newElements: SkeletonElement[];
  try {
    newElements = applyElementOps(current, ops);
  } catch (e) {
    throw new LlmError(
      `Chỉnh sửa của mô hình không khớp với sơ đồ (${
        e instanceof Error ? e.message : e
      }). Hãy thử diễn đạt lại, hoặc phân tích lại.`,
    );
  }

  const message =
    String((parsed as { message?: unknown }).message ?? '') ||
    `Đã áp dụng ${ops.length} chỉnh sửa.`;
  yield { type: 'done', payload: { elements: newElements }, message };
}

// ----------------------------------------------------------------- HTML

async function* streamHtmlRefinement(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
): AsyncGenerator<RefineEvent> {
  const currentCode = artifact.payload.html ?? '';
  yield {
    type: 'status',
    stage: 'loading',
    lines: currentCode.split('\n').length,
  };

  const parts = [
    textPart(`Here is the current simulation HTML document:\n\n${currentCode}`),
    textPart(`User instruction: "${instruction}"`),
  ];
  yield { type: 'status', stage: 'calling-model' };

  const scanner = new EditStreamScanner();
  const narrationParts: string[] = [];
  const rawParts: string[] = [];
  const edits: Edit[] = [];
  const failed = new Set<number>();
  const located = new Map<number, number | null>();
  let working = currentCode;
  let rewriteCode: string | null = null;

  function* emitFrom(scanEvents: ScanEvent[]): Generator<RefineEvent> {
    for (const se of scanEvents) {
      switch (se.type) {
        case 'narration':
          narrationParts.push(se.delta);
          yield { type: 'narration', delta: se.delta };
          break;
        case 'edit-start':
          yield { type: 'edit-start', index: se.index };
          break;
        case 'edit-search': {
          // Đoạn văn bản cần tìm đã biết trong khi phần thay thế vẫn đang được
          // sinh ra — hãy kiểm tra hợp lệ nó trên bản sao làm việc ngay bây giờ.
          const lineNo = findMatchLine(working, se.search);
          located.set(se.index, lineNo);
          if (lineNo === null) {
            failed.add(se.index);
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: 'không tìm thấy đoạn văn bản cần tìm trong tài liệu',
              search: se.search,
            };
          } else {
            yield {
              type: 'edit-located',
              index: se.index,
              line: lineNo,
              excerpt: (se.search.split('\n')[0] ?? '').slice(0, 120),
            };
          }
          break;
        }
        case 'edit-end': {
          const edit: Edit = { search: se.search, replace: se.replace };
          if (failed.has(se.index)) {
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: 'bỏ qua — đoạn văn bản cần tìm không khớp',
              search: se.search,
              replace: se.replace,
            };
            break;
          }
          try {
            working = applyEdits(working, [edit]);
            edits.push(edit);
            yield {
              type: 'edit-applied',
              index: se.index,
              line: located.get(se.index) ?? undefined,
              search: se.search,
              replace: se.replace,
            };
          } catch (e) {
            failed.add(se.index);
            yield {
              type: 'edit-invalid',
              index: se.index,
              reason: e instanceof EditError ? e.message : String(e),
              search: se.search,
              replace: se.replace,
            };
          }
          break;
        }
        case 'rewrite-start':
          yield { type: 'rewrite-start' };
          break;
        case 'rewrite-progress':
          yield { type: 'rewrite-progress', lines: se.lines };
          break;
        case 'rewrite-end':
          rewriteCode = se.code;
          break;
      }
    }
  }

  for await (const ev of completeChatEvents(
    cfg,
    PROMPT_REFINE,
    parts,
    { jsonMode: false },
    signal,
  )) {
    if (ev.kind === 'thinking') {
      yield { type: 'thinking', delta: ev.delta };
      continue;
    }
    rawParts.push(ev.delta);
    yield* emitFrom(scanner.feed(ev.delta));
  }
  yield* emitFrom(scanner.flush());

  const narration = narrationParts.join('').trim();

  // --- Chốt tài liệu cuối cùng ---
  if (rewriteCode) {
    const code: string = rewriteCode;
    yield {
      type: 'done',
      payload: { html: code },
      message: narration || 'Đã viết lại mô phỏng.',
    };
    return;
  }

  if (edits.length && !failed.size) {
    yield {
      type: 'done',
      payload: { html: working },
      message: narration || `Đã áp dụng ${edits.length} chỉnh sửa.`,
    };
    return;
  }

  // Dự phòng: một mô hình bỏ qua giao kèo dấu mốc có thể vẫn đã tạo ra cấu trúc
  // JSON cũ — hãy thử nó trước khi tuyên bố thất bại.
  const raw = rawParts.join('');
  try {
    const parsed = parseLlmJson(raw) as Record<string, unknown>;
    if (typeof parsed.simulation_code === 'string' && parsed.simulation_code) {
      yield {
        type: 'done',
        payload: { html: parsed.simulation_code },
        message: String(parsed.message ?? '') || narration || 'Xong.',
      };
      return;
    }
    if (Array.isArray(parsed.edits) && parsed.edits.length) {
      const newCode = applyEdits(currentCode, parsed.edits as Edit[]);
      yield {
        type: 'done',
        payload: { html: newCode },
        message: String(parsed.message ?? '') || narration || 'Xong.',
      };
      return;
    }
  } catch {
    /* cũng không phải cấu trúc cũ — chuyển xuống phần thất bại bên dưới */
  }

  if (failed.size) {
    throw new LlmError(
      `Chỉnh sửa của mô hình không khớp với tài liệu (không áp dụng được chỉnh sửa ${[
        ...failed,
      ].sort((a, b) => a - b)}). Hãy thử diễn đạt lại, hoặc phân tích lại.`,
    );
  }
  throw new LlmError(
    'Mô hình không trả về chỉnh sửa nào dùng được cho tài liệu này. Hãy thử diễn đạt lại yêu cầu.',
  );
}

// ---------------------------------------------------------- điểm vào

/**
 * Tinh chỉnh một kết quả bằng yêu cầu ngôn ngữ tự nhiên, phát ra các sự kiện
 * tiến trình mang tính ngữ nghĩa. Lỗi được ném ra (bên gọi biến chúng thành sự
 * kiện 'error' / câu trả lời trong chat); payload cuối cùng đến qua sự kiện
 * 'done'.
 *
 * Ba giao kèo, chọn theo loại kết quả:
 *  - elements : JSON {ops, message} áp dụng lên danh sách phần tử khung
 *  - scenario : JSON {params, message} được trộn vào và kết xuất lại từ mẫu
 *  - html_sim : các dấu mốc SEARCH/REPLACE (hoặc REWRITE) trên tài liệu
 */
export async function* refineArtifact(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  signal?: AbortSignal,
  onEvent?: (ev: RefineEvent) => void,
): AsyncGenerator<RefineEvent> {
  if (!instruction.trim()) throw new LlmError('Cần có một yêu cầu.');

  if (artifact.kind === 'elements') {
    if (!artifact.payload.elements?.length) {
      throw new LlmError('Sơ đồ này không có phần tử nào để tinh chỉnh.');
    }
    yield* streamElementsRefinement(cfg, artifact, instruction, signal);
    return;
  }

  // Các kết quả dựa trên mẫu được tinh chỉnh qua params của chúng, không bao giờ
  // bằng cách sửa tài liệu đã kết xuất. Đường đó là một hàm thuần, nên các sự
  // kiện tiến trình của nó được chuyển tiếp qua onEvent và ở đây chỉ phát ra kết
  // quả.
  if (artifact.payload.scenario) {
    const result = await refineScenarioArtifact(
      cfg,
      artifact,
      instruction,
      onEvent ?? (() => {}),
      signal,
    );
    yield { type: 'done', payload: result.payload, message: result.message };
    return;
  }

  if (HTML_KINDS.has(artifact.kind)) {
    if (!(artifact.payload.html ?? '').trim()) {
      throw new LlmError('Kết quả này không có tài liệu nào để tinh chỉnh.');
    }
    yield* streamHtmlRefinement(cfg, artifact, instruction, signal);
    return;
  }

  throw new LlmError(`Loại kết quả không xác định ${JSON.stringify(artifact.kind)}.`);
}

/** Lớp bao tiện dụng: chạy một lượt tinh chỉnh và đưa mọi sự kiện cho callback.
 *  Trả về payload cuối cùng (undefined = mô hình đã trả lời nhưng không thay đổi
 *  gì). */
export async function refineArtifactToCallback(
  cfg: LLMConfig,
  artifact: Artifact,
  instruction: string,
  onEvent: (ev: RefineEvent) => void,
  signal?: AbortSignal,
): Promise<PendingOutcome> {
  const outcome: PendingOutcome = {};
  try {
    for await (const ev of refineArtifact(cfg, artifact, instruction, signal, onEvent)) {
      if (ev.type === 'done') {
        outcome.payload = ev.payload;
        outcome.message = ev.message;
        if (ev.payload) {
          outcome.artifact = { ...artifact, ...(ev.payload as object) } as Artifact;
        }
        continue;
      }
      if (ev.type === 'error') {
        outcome.error = ev.detail;
        continue;
      }
      onEvent(ev);
    }
  } catch (e) {
    if (signal?.aborted) {
      outcome.aborted = true;
    } else {
      outcome.error = e instanceof Error ? e.message : String(e);
    }
  }
  return outcome;
}

export interface PendingOutcome {
  /** Payload của kết quả như được sự kiện 'done' của mô hình trả về. */
  payload?: Artifact['payload'];
  /** Kết quả đầy đủ đã cập nhật — mang theo tiêu đề/phân tích mới cho các lượt
   *  tinh chỉnh kịch bản. */
  artifact?: Artifact;
  message?: string;
  error?: string;
  aborted?: boolean;
}

export type { CompletionEvent };
