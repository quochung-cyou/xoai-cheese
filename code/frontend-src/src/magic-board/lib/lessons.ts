/** Cached, bundled Vietnamese lesson content for anatomy scenarios. No model call is needed. */
import type { Artifact } from './types';
import { anatomyOrgans } from './lessonsAnatomyOrgans';
import { anatomyBody } from './lessonsAnatomyBody';

export interface Lesson {
  title: string;
  explanation: string;
  points: string[];
  questions: { prompt: string; choices: string[]; correct: number; explanation: string }[];
}

const aliases: Record<string, string> = {
  tim: 'heart', 'trái tim': 'heart', não: 'brain', phổi: 'lungs', lung: 'lungs',
  thận: 'kidney', gan: 'liver', mắt: 'eye', 'bộ xương': 'skeleton',
  'hệ xương': 'skeleton', 'hộp sọ': 'skull', 'hệ cơ': 'muscles',
  'cột sống': 'spine', 'bàn tay': 'hand', 'bàn chân': 'foot',
};

export function lessonForArtifact(artifact: Artifact): Lesson | null {
  if (artifact.kind !== 'scenario' || artifact.payload.scenario !== 'anatomy_3d') return null;
  const focus = String(artifact.payload.params?.focus ?? '').trim();
  const key = aliases[focus.toLowerCase()] ?? focus.toLowerCase();
  const known = anatomyOrgans[key] ?? anatomyBody[key];
  if (known) return known;
  // The anatomy viewer accepts free-form structure names; keep the note honest
  // rather than inventing a function for a structure we have not reviewed.
  return {
    title: `Tìm hiểu cấu trúc: ${focus}`,
    explanation: `Mô hình 3D đang tập trung vào “${focus}”. Hãy xoay mô hình để xác định vị trí và quan sát các cấu trúc nằm sát nó.`,
    points: [
      'Đối chiếu tên cấu trúc với sách giáo khoa để xác nhận nó thuộc hệ cơ quan nào.',
      'Nhấp đúp để ẩn bộ phận che khuất; quan sát từ nhiều hướng trước khi kết luận.',
    ],
    questions: [
      { prompt: 'Để quan sát cấu trúc từ phía sau, em làm gì?', choices: ['Xoay mô hình 3D', 'Đổi màu nền', 'Tắt màn hình'], correct: 0, explanation: 'Kéo chuột để xoay mô hình và quan sát các mặt khác nhau.' },
      { prompt: 'Làm sao nhìn thấy bộ phận nằm sâu bên trong?', choices: ['Nhấp đúp để ẩn lớp che', 'Chỉ phóng to', 'Đọc tên bộ phận'], correct: 0, explanation: 'Bóc tách lớp ngoài giúp thấy cấu trúc phía trong.' },
    ],
  };
}
