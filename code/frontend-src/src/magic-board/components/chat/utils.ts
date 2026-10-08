import type { Artifact } from '../../lib/types';

export const KIND_LABELS: Record<Artifact['kind'], string> = {
  html_sim: 'Mô phỏng',
  scenario: 'Mô phỏng',
  elements: 'Sơ đồ',
};

/** Thời gian ở đầu tin nhắn — '2 thg 4 · 14:35' hoặc chỉ '14:35' nếu là hôm nay. */
export function fmtAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : `${d.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' })} · ${time}`;
}
