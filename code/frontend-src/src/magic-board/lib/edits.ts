/**
 * Áp dụng chỉnh sửa tìm/thay cho kết quả tinh chỉnh của mô hình.
 *
 * Bản chuyển trực tiếp từ `app/edits.py` của backend ai4edu (ngữ nghĩa `diff` của
 * aider / FileEdit của Claude Code) để giao kèo tinh chỉnh hành xử đúng như khi
 * còn ở phía máy chủ:
 *  - khớp chuỗi chính xác trước; mỗi đoạn cần tìm phải xuất hiện đúng một lần
 *  - dự phòng: khớp một dãy dòng con, bỏ qua khoảng trắng cuối dòng
 *  - nguyên tử: mọi chỉnh sửa áp dụng lên một bản sao trong bộ nhớ, và mọi lỗi
 *    đều ném ra kèm tên chỉnh sửa vi phạm — không bao giờ trả về kết quả nửa vời
 *
 * Cộng thêm các op theo id cho kết quả `elements`: mô hình phát ra
 * {op,id,patch} đáng tin cậy hơn nhiều so với diff trên một mảng JSON.
 */
import type { SkeletonElement } from './types';

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

/** Vị trí bắt đầu của `needle` trong `doc` khi khớp theo từng dòng, bỏ qua
 *  khoảng trắng cuối mỗi dòng. */
