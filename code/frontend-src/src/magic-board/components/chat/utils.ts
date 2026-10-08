import type { Artifact } from '../../lib/types';

export const KIND_LABELS: Record<Artifact['kind'], string> = {
  html_sim: 'Sim',
  scenario: 'Sim',
  elements: 'Diagram',
};

/** Message header time — 'Apr 2 · 14:35' or just '14:35' for today. */
export function fmtAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}
