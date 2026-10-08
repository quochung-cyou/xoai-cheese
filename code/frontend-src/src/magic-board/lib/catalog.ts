/**
 * Danh mục vật thể phía sau bảng chọn nổi.
 *
 * Mỗi mục là một id kịch bản (scenario) kèm nhãn hiển thị và tham số để tạo —
 * việc tạo diễn ra tức thì, nên những gì thường cần nhập liệu (một phương
 * trình, một vùng giải phẫu) đều được đưa ra dưới dạng mẫu dựng sẵn có tên.
 * Các mô phỏng được tạo ra mang theo bộ điều khiển riêng, nên người dùng vẫn
 * chỉnh tiếp được sau khi nó đã nằm trên bảng.
 *
 * LƯU Ý: trường `id`, `scenario` và các giá trị trong `params` (đặc biệt là
 * `focus`, `book`) là hợp đồng với kịch bản, KHÔNG phải chữ hiển thị — không
 * được dịch.
 */
import type { ScenarioId } from './scenarios';

export type CatalogCategoryId =
  | 'shapes3d'
  | 'graphs'
  | 'books'
  | 'algorithms'
  | 'ai'
  | 'physics'
  | 'biology';

export interface CatalogItem {
  /** Id ổn định — cũng là key của React. */
  id: string;
  /** Chuỗi người dùng đọc và chọn. */
  label: string;
  scenario: ScenarioId;
  params: Record<string, unknown>;
  /** Một dòng hiển thị dưới nhãn. */
  hint: string;
}

export interface CatalogCategory {
  id: CatalogCategoryId;
  label: string;
  /** Tên icon lucide-react, được phân giải trong bảng chọn. */
  icon: 'Box' | 'LineChart' | 'BookOpen' | 'Network' | 'Brain' | 'Atom' | 'HeartPulse';
  items: CatalogItem[];
}

/** Giải phẫu là nhóm duy nhất đáng dựng sẵn: trình xem nhận `focus` dạng văn
 *  bản tự do, và đây là những bí danh đã biết chắc là có trong atlas đi kèm. */
const anatomy = (
  id: string,
  label: string,
  focus: string,
  hint: string,
): CatalogItem => ({
  id,
  label,
  scenario: 'anatomy_3d',
  params: { focus, systems: [], isolate: true },
  hint,
});

