/**
 * Các kiểu dùng chung của Bảng Ma Thuật.
 *
 * Bản chuyển tự chứa của các kiểu bảng bên ai4edu: hình dạng artifact/board/
 * refine được giữ nguyên để logic bảng vẽ + trò chuyện chuyển qua không đổi,
 * trừ đi mọi khái niệm thuộc về máy chủ (không auth, không lớp học, không
 * scenario).
 */

/** Nửa phần phân tích của một kết quả. */
export interface ArtifactAnalysis {
  observation: string;
  derived_models: DerivedModel[];
  notes: string;
}

export interface DerivedModel {
  type: string;
  latex: string;
  parameters: Record<string, number | string>;
  explanation: string;
}

export type ArtifactKind = 'html_sim' | 'elements' | 'scenario';

/**
 * Một thứ đã được tạo trên bảng. Hình dạng của payload phụ thuộc vào kind:
 *   html_sim -> { html }
 *   scenario -> { scenario, params, html }  (template + tham số, dựng lại được)
 *   elements -> { elements }
 *
 * `title`/`analysis` được nhân bản vào payload cho các lần tinh chỉnh kịch bản:
 * đổi tham số là đổi tên kết quả ("Giải phẫu: tim" -> "Giải phẫu: não"), và sự
 * kiện 'done' của tinh chỉnh mang theo payload, nên phần tiêu đề cùng phân tích
 * mới phải đi kèm nó.
 */
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** Id của các phần tử phác thảo đã sinh ra kết quả này — quyết định việc
   *  kiểm tra độ cũ theo từng kết quả, dù có khung hay không. */
  source_element_ids: string[];
  payload: {
    html?: string;
    elements?: SkeletonElement[];
    /** Id template kịch bản — chỉ có khi kind là 'scenario'. */
    scenario?: string;
    /** Tham số kịch bản mà html được dựng từ đó. */
    params?: Record<string, unknown>;
    /** Tiêu đề mới, do một lần tinh chỉnh kịch bản đặt. */
    title?: string;
    /** Phân tích mới, do một lần tinh chỉnh kịch bản đặt. */
    analysis?: ArtifactAnalysis | null;
  };
  analysis: ArtifactAnalysis | null;
  updated_at: string;
}

/** Lược đồ phần tử Excalidraw tối thiểu mà mô hình phát ra cho đầu ra "elements". */
export interface SkeletonElement {
  id?: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  label?: { text: string; fontSize?: number };
  start?: { id: string };
  end?: { id: string };
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  points?: unknown;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Mốc thời gian ISO — hiển thị ở đầu tin nhắn. */
  at?: string;
  /** Kết quả mà lượt này nhắm tới (yêu cầu của người dùng hoặc kết quả trả lời). */
  artifact_id?: string | null;
  /** Phần suy luận ghi lại từ lượt tinh chỉnh — hiển thị ở dạng thu gọn. */
  thinking?: string;
  /** Thời gian thực lượt chạy dành cho việc suy nghĩ, ms — hiển thị "Đã suy nghĩ Ns". */
  thinking_ms?: number;
}

export interface BoardScene {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

/** Một bảng giờ nằm hoàn toàn trong localStorage. */
export interface Board {
  id: string;
  name: string;
  scene: BoardScene;
  chat_messages: ChatMessage[];
  artifacts: Artifact[];
  /** Id các mục bộ nhớ tạm mà bảng vẽ của bảng này được dựng từ đó, theo thứ
   *  tự đặt lên. Mở bảng sẽ đặt lại chúng. */
  cacheKeys?: string[];
  updated_at: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  updated_at: string;
}

/** Hình chữ nhật trên bảng vẽ, song song với trục tọa độ. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Một sự kiện có cấu trúc từ một lượt tinh chỉnh (truyền trực tiếp tại chỗ,
 *  không phải SSE). Bộ rút gọn biến luồng token của mô hình thành những sự kiện
 *  ngữ nghĩa này — văn bản thô của mô hình không bao giờ tới được giao diện. */
export type RefineEvent =
  | { type: 'status'; stage: 'loading' | 'calling-model'; lines?: number }
  | { type: 'thinking'; delta: string }
  | { type: 'narration'; delta: string }
  | { type: 'edit-start'; index: number }
  | { type: 'edit-located'; index: number; line: number; excerpt: string }
  | {
      type: 'edit-invalid';
      index: number;
      reason: string;
      search?: string;
      replace?: string;
    }
  | {
      type: 'edit-applied';
      index: number;
      line?: number;
      search: string;
      replace: string;
    }
  | { type: 'rewrite-start' }
  | { type: 'rewrite-progress'; lines: number }
  | {
      type: 'done';
      /** Toàn bộ payload mới của kết quả. Không có = mô hình đã trả lời
       *  nhưng không đổi gì (yêu cầu không diễn đạt được). */
      payload?: Artifact['payload'];
      message: string;
    }
  | { type: 'error'; detail: string };

/** Trạng thái trực tiếp của một lượt tinh chỉnh, dựng dần bằng cách rút gọn
 *  các RefineEvent. */
export interface RefineEditCard {
  index: number;
  status: 'locating' | 'patching' | 'applied' | 'failed';
  line?: number;
  excerpt?: string;
  reason?: string;
  search?: string;
  replace?: string;
}

export interface RefineRun {
  stage: 'loading' | 'calling-model' | 'streaming';
  docLines?: number;
  thinking: string;
  narration: string;
  edits: RefineEditCard[];
  /** số dòng trong khi mô hình truyền đi một bản viết lại toàn tài liệu */
  rewriteLines: number | null;
  /** mốc performance.now() của delta suy nghĩ đầu tiên — nội bộ. */
  thinkingStarted?: number;
  /** số ms dành cho giai đoạn suy nghĩ, đóng dấu khi nó kết thúc. */
  thinkingMs?: number;
}

/** Vòng đời phân tích của một bảng. */
export type AnalyzeStatus = 'idle' | 'analyzing' | 'suggested' | 'error';