function lineMatches(doc: string, needle: string): number[] {
  const needleLines = needle.split('\n').map((ln) => ln.replace(/\s+$/, ''));
  if (!needleLines.length || (needleLines.length === 1 && needleLines[0] === '')) {
    return [];
  }
  // Giữ lại các ký tự xuống dòng để độ lệch khớp với chuỗi gốc.
  const docLines = doc.split('\n');
  const stripped = docLines.map((ln) => ln.replace(/\s+$/, ''));
  const offsets: number[] = [0];
  for (let i = 0; i < docLines.length - 1; i++) {
    offsets.push(offsets[i]! + docLines[i]!.length + 1);
  }
  const hits: number[] = [];
  const n = needleLines.length;
  for (let i = 0; i + n <= stripped.length; i++) {
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (stripped[i + k] !== needleLines[k]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(offsets[i]!);
  }
  return hits;
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Dòng (tính từ 1) nơi `needle` sẽ áp dụng trong `doc`, hoặc null khi nó không
 *  khớp (đúng một lần — khớp chính xác trước, rồi tới bản dự phòng đã chuẩn hóa
 *  theo dòng). Dùng để báo "nằm ở dòng N" trong khi phần thay thế vẫn đang được
 *  truyền tới. */
export function findMatchLine(doc: string, needle: string): number | null {
  if (!needle) return null;
  if (occurrences(doc, needle) === 1) {
    return doc.slice(0, doc.indexOf(needle)).split('\n').length;
  }
  const hits = lineMatches(doc, needle);
  if (hits.length === 1) {
    return doc.slice(0, hits[0]!).split('\n').length;
  }
  return null;
}

export interface Edit {
  search: string;
  replace: string;
}

/** Áp dụng các khối [{search, replace}] lên `doc`. Nguyên tử — ném EditError
 *  (kèm đoạn văn bản cần tìm bị lỗi) nếu chỉnh sửa nào khớp 0 hoặc >1 lần. */
export function applyEdits(doc: string, edits: Edit[]): string {
  let result = doc;
  edits.forEach((edit, i) => {
    const search = edit.search;
    const replace = edit.replace ?? '';
    if (typeof search !== 'string' || !search) {
      throw new EditError(`chỉnh sửa ${i}: thiếu/rỗng văn bản 'search'`);
    }
    const firstLine = search.split('\n')[0] ?? '';
    const excerpt = firstLine.slice(0, 80) + (search.includes('\n') ? '…' : '');

    const count = occurrences(result, search);
    if (count === 1) {
      result = result.replace(search, replace);
      return;
    }

    const hits = count === 0 ? lineMatches(result, search) : [];
    if (hits.length === 1) {
      // Khớp đã chuẩn hóa theo dòng: cắt theo ranh giới dòng — đoạn khớp là n
      // dòng của doc bắt đầu tại vị trí tìm thấy, nhờ đó hấp thụ khác biệt về
      // khoảng trắng cuối dòng giữa đoạn cần tìm và doc.
      const start = hits[0]!;
      const n = search.split('\n').length;
      const before = result.slice(0, start);
      const lineIdx = before.split('\n').length - 1;
      const docLines = result.split('\n');
      let end = start;
      for (let k = 0; k < n; k++) {
        const ln = docLines[lineIdx + k] ?? '';
        end += ln.length;
        if (k < n - 1) end += 1; // ký tự xuống dòng đã bị tách ra
      }
      result = before + replace + result.slice(end);
      return;
    }

    const why =
      count === 0 && !hits.length
        ? 'không tìm thấy'
        : `không rõ ràng (khớp ${Math.max(count, hits.length)} lần)`;
    throw new EditError(`chỉnh sửa ${i} ${why}: văn bản cần tìm bắt đầu bằng '${excerpt}'`);
  });
  return result;
}

// ---------- Các op trên phần tử khung (loại kết quả `elements`) ----------

export type ElementOp =
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'add'; elements: SkeletonElement[] }
  | { op: 'remove'; ids: string[] };

/** Áp dụng [{op: update|add|remove}] lên danh sách phần tử khung. Nguyên tử —
 *  ném EditError kèm op bị lỗi; danh sách đầu vào không bao giờ bị biến đổi. */
export function applyElementOps(
  elements: SkeletonElement[],
  ops: unknown[],
): SkeletonElement[] {
  let result: SkeletonElement[] = elements.map((el) => ({ ...el }));

  const indexOf = (elId: unknown) =>
    result.findIndex((el) => el.id === elId);

  ops.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new EditError(`op ${i}: không phải một đối tượng`);
    }
    const op = raw as Record<string, unknown>;
    const kind = op.op;

    if (kind === 'update') {
      const patch = op.patch;
      if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
        throw new EditError(`op ${i}: update cần một 'patch' không rỗng`);
      }
      const idx = indexOf(op.id);
      if (idx < 0) throw new EditError(`op ${i}: không có phần tử nào với id ${String(op.id)}`);
      // id là danh tính — không bao giờ được ghi đè.
      const { id: _drop, ...fields } = patch as Record<string, unknown>;
      result[idx] = { ...result[idx]!, ...fields };
      return;
    }

    if (kind === 'add') {
      const newEls = op.elements;
      if (!Array.isArray(newEls) || !newEls.length) {
        throw new EditError(`op ${i}: add cần một 'elements' không rỗng`);
      }
      const existing = new Set(result.map((el) => el.id));
      for (const el of newEls) {
        if (!el || typeof el !== 'object' || !(el as SkeletonElement).id) {
          throw new EditError(`op ${i}: phần tử được thêm thiếu 'id' bắt buộc`);
        }
        const id = (el as SkeletonElement).id!;
        if (existing.has(id)) {
          throw new EditError(`op ${i}: id phần tử được thêm '${id}' đã tồn tại`);
        }
        existing.add(id);
      }
      result = result.concat(newEls as SkeletonElement[]);
      return;
    }

    if (kind === 'remove') {
      const ids = op.ids;
      if (!Array.isArray(ids) || !ids.length) {
        throw new EditError(`op ${i}: remove cần một 'ids' không rỗng`);
      }
      for (const elId of ids) {
        if (indexOf(elId) < 0) {
          throw new EditError(`op ${i}: không có phần tử nào với id ${String(elId)}`);
        }
      }
      const drop = new Set(ids);
      result = result.filter((el) => !drop.has(el.id));
      return;
    }

    throw new EditError(`op ${i}: op không xác định ${JSON.stringify(kind)}`);
  });

  return result;
}
