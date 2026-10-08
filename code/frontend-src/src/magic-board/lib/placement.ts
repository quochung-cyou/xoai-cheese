/**
 * Đặt vị trí cho các kết quả đã lưu tạm được tái tạo.
 *
 * Cố ý thuần (không dùng API của Excalidraw): cùng đoạn mã này định vị các kết
 * quả khi bảng vẽ đang hoạt động VÀ khi một lô được nối thẳng vào JSON cảnh của
 * một bảng đã lưu trong lúc khôi phục.
 */
import type { Rect } from './types';

const PAD = 28;
const STEP = 120;

/** Chiều cao mà một kết quả được tái tạo bị kẹp vào. Phản chiếu các hằng số
 *  trong boardTheme; được giữ cục bộ để mô-đun này không phụ thuộc gì (và để các
 *  bộ kiểm tra trong scripts/ có thể chạy thẳng nó). */
const FALLBACK_H = 420;
const MIN_H = 300;
const MAX_H = 600;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + PAD &&
    a.x + a.w > b.x - PAD &&
    a.y < b.y + b.h + PAD &&
    a.y + a.h > b.y - PAD
  );
}

/** Chiều cao của một kết quả được tái tạo, kẹp theo đúng cách việc đặt trực tiếp
 *  vẫn làm. */
function heightFor(source: Rect | null): number {
  return Math.min(Math.max(source?.h ?? FALLBACK_H, MIN_H), MAX_H);
}

/**
 * Tìm một rect trống gần `source` cho một kết quả có tỉ lệ khung đã cho.
 *
 * Khi không có bản phác thảo nguồn để đặt cạnh, `anchor` được dùng — bên gọi
 * truyền vào góc trên bên trái của bất cứ thứ gì đã có trên bảng, nên một lần
 * tái tạo luôn đáp xuống cạnh nội dung mà người dùng nhìn thấy.
 */
export function findFreeRect(
  source: Rect | null,
  aspect: number,
  occupied: readonly Rect[],
  anchor: { x: number; y: number },
): Rect {
  const h = heightFor(source);
  const w = h * aspect;
  const base: Rect = source
    ? { x: source.x + source.w + 80, y: source.y, w, h }
    : { x: anchor.x, y: anchor.y, w, h };

  // Các hàng đi xuống từ mốc neo, mỗi hàng mở rộng dần sang hai bên từ giữa.
  for (let row = 0; row < 12; row++) {
    const y = base.y + row * (base.h + 60);
    for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const r: Rect = { x: base.x + k * STEP, y, w, h };
      if (!occupied.some((o) => overlaps(r, o))) return r;
    }
  }

  // Bảng dày đặc: xếp xuống dưới thứ sâu nhất trong cột này.
  const column = occupied.filter(
    (o) => o.x < base.x + base.w && o.x + o.w > base.x,
  );
  const bottom = column.reduce((m, o) => Math.max(m, o.y + o.h), -Infinity);
  return {
    ...base,
    y: bottom === -Infinity ? base.y : Math.max(base.y, bottom + 60),
  };
}
