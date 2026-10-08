const fs = require('node:fs');
const path = require('node:path');
const dir = 'code/frontend-src/public/mb-assets/scenarios';
const files = ['bubble_sort.html', 'function_plot.html', 'pendulum.html', 'projectile.html', 'rc_circuit.html'];

// Things that MUST survive intact, per file, from the translator's own report.
const EXPECT = {
  'pendulum.html': ['Con lắc đơn', 'sẵn sàng', 'Yêu cầu thất bại', 'Đặt lại', 'Tạm dừng'],
  'projectile.html': ['Chuyển động ném', 'Yêu cầu thất bại', 'Tạm dừng'],
  'rc_circuit.html': ['Mạch RC', 'Yêu cầu thất bại', 'Phóng điện'],
  'bubble_sort.html': ['Sắp xếp nổi bọt', 'Yêu cầu thất bại', 'Áp dụng', 'Tốc độ'],
  'function_plot.html': ['Đồ thị hàm số', 'Yêu cầu thất bại', 'không hợp lệ'],
};

for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const missing = EXPECT[f].filter((t) => !s.includes(t));
  const params = (s.match(/__PARAMS__/g) || []).length;
  const lang = /<html[^>]*lang="vi"/i.test(s);
  // every <script> block must still be balanced-ish: count brackets
  const open = (s.match(/[{([]/g) || []).length;
  const close = (s.match(/[})\]]/g) || []).length;
  const ok = !missing.length && params >= 1 && lang && open === close;
  console.log(
    (ok ? 'OK   ' : 'FAIL ') + f.padEnd(22),
    'lang=vi:' + lang,
    '__PARAMS__:' + params,
    'brackets:' + open + '/' + close,
    missing.length ? 'MISSING: ' + missing.join(', ') : '',
  );
}