export const CATALOG: CatalogCategory[] = [
  {
    id: 'biology',
    label: 'Giải phẫu',
    icon: 'HeartPulse',
    items: [
      anatomy('anatomy-heart', 'Tim 3D', 'heart', 'Giải phẫu tim, tách riêng'),
      anatomy('anatomy-body', 'Toàn thân 3D', '', 'Đủ bộ xương và nội tạng, mọi hệ cơ quan'),
      anatomy('anatomy-brain', 'Não 3D', 'brain', 'Hệ thần kinh, tách riêng'),
      anatomy('anatomy-lungs', 'Phổi 3D', 'lungs', 'Hệ hô hấp'),
      anatomy('anatomy-skeleton', 'Bộ xương', 'skeleton', 'Toàn bộ hệ xương'),
      anatomy('anatomy-skull', 'Hộp sọ', 'skull', 'Các xương sọ'),
      anatomy('anatomy-muscles', 'Hệ cơ', 'muscles', 'Toàn bộ hệ cơ'),
      anatomy('anatomy-kidney', 'Thận', 'kidney', 'Hệ tiết niệu'),
      anatomy('anatomy-liver', 'Gan', 'liver', 'Hệ tiêu hóa'),
      anatomy('anatomy-eye', 'Mắt', 'eye', 'Hệ thị giác'),
    ],
  },
  {
    id: 'shapes3d',
    label: 'Hình khối 3D',
    icon: 'Box',
    items: [
      item('sphere', 'Hình cầu', 'sphere', {}, 'Bán kính, trải phẳng, cắt lát, tô màu'),
      item('cone', 'Hình nón & tiết diện conic', 'cone', {}, 'Mặt phẳng cắt qua hình nón'),
      item('cylinder', 'Hình trụ', 'cylinder', {}, 'Điều chỉnh bán kính và chiều cao'),
      item('torus', 'Hình xuyến', 'torus', {}, 'Mặt bánh vòng với bán kính lớn/nhỏ'),
      item('knot', 'Nút thắt ba lá', 'knot', {}, 'Đường cong trong lý thuyết nút'),
      item('mobius', 'Dải Möbius', 'mobius', {}, 'Dải xoắn chỉ có một mặt'),
      item('helix', 'Đường xoắn ốc', 'helix', {}, 'Lò xo / cuộn xoắn'),
      item('wave', 'Mặt sóng', 'wave', {}, 'Gợn sóng với biên độ và tần số'),
      item('saddle', 'Mặt yên ngựa', 'saddle', {}, 'Paraboloid hyperbolic'),
      item('paraboloid', 'Paraboloid', 'paraboloid', {}, 'Chảo parabol'),
      item(
        'hyperboloid',
        'Hyperboloid',
        'hyperboloid',
        {},
        'Mặt cong có đường sinh kiểu tháp tản nhiệt',
      ),
      item('gaussian', 'Gò Gauss', 'gaussian', {}, 'Mặt phân phối chuẩn'),
      item('lathe', 'Mặt tròn xoay', 'lathe', {}, 'Biên dạng bình hoa quay quanh trục'),
      item('platonic', 'Khối đa diện đều', 'platonic', {}, 'Từ tứ diện đến nhị thập diện'),
      item('tetrahedron', 'Tứ diện', 'tetrahedron', {}, 'Có ghi nhãn A B C D'),
    ],
  },
  {
    id: 'graphs',
    label: 'Phương trình',
    icon: 'LineChart',
    items: [
      item(
        'fn-parabola',
        'Parabol  y = x²',
        'function_plot',
        { fn: 'x^2', x_min: -10, x_max: 10 },
        'Đồ thị chỉnh sửa được',
      ),
      item(
        'fn-sine',
        'Hàm sin  y = sin(x)',
        'function_plot',
        { fn: 'sin(x)', x_min: -10, x_max: 10 },
        'Đồ thị chỉnh sửa được',
      ),
      item(
        'fn-cubic',
        'Hàm bậc ba  y = x³ − 2x',
        'function_plot',
        { fn: 'x^3 - 2x', x_min: -5, x_max: 5 },
        'Đồ thị chỉnh sửa được',
      ),
      item(
        'fn-exp',
        'Hàm mũ  y = eˣ',
        'function_plot',
        { fn: 'e^x', x_min: -3, x_max: 3 },
        'Đồ thị chỉnh sửa được',
      ),
      item(
        'fn-sqrt',
        'Hàm căn  y = √x',
        'function_plot',
        { fn: 'sqrt(x)', x_min: 0, x_max: 20 },
        'Đồ thị chỉnh sửa được',
      ),
      item('matmul', 'Nhân ma trận', 'matrix_mult', {}, 'A × B từng bước'),
    ],
  },
  {
    id: 'books',
    label: 'Sách giáo khoa',
    icon: 'BookOpen',
    items: [
      item(
        'book-sgk10',
        'Toán 10 — sách lật trang',
        'book',
        { book: 'sgk', page: 1 },
        'Sách giáo khoa Toán lớp 10, đọc kiểu lật trang',
      ),
    ],
  },
  {
    id: 'algorithms',
    label: 'Thuật toán',
    icon: 'Network',
    items: [
      item('sort', 'Sắp xếp nổi bọt', 'bubble_sort', {}, 'Hoán đổi có hoạt họa, mảng chỉnh sửa được'),
      item('matrix', 'Nhân ma trận', 'matrix_mult', {}, 'Duyệt theo từng ô lưới'),
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'Brain',
    items: [
      item('nn', 'Mạng nơ-ron', 'neural_network', {}, 'Lan truyền xuôi, mèo và chó'),
      item('backprop', 'Lan truyền ngược', 'backprop', {}, 'Gradient chảy ngược về trước'),
      item(
        'conv',
        'Quy trình tích chập',
        'conv_pipeline',
        {},
        'Kernel → bản đồ đặc trưng → tầng dày đặc',
      ),
    ],
  },
  {
    id: 'physics',
    label: 'Vật lý',
    icon: 'Atom',
    items: [
      item('pendulum', 'Con lắc', 'pendulum', {}, 'Chiều dài, trọng lực, biên độ'),
      item('projectile', 'Chuyển động ném', 'projectile', {}, 'Tốc độ và góc ném'),
      item('rc', 'Mạch RC', 'rc_circuit', {}, 'Đường cong nạp của tụ điện'),
      item('faraday-vi', 'Phòng thí nghiệm điện từ Faraday', 'faraday_vi', {}, 'Mô phỏng tiếng Việt · đo lường, ghi dữ liệu và bài thực hành · PhET CC BY-NC 4.0'),
      item('faraday-en', 'Faraday’s Electromagnetic Lab (EN)', 'faraday_en', {}, 'Bản gốc tiếng Anh · PhET CC BY-NC 4.0'),
      item('ph-scale-en', 'Thang pH cơ bản (EN)', 'ph_scale_en', {}, 'Khám phá axit, bazơ và pH · PhET CC BY-NC 4.0'),
    ],
  },
];

function item(
  id: string,
  label: string,
  scenario: ScenarioId,
  params: Record<string, unknown>,
  hint: string,
): CatalogItem {
  return { id, label, scenario, params, hint };
}

/** Các chip chọn nhanh ở đầu khung giải phẫu (AnatomyPicker của ai4edu cũng có
 *  ý tưởng tương tự). `toàn thân` ứng với focus rỗng. */
export const ANATOMY_QUICK: { label: string; focus: string }[] = [
  { label: 'toàn thân', focus: '' },
  { label: 'bộ xương', focus: 'skeleton' },
  { label: 'hộp sọ', focus: 'skull' },
  { label: 'cột sống', focus: 'spine' },
  { label: 'tim', focus: 'heart' },
  { label: 'não', focus: 'brain' },
  { label: 'phổi', focus: 'lungs' },
  { label: 'hệ cơ', focus: 'muscles' },
  { label: 'bàn tay', focus: 'hand' },
  { label: 'bàn chân', focus: 'foot' },
];
