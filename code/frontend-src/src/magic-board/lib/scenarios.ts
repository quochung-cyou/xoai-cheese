/**
 * Sổ đăng ký kịch bản — danh mục "kết xuất nhanh" của ai4edu, được chuyển sang
 * để chạy không cần backend.
 *
 * Trong ai4edu đây là `backend/app/scenarios.py`: một sổ đăng ký dựa trên tệp,
 * tìm các tệp `<id>.json` (metadata + đặc tả params) bên cạnh `<id>.html` (một
 * mẫu có `__PARAMS__`), rồi chuẩn hóa params, kết xuất mẫu, và suy ra
 * tiêu đề/phân tích. Mọi thứ phía máy chủ đều không còn ở đây, nên đúng đường
 * ống đó chạy trong trình duyệt với các tệp trong `public/mb-assets/`.
 *
 * Các mẫu được nạp theo yêu cầu thay vì đóng gói kèm: 25 mẫu, mỗi mẫu khoảng
 * 9-40 KB HTML, và không có lý do gì để mang chúng vào đồ thị JS.
 */
import type { Artifact, ArtifactAnalysis } from './types';

/**
 * Gốc của cây tài sản đã sao chép. Có thể ghi đè cho bản triển khai ở đường dẫn
 * con.
 *
 * Đọc một cách phòng thủ: Vite thay thế giá trị literal, nhưng phép truy cập
 * thuộc tính phải tồn tại được khi được import ngoài một gói (các bộ kiểm tra
 * bằng script), nơi `import.meta.env` không tồn tại.
 */
function envAssetBase(): string | undefined {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.VITE_MB_ASSET_BASE;
  return typeof value === 'string' && value ? value : undefined;
}

const ASSET_BASE = envAssetBase() ?? '/mb-assets';

export interface ScenarioMeta {
  id: string;
  match?: string;
  /** Đặc tả params dạng người đọc được (chỉ được prompt của mô hình dùng trong
   *  ai4edu). */
  params?: string;
  required_params?: string[];
  param_defaults?: Record<string, unknown>;
  title_template?: string;
  analysis?: {
    details_file?: string;
    key_param?: string;
    require_resolved?: boolean;
    observation_template?: string;
    notes_fields?: string[];
  };
}

export interface InstantiatedScenario {
  scenario: string;
  params: Record<string, unknown>;
  html: string;
  title: string;
  analysis: ArtifactAnalysis | null;
  /** False khi một phép tra `require_resolved` không tìm thấy gì cho param khóa. */
  resolved: boolean;
}

// -------------------------------------------------------------- nạp dữ liệu

const metaCache = new Map<string, ScenarioMeta | null>();
const templateCache = new Map<string, string>();/** Các id kịch bản được xuất vào `public/mb-assets/scenarios/`. Được liệt kê
 *  tường minh để danh mục có thể được định kiểu và một tệp thiếu sẽ là lỗi rõ
 *  ràng thay vì 404 âm thầm lúc tái tạo. */
