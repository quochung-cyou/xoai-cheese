/**
 * artifactDoc — các phép biến đổi tài liệu HTML thuần áp dụng lên tài liệu kết
 * quả đã lưu (html_sim do mô hình sinh ra và mọi thứ được nhập vào). Bản chuyển
 * từ `lib/artifactDoc.ts` của ai4edu, bỏ đi bước di trú theo khung cũ vốn chỉ áp
 * dụng cho các tài liệu đóng gói sẵn của dự án đó.
 */
import { BOARD_BG } from './boardTheme';

export const globalsTag = (artifactId: string): string =>
  `<script>window.__MAGIC_BOARD_ARTIFACT_ID__=${JSON.stringify(artifactId)};</script>`;

export const GLOBALS_TAG_RE =
  /<script>window\.__MAGIC_BOARD_ARTIFACT_ID__=[^<]*<\/script>/;

/** Chèn id kết quả vào một tài liệu iframe để các script bên trong iframe được
 *  sandbox có thể tự nhận diện trong lưu lượng postMessage.
 *  (iframe của kết quả chạy trên origin đục — không có localStorage, và trang cha
 *  không thể chạm tới DOM của chúng, nên postMessage là kênh duy nhất.) */
export function injectArtifactGlobals(html: string, artifactId: string): string {
  const tag = globalsTag(artifactId);
  const head = html.indexOf('<head>');
  if (head >= 0) {
    const at = head + '<head>'.length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

const BOARD_BLEND_TAG = '<style data-magic-board-blend>';

/** Các mô phỏng được sinh ra tự tô nền đục của chúng (iframe bị sandbox không thể
 *  trong suốt thật sự), nên hãy khởi tạo chúng bằng màu của bảng và đồng bộ trực
 *  tiếp qua cầu postMessage khi màu bảng vẽ thay đổi. Dùng !important để kiểu
 *  dáng body của chính tài liệu không thể chống lại. */
export function ensureBoardBlend(html: string): string {
  if (html.includes('boardBg') || html.includes('data-magic-board-blend')) {
    return html;
  }
  const tag =
    `${BOARD_BLEND_TAG}html,body{background:${BOARD_BG} !important}</style>` +
    `<script>(function(){window.parent.postMessage({source:'magic-board',` +
    `type:'ready',artifactId:window.__MAGIC_BOARD_ARTIFACT_ID__},'*');` +
    `addEventListener('message',function(e){var d=e.data;` +
    `if(d&&d.source==='magic-board'&&typeof d.boardBg==='string'&&` +
    `/^#[0-9a-f]{3,8}$/i.test(d.boardBg)){` +
    `document.documentElement.style.setProperty('background',d.boardBg,'important');` +
    `document.body.style.setProperty('background',d.boardBg,'important')}})})();</script>`;
  const headEnd = html.indexOf('</head>');
  if (headEnd >= 0) return html.slice(0, headEnd) + tag + html.slice(headEnd);
  const bodyEnd = html.indexOf('</body>');
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + tag + html.slice(bodyEnd);
  return html + tag;
}

/** Đường ống xử lý tài liệu đã lưu — được áp dụng ở mọi nơi tài liệu đi vào hoặc
 *  tồn tại trên một phần tử. */
export const prepareArtifactHtml = (html: string): string => ensureBoardBlend(html);