export const SCENARIO_IDS = [
  'anatomy_3d',
  'backprop',
  'book',
  'bubble_sort',
  'cone',
  'conv_pipeline',
  'cylinder',
  'function_plot',
  'faraday_vi',
  'faraday_en',
  'ph_scale_en',
  'gaussian',
  'helix',
  'hyperboloid',
  'knot',
  'lathe',
  'matrix_mult',
  'mobius',
  'neural_network',
  'paraboloid',
  'pendulum',
  'platonic',
  'projectile',
  'rc_circuit',
  'saddle',
  'sphere',
  'tetrahedron',
  'torus',
  'wave',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export function asset(path: string): string {
  return `${ASSET_BASE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function getMeta(id: string): Promise<ScenarioMeta | null> {
  if (metaCache.has(id)) return metaCache.get(id) ?? null;
  try {
    const res = await fetch(asset(`scenarios/${id}.json`));
    if (!res.ok) throw new Error(`${res.status}`);
    const meta = (await res.json()) as ScenarioMeta;
    metaCache.set(id, meta);
    return meta;
  } catch {
    metaCache.set(id, null);
    return null;
  }
}

async function loadTemplate(id: string): Promise<string> {
  const cached = templateCache.get(id);
  if (cached) return cached;
  const res = await fetch(asset(`scenarios/${id}.html`));
  if (!res.ok) throw new Error(`Mẫu kịch bản "${id}" bị thiếu (${res.status}).`);
  const html = await res.text();
  templateCache.set(id, html);
  return html;
}

/** Kết xuất lại một mẫu với params mới (dùng bởi đường tinh chỉnh kịch bản, vốn
 *  trộn một bản vá params và cần tài liệu mới). */
export async function rerender(
  id: string,
  params: Record<string, unknown>,
): Promise<string> {
  return renderTemplate(await loadTemplate(id), params);
}

// ----------------------------------------------------------------- kết xuất

/**
 * Trộn params lúc tái tạo lên các giá trị mặc định của kịch bản và kiểm tra rằng
 * mọi param bắt buộc đều có mặt. Trả về null khi kịch bản không xác định hoặc
 * một param bắt buộc không có giá trị (bên gọi quay về sinh đầy đủ).
 */
export function normalizeParams(
  meta: ScenarioMeta | null,
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const merged: Record<string, unknown> = { ...(meta.param_defaults ?? {}) };
  if (params && typeof params === 'object') Object.assign(merged, params);
  for (const key of meta.required_params ?? []) {
    if (merged[key] === undefined || merged[key] === null) return null;
  }
  return merged;
}

/** Chèn params vào mẫu. `JSON.stringify` giữ giá trị được thay thế an toàn bên
 *  trong literal `const PARAMS = __PARAMS__;` của mẫu. */
export function renderTemplate(html: string, params: Record<string, unknown>): string {
  return html.replace('__PARAMS__', JSON.stringify(params));
}

// ----------------------------------------------------- phân tích / tiêu đề

interface StructureEntry {
  meshId?: string;
  name?: string;
  system?: string;
  conceptName?: string;
  description?: string;
  summary?: string;
  region?: string;
  type?: string;
}
interface ConceptEntry {
  name?: string;
  elements?: string[];
}
export interface DetailsData {
  structures?: Record<string, StructureEntry>;
  entries?: Record<string, StructureEntry>;
  concepts?: Record<string, ConceptEntry>;
  aliases?: Record<string, unknown>;
  systems?: Record<string, string[]>;
  systemColors?: Record<string, string>;
}

const detailsCache = new Map<string, Promise<DetailsData | null>>();

export function loadDetails(rel: string): Promise<DetailsData | null> {
  if (!detailsCache.has(rel)) {
    detailsCache.set(
      rel,
      fetch(asset(rel))
        .then((r) => (r.ok ? (r.json() as Promise<DetailsData>) : null))
        .catch(() => null),
    );
  }
  return detailsCache.get(rel)!;
}

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Bản chuyển từ `_resolve_term` của ai4edu: văn bản tự do -> các khóa mục khớp,
 *  kèm cờ cho biết thuật ngữ có mang ý nghĩa gì trong tập dữ liệu này không. */
export function resolveTerm(
  data: DetailsData,
  term: string,
): { keys: string[]; recognized: boolean } {
  const entries = data.structures ?? data.entries ?? {};
  const aliases = data.aliases ?? {};
  const concepts = data.concepts ?? {};
  const conceptByName = new Map<string, ConceptEntry>();
  for (const c of Object.values(concepts)) {
    if (c?.name) conceptByName.set(c.name.toLowerCase(), c);
  }

  const t = term.trim().toLowerCase();
  const key = t.replace(/ /g, '_');
  if (key in entries) return { keys: [key], recognized: true };

  const apply = (spec: Record<string, unknown>): string[] => {
    const out: string[] = [];
    for (const cid of asList(spec.concept)) {
      const c =
        concepts[String(cid)] ?? conceptByName.get(String(cid).toLowerCase());
      if (c) out.push(...(c.elements ?? []).filter((e) => e in entries));
    }
    for (const sys of asList(spec.system)) {
      for (const [k, e] of Object.entries(entries)) {
        if (e.system === sys) out.push(k);
      }
    }
    for (const sub of asList(spec.substr)) {
      for (const [k, e] of Object.entries(entries)) {
        if (String(e.name ?? '').toLowerCase().includes(String(sub).toLowerCase())) {
          out.push(k);
        }
      }
    }
    for (const m of asList(spec.mesh)) if (String(m) in entries) out.push(String(m));
    return out;
  };

  const spec = aliases[t] ?? aliases[key];
  if (typeof spec === 'string') {
    return { keys: spec in entries ? [spec] : [], recognized: true };
  }
  if (spec && typeof spec === 'object') {
    return { keys: apply(spec as Record<string, unknown>), recognized: true };
  }

  const c = conceptByName.get(t);
  if (c) {
    return { keys: (c.elements ?? []).filter((e) => e in entries), recognized: true };
  }

  const hits = Object.entries(entries)
    .filter(([, e]) => t && String(e.name ?? '').toLowerCase().includes(t))
    .map(([k]) => k);
  return { keys: hits, recognized: hits.length > 0 };
}

/** Phép thay thế `{key}` giản dị — các mẫu kiểu `String.format` với dấu ngoặc
 *  thừa sẽ làm nổ một bộ định dạng thật, và params thì có hình dạng do mô hình
 *  tạo ra. */
function fill(template: string, values: Record<string, unknown>): string {
  let out = template;
  for (const [k, v] of Object.entries(values)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/**
 * Params -> (phân tích, tiêu đề, resolved) cho các khối `analysis` /
 * `title_template` của một kịch bản. Phép tra trong tệp chi tiết ánh xạ một
 * param văn bản tự do sang các mục có tên để tiêu đề có thể đọc là
 * "Anatomy: Heart" mà không cần mô hình.
 */
export async function buildAnalysis(
  id: string,
  meta: ScenarioMeta,
  params: Record<string, unknown>,
): Promise<{ analysis: ArtifactAnalysis | null; title: string; resolved: boolean }> {
  const spec = meta.analysis ?? {};
  const keyParam = spec.key_param;
  const values: Record<string, unknown> = { ...params, label: '' };
  if (keyParam && params[keyParam] != null) values.label = String(params[keyParam]);

  let matched: StructureEntry[] = [];
  let resolved = true;

  const details = spec.details_file ? await loadDetails(spec.details_file) : null;
  if (details && keyParam && values.label) {
    const { keys, recognized } = resolveTerm(details, String(values.label));
    const entries = details.structures ?? details.entries ?? {};
    matched = keys.map((k) => entries[k]).filter((e): e is StructureEntry => !!e);
    resolved = matched.length > 0 || recognized;
  }

  const observation: string[] = [];
  if (spec.observation_template) {
    observation.push(fill(spec.observation_template, values).trim());
  }
  if (matched.length) {
    const names = [...new Set(matched.map((m) => m.name).filter(Boolean))];
    values.matched_names = names.join(', ');
    let clause = `Khớp: ${names.join(', ')}`;
    if (matched[0]!.region) clause += ` (${String(matched[0]!.region).replace(/_/g, ' ')})`;
    observation.push(clause + '.');
    const summary = matched[0]!.summary ?? matched[0]!.description;
    if (summary) observation.push(String(summary));
  }

  const notes: string[] = [];
  if (details && keyParam && values.label && !matched.length && !resolved) {
    notes.push(`"${String(values.label)}" không có trong bộ mô hình đi kèm.`);
  }
  for (const field of spec.notes_fields ?? []) {
    const vals = matched
      .map((m) => (m as Record<string, unknown>)[field])
      .filter((v): v is string => typeof v === 'string' && !!v);
    if (vals.length) notes.push(vals.slice(0, 3).join('\n\n'));
  }

  const analysis: ArtifactAnalysis | null =
    observation.length || notes.length
      ? {
          observation: observation.filter(Boolean).join(' ').trim(),
          derived_models: [],
          notes: notes.join('\n\n').trim(),
        }
      : null;

  let title = meta.title_template
    ? fill(meta.title_template, values)
    : id.replace(/_/g, ' ');
  title = title.trim().replace(/:$/, '') || id.replace(/_/g, ' ');

  // Param khóa thiếu/rỗng nghĩa là "toàn bộ mô hình", vốn luôn phân giải được.
  if (spec.require_resolved) {
    const label = keyParam ? String(params[keyParam] ?? '').trim() : '';
    resolved = resolved || !label;
  }

  return { analysis, title, resolved };
}

// ----------------------------------------------------------------- điểm vào

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}

/**
 * Một lời gọi cho đường chọn từ danh mục: chuẩn hóa params, kết xuất mẫu, suy ra
 * tiêu đề + phân tích. Ném ScenarioError kèm thông báo dành cho người dùng.
 */
export async function instantiate(
  id: string,
  params: Record<string, unknown> = {},
): Promise<InstantiatedScenario> {
  const meta = await getMeta(id);
  if (!meta) throw new ScenarioError(`Không rõ mục "${id}".`);
  const merged = normalizeParams(meta, params);
  if (!merged) {
    throw new ScenarioError(
      `"${id}" cần ${(meta.required_params ?? []).join(', ')} — thứ mà trình chọn không cung cấp.`,
    );
  }
  const html = renderTemplate(await loadTemplate(id), merged);
  const { analysis, title, resolved } = await buildAnalysis(id, meta, merged);
  return { scenario: id, params: merged, html, title, analysis, resolved };
}

/** Biến một kịch bản đã khởi tạo thành một kết quả sẵn sàng để đặt lên bảng. */
export function scenarioArtifact(inst: InstantiatedScenario): Artifact {
  return {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    kind: 'scenario',
    title: inst.title,
    source_element_ids: [],
    payload: {
      scenario: inst.scenario,
      params: inst.params,
      html: inst.html,
    },
    analysis: inst.analysis,
    updated_at: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------- phân loại

/**
 * Danh mục kịch bản đúng như prompt của bộ phân loại nhìn thấy — cùng khối gạch
 * đầu dòng mà `catalog_text()` của ai4edu dựng nên (`**id** — match` + đặc tả
 * params của nó).
 */
export function buildCatalogText(metas: Record<string, ScenarioMeta>): string {
  const lines = Object.values(metas)
    .filter((m) => m.id && m.match && m.params)
    .map((m) => `- **${m.id}** — ${m.match}\n  params: ${m.params}`);
  return lines.length ? lines.join('\n') : '(none registered)';
}

const metaCacheAll = new Map<string, ScenarioMeta | null>();

/** Nạp metadata cho mọi kịch bản trong danh mục (được lưu tạm theo id). */
export async function loadAllMetas(): Promise<Record<string, ScenarioMeta>> {
  const out: Record<string, ScenarioMeta> = {};
  await Promise.all(
    SCENARIO_IDS.map(async (id) => {
      const cached = metaCacheAll.get(id);
      const meta = cached !== undefined ? cached : await getMeta(id);
      metaCacheAll.set(id, meta);
      if (meta) out[id] = { ...meta, id };
    }),
  );
  return out;
}

export interface ClassifyHint {
  scenario: string | null;
  params: Record<string, unknown>;
  observation: string;
}

export { ASSET_BASE };