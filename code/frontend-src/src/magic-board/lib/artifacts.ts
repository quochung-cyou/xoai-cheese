/**
 * artifacts — mọi thứ mà kết quả của mô hình trở thành trên bảng vẽ.
 *
 * Bản chuyển từ `lib/artifacts.ts` của ai4edu. Phần kết nối các phần tử trên
 * bảng vẽ không đổi (đó mới là phép thuật thật sự): một tài liệu HTML được sinh
 * ra trở thành một phần tử `iframe` của Excalidraw, một danh sách phần tử khung
 * được sinh ra trở thành các phần tử gốc có thể chỉnh sửa, và một mũi tên nối
 * cong buộc mỗi thứ trở về bản phác thảo đã sinh ra nó.
 *
 * Bị bỏ khi chuyển sang: các hàm trợ giúp kiểm tra kịch bản theo lưới và bước
 * di trú HTML theo khung cũ.
 */
import { convertToExcalidrawElements, getCommonBounds } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

import { BOARD_BG, ARTIFACT_FALLBACK_H, ARTIFACT_MAX_H, ARTIFACT_MIN_H } from './boardTheme';
import {
  GLOBALS_TAG_RE,
  globalsTag,
  injectArtifactGlobals,
  prepareArtifactHtml,
} from './artifactDoc';
import type { Artifact, SkeletonElement } from './types';

/** Không gian tên postMessage dùng chung với shim trộn nền bảng được chèn vào. */
const MSG_SOURCE = 'magic-board';

/** Các phần tử do mô hình sở hữu — bị loại khỏi ảnh chụp phân tích để kết quả
 *  sinh ra không bao giờ quay lại nuôi lần phân tích kế tiếp. */
export function isGeneratedElement(el: ExcalidrawElement): boolean {
  return (
    el.type === 'iframe' ||
    el.type === 'embeddable' ||
    !!(el.customData as Record<string, unknown> | undefined)?.artifactId
  );
}

export function artifactIdOf(el: ExcalidrawElement): string | undefined {
  const id = (el.customData as Record<string, unknown> | undefined)?.artifactId;
  return typeof id === 'string' && id ? id : undefined;
}

export function artifactElements(
  elements: readonly ExcalidrawElement[],
  artifactId: string,
): ExcalidrawElement[] {
  return elements.filter(
    (el) =>
      !el.isDeleted &&
      (el.customData as Record<string, unknown> | undefined)?.artifactId ===
        artifactId,
  );
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Khoảng bao chung của một tập phần tử không rỗng, {x, y, w, h}. */
export function boundsOf(elements: readonly ExcalidrawElement[]): Rect | null {
  if (!elements.length) return null;
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Nơi một kết quả mới đi tới: bên phải bản phác thảo nguồn, căn thẳng hàng
 *  phía trên. */
export function placementRect(source: Rect | null, aspect: number): Rect {
  const h = Math.min(
    Math.max(source?.h ?? ARTIFACT_FALLBACK_H, ARTIFACT_MIN_H),
    ARTIFACT_MAX_H,
  );
  const w = h * aspect;
  return {
    x: (source?.x ?? 0) + (source?.w ?? 0) + 80,
    y: source?.y ?? 0,
    w,
    h,
  };
}

/**
 * Các phần tử trên bảng vẽ mà một kết quả hiển thị thành, được đặt tại `rect`:
 * một phần tử iframe duy nhất cho mô phỏng, một nhóm khung đã chuyển đổi cho sơ
 * đồ.
 *
 * Dùng chung cho việc đặt kết quả khi phân tích trực tiếp, dựng lại khi tinh
 * chỉnh, và tái tạo từ bộ nhớ tạm, nên cả ba đều tạo ra kết quả giống hệt nhau.
 */
export function artifactSceneElements(
  artifact: Artifact,
  rect: Rect,
): ExcalidrawElement[] {
  if (artifact.kind === 'elements') {
    return skeletonToSceneElements(artifact.payload.elements ?? [], rect, artifact.id);
  }
  return [makeSimIframeElement(rect, artifact.payload.html ?? '', artifact.id)];
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, len);
}

function randomInt(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

/** Mọi hình tô không trong suốt trên một iframe được sinh ra — Excalidraw vẽ nó
 *  lên bảng vẽ phía sau mô phỏng, nên nó phải giữ trong suốt. */
const needsClearBg = (el: ExcalidrawElement): boolean =>
  el.type === 'iframe' && !!artifactIdOf(el) && el.backgroundColor !== 'transparent';

/** Làm cho html đã lưu của một phần tử iframe mang đúng id kết quả như
 *  customData.artifactId của nó — chèn vào khi thiếu thẻ và ghi lại khi thẻ đã
 *  cũ (các phần tử được sao chép trên bảng vẽ sẽ được gắn lại vào một kết quả
 *  mới). Đồng thời bỏ mọi hình tô đục để mô phỏng hòa vào bảng.
 *
 *  LƯU Ý: thuộc tính `sandbox` của iframe được dựng bên trong Excalidraw và chỉ
 *  nhận `allow-same-origin` cho các kiểu nhúng mà chính nó công nhận, nên một
 *  tài liệu kết quả luôn chạy trên origin đục. Vì vậy các lời gọi dữ liệu của nó
 *  là cross-origin và phụ thuộc vào việc máy chủ tài sản gửi
 *  `Access-Control-Allow-Origin` — xem shim trong scripts/export-scenarios.mts
 *  và plugin assetCors trong vite.config.ts. */
export function syncArtifactGlobals(el: ExcalidrawElement): ExcalidrawElement {
  const cd = el.customData as
    | {
        artifactId?: unknown;
        generationData?: { html?: unknown } & Record<string, unknown>;
      }
    | undefined;
  const artifactId = typeof cd?.artifactId === 'string' ? cd.artifactId : null;
  const html = cd?.generationData?.html;
  if (!artifactId || typeof html !== 'string' || !cd?.generationData) return el;

  const next = GLOBALS_TAG_RE.test(html)
    ? html.replace(GLOBALS_TAG_RE, globalsTag(artifactId))
    : injectArtifactGlobals(html, artifactId);
  const clearBg = needsClearBg(el);
  if (next === html && !clearBg) return el;
  return {
    ...el,
    version: el.version + 1,
    ...(clearBg ? { backgroundColor: 'transparent' } : {}),
    customData: {
      ...cd,
      generationData: { ...cd.generationData, html: next },
    } as ExcalidrawElement['customData'],
  };
}

/** Lượt bù trừ cho cả cảnh — chạy khi tải để các iframe được khôi phục có thể
 *  tự nhận diện trong cầu postMessage. */
export function ensureArtifactGlobals(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.map(syncArtifactGlobals);
}

/**
 * Dựng một phần tử `iframe` của Excalidraw bọc lấy tài liệu HTML được sinh ra —
 * đúng cấu trúc mà tính năng wireframe-to-code của chính Excalidraw tạo ra
 * (`customData.generationData`).
 */
export function makeSimIframeElement(
  rect: Rect,
  html: string,
  artifactId: string,
): ExcalidrawElement {
  return {
    id: randomHex(20),
    type: 'iframe',
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    angle: 0,
    strokeColor: '#ced4da',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roundness: { type: 3 },
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    boundElements: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {
      artifactId,
      generationData: { status: 'done', html: prepareArtifactHtml(html) },
    },
  } as unknown as ExcalidrawElement;
}

const VIRTUAL_W = 1000;
const VIRTUAL_H = 750;

/**
 * Chuyển danh sách khung của mô hình (bảng vẽ ảo 1000x750) thành các phần tử
 * cảnh thật, được khớp vừa vào `rect`, gắn id kết quả và một nhóm dùng chung.
 * Id của khung được giữ nguyên (regenerateIds: false) để các op tinh chỉnh có
 * thể nhắm tới phần tử theo id.
 */
export function skeletonToSceneElements(
  skeleton: SkeletonElement[],
  rect: Rect,
  artifactId: string,
): ExcalidrawElement[] {
  const sx = rect.w / VIRTUAL_W;
  const sy = rect.h / VIRTUAL_H;
  const scaled = skeleton.map((el) => {
    const out: Record<string, unknown> = { ...el };
    out.x = rect.x + el.x * sx;
    out.y = rect.y + el.y * sy;
    if (typeof el.width === 'number') out.width = el.width * sx;
    if (typeof el.height === 'number') out.height = el.height * sy;
    if (typeof el.fontSize === 'number') out.fontSize = el.fontSize * sy;
    if (el.label && typeof el.label.fontSize === 'number') {
      out.label = { ...el.label, fontSize: el.label.fontSize * sy };
    }
    return out;
  });

  const converted = convertToExcalidrawElements(scaled as never, {
    regenerateIds: false,
  }) as ExcalidrawElement[];

  const groupId = randomHex(16);
  return converted.map((el) => ({
    ...el,
    groupIds: [...(el.groupIds ?? []), groupId],
    customData: { ...(el.customData ?? {}), artifactId },
  }));
}

/** Đánh dấu đã xóa mọi phần tử được sinh ra của một kết quả (xóa an toàn với
 *  hoàn tác). */
export function markArtifactDeleted(
  elements: readonly ExcalidrawElement[],
  artifactId: string,
): ExcalidrawElement[] {
  return elements.map((el) =>
    (el.customData as Record<string, unknown> | undefined)?.artifactId ===
      artifactId && !el.isDeleted
      ? {
          ...el,
          isDeleted: true,
          version: el.version + 1,
          versionNonce: randomInt(),
          updated: Date.now(),
        }
      : el,
  );
}

/** Thay html bên trong phần tử iframe của một kết quả. */
export function updateIframeHtml(
  elements: readonly ExcalidrawElement[],
  artifactId: string,
  html: string,
): ExcalidrawElement[] {
  return elements.map((el) => {
    const cd = el.customData as Record<string, unknown> | undefined;
    if (el.type !== 'iframe' || el.isDeleted || cd?.artifactId !== artifactId) {
      return el;
    }
    return {
      ...el,
      version: el.version + 1,
      versionNonce: randomInt(),
      updated: Date.now(),
      ...(needsClearBg(el) ? { backgroundColor: 'transparent' } : {}),
      customData: {
        ...cd,
        generationData: { status: 'done', html: prepareArtifactHtml(html) },
      },
    };
  });
}

/** Lưu trạng thái sống của iframe (ví dụ trang hiện tại của một cuốn lật) vào
 *  customData của phần tử — được lưu cùng cảnh, tồn tại qua các lần tải lại và
 *  các lần thay html khi tinh chỉnh. */
export function setIframeState(
  elements: readonly ExcalidrawElement[],
  artifactId: string,
  state: Record<string, unknown>,
): ExcalidrawElement[] {
  return elements.map((el) => {
    const cd = el.customData as Record<string, unknown> | undefined;
    if (el.type !== 'iframe' || el.isDeleted || cd?.artifactId !== artifactId) {
      return el;
    }
    return {
      ...el,
      version: el.version + 1,
      versionNonce: randomInt(),
      updated: Date.now(),
      customData: { ...cd, state },
    };
  });
}

/** Id kết quả đang chờ được đặt không gian tên theo từng lượt phân tích
 *  (`__pending__:<runId>`) để các lượt phân tích song song không bao giờ tranh
 *  nhau phần giữ chỗ dùng chung: kết quả của lượt A chỉ thăng cấp phần tử của
 *  lượt A. */
const PENDING_PREFIX = '__pending__:';

export function pendingArtifactId(runId: string): string {
  return `${PENDING_PREFIX}${runId}`;
}

export function isPendingArtifactId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(PENDING_PREFIX);
}

export function pendingArtifactElements(
  elements: readonly ExcalidrawElement[],
  pendingId?: string,
): ExcalidrawElement[] {
  return elements.filter((el) => {
    const aid = (el.customData as Record<string, unknown> | undefined)?.artifactId;
    return (
      !el.isDeleted &&
      (pendingId ? aid === pendingId : isPendingArtifactId(aid))
    );
  });
}

/** Xóa an toàn với hoàn tác cho các phần tử đang chờ — mọi lượt, hoặc một
 *  lượt. */
export function markPendingArtifactsDeleted(
  elements: readonly ExcalidrawElement[],
  pendingId?: string,
): ExcalidrawElement[] {
  return elements.map((el) => {
    const aid = (el.customData as Record<string, unknown> | undefined)?.artifactId;
    const match = pendingId ? aid === pendingId : isPendingArtifactId(aid);
    return match && !el.isDeleted
      ? {
          ...el,
          isDeleted: true,
          version: el.version + 1,
          versionNonce: randomInt(),
          updated: Date.now(),
        }
      : el;
  });
}

/** Thăng cấp phần giữ chỗ đang chờ của một lượt thành kết quả thật — cùng phần
 *  tử, cùng rect mà người dùng có thể đã di chuyển/đổi kích thước; chỉ id + html
 *  thay đổi. Mũi tên nối dùng chung id đang chờ cũng được gắn thẻ lại ở đây. */
export function promotePendingArtifact(
  elements: readonly ExcalidrawElement[],
  pendingId: string,
  artifactId: string,
  html: string,
): ExcalidrawElement[] {
  return elements.map((el) => {
    const cd = el.customData as Record<string, unknown> | undefined;
    if (el.isDeleted || cd?.artifactId !== pendingId) return el;
    return {
      ...el,
      version: el.version + 1,
      versionNonce: randomInt(),
      updated: Date.now(),
      customData: {
        ...cd,
        artifactId,
        ...(el.type === 'iframe'
          ? { generationData: { status: 'done', html } }
          : {}),
      },
    };
  });
}

/** Dẫn đường cho một mũi tên nối vòng qua bất cứ thứ gì nằm trong hành lang của
 *  nó.
 *
 *  Vật cản là mọi phần tử không phải do mô hình sinh ra, nằm theo chiều dọc giữa
 *  hai đầu mút và có khoảng x giao với dải hành lang — kể cả những phần tử rộng
 *  hơn hành lang (một khung bao trùm đóng góp khoảng cách tới mép gần hơn của nó,
 *  thứ mà cách quét mép thông thường bỏ sót).
 *
 *  Trả về `bow` = độ lệch ngang có dấu (+phải / −trái) và `band` = tỉ lệ
 *  [trên, dưới] của đoạn đường mà tuyến phải giữ độ né qua. Không có vật cản ->
 *  một cung trang trí nhẹ. */
export function connectorRoute(
  elements: readonly ExcalidrawElement[],
  from: Rect,
  to: Rect,
): { bow: number; band: [number, number] | null } {
  const sx = from.x + from.w / 2;
  const tx = to.x + to.w / 2;
  const top = from.y + from.h;
  const dy = to.y - top;
  if (dy <= 0) return { bow: 24, band: null };

  const HALF = 30; // nửa chiều rộng hành lang quanh đường rơi
  const PAD = 36; // khoảng thở phía ngoài mép vật cản
  const cLeft = Math.min(sx, tx) - HALF;
  const cRight = Math.max(sx, tx) + HALF;

  const blockers = elements.filter(
    (el) =>
      !el.isDeleted &&
      !isGeneratedElement(el) &&
      el.y + el.height > top &&
      el.y < to.y &&
      el.x + el.width > cLeft &&
      el.x < cRight,
  );
  if (!blockers.length) return { bow: 24, band: null };

  // Né sang PHẢI phải vượt qua mép phải của mọi vật cản tính từ đường rơi;
  // tương tự với TRÁI. Chọn quãng dịch chuyển nhỏ hơn.
  let right = 0;
  let left = 0;
  for (const el of blockers) {
    right = Math.max(right, el.x + el.width - sx);
    left = Math.max(left, sx - el.x);
  }
  const bowRight = right + PAD;
  const bowLeft = left + PAD;
  const bow = bowLeft < bowRight ? -bowLeft : bowRight;

  const bandTop = Math.min(...blockers.map((el) => el.y));
  const bandBottom = Math.max(...blockers.map((el) => el.y + el.height));
  const band: [number, number] = [
    Math.max(0.05, (bandTop - top) / dy - 0.04),
    Math.min(0.95, (bandBottom - top) / dy + 0.04),
  ];
  return { bow, band };
}

/** Mũi tên nối cong: từ đáy-giữa của nguồn -> đỉnh-giữa của đích theo một cung
 *  mượt. Khi có `band` (từ connectorRoute), các điểm bên trong nằm tại dải dọc
 *  của vật cản và độ cong chính là khoảng né thật — đường cong đi ra, chạy song
 *  song, rồi quay vào ở phía dưới. `sourceId`/`targetId` trở thành ràng buộc
 *  phần tử của Excalidraw, nên mũi tên tự dẫn lại đường khi một trong hai đầu di
 *  chuyển. `fullPoints` trong customData giữ các độ lệch cuối cùng để
 *  setArrowProgress có thể tạo hiệu ứng vẽ dần. */
export function makeConnectorArrow(
  from: Rect,
  to: Rect,
  opts: {
    sourceId?: string;
    targetId?: string;
    artifactId: string;
    bow?: number;
    band?: [number, number] | null;
  },
): ExcalidrawElement {
  const sx = from.x + from.w / 2;
  const sy = from.y + from.h;
  const dx = to.x + to.w / 2 - sx;
  const dy = to.y - sy;
  const bow = opts.bow ?? 24;
  const fullPoints: [number, number][] = opts.band
    ? [
        [bow, dy * opts.band[0]],
        [bow, dy * opts.band[1]],
        [dx, dy],
      ]
    : [
        [dx * 0.35 + bow, dy * 0.3],
        [dx * 0.65 + bow, dy * 0.7],
        [dx, dy],
      ];
  return {
    id: randomHex(20),
    type: 'arrow',
    x: sx,
    y: sy,
    width: Math.abs(dx) + bow,
    height: Math.abs(dy),
    angle: 0,
    strokeColor: '#64748b',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: { type: 2 },
    roughness: 0,
    opacity: 0,
    groupIds: [],
    frameId: null,
    index: null,
    boundElements: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    points: [[0, 0], ...fullPoints.map(() => [0, 0] as [number, number])],
    lastCommittedPoint: null,
    startBinding: opts.sourceId
      ? { elementId: opts.sourceId, focus: 0, gap: 6, fixedPoint: null }
      : null,
    endBinding: opts.targetId
      ? { elementId: opts.targetId, focus: 0, gap: 6, fixedPoint: null }
      : null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
    customData: {
      artifactId: opts.artifactId,
      connector: true,
      fullPoints,
    },
  } as unknown as ExcalidrawElement;
}

/** Đăng ký `arrowId` trong `boundElements` trên mỗi phần tử đầu mút — phần bắt
 *  buộc đi kèm startBinding/endBinding. */
export function bindArrow(
  elements: readonly ExcalidrawElement[],
  arrowId: string,
  ...endpointIds: (string | undefined)[]
): ExcalidrawElement[] {
  const ids = new Set(endpointIds.filter((id): id is string => !!id));
  if (!ids.size) return [...elements];
  return elements.map((el) =>
    ids.has(el.id)
      ? {
          ...el,
          version: el.version + 1,
          versionNonce: randomInt(),
          updated: Date.now(),
          boundElements: [
            ...((el.boundElements as readonly unknown[] | null) ?? []),
            { type: 'arrow', id: arrowId },
          ],
        }
      : el,
  ) as ExcalidrawElement[];
}

/** Khung hình động tác vẽ dần cho một mũi tên nối: kéo mọi điểm của đường cong
 *  về độ lệch đã lưu và mờ dần hiện ra. p chạy từ 0 → 1. */
export function setArrowProgress(
  elements: readonly ExcalidrawElement[],
  arrowId: string,
  p: number,
): ExcalidrawElement[] {
  return elements.map((el) => {
    if (el.id !== arrowId || el.type !== 'arrow') return el;
    const cd = el.customData as Record<string, unknown> | undefined;
    const full = (cd?.fullPoints as [number, number][] | undefined) ?? [[0, 0]];
    const ease = 1 - Math.pow(1 - p, 3); // giảm tốc bậc ba (ease-out cubic)
    return {
      ...el,
      opacity: Math.round(p * 100),
      points: [
        [0, 0],
        ...full.map(([px, py]) => [px * ease, py * ease] as [number, number]),
      ],
      version: el.version + 1,
      versionNonce: randomInt(),
      updated: Date.now(),
    };
  }) as ExcalidrawElement[];
}

/** Tài liệu tải độc lập cho iframe đang chờ: nền canvas Game-of-Life với các
 *  dòng trạng thái luân phiên và đồng hồ đếm thời gian chạy. JS thuần — kết quả
 *  không thể dựa vào React bên trong srcdoc. */
export function loadingArtifactHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${BOARD_BG};font-family:system-ui,sans-serif}
canvas{position:absolute;inset:0}
#ui{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center}
#msg{height:18px;overflow:hidden;font-size:13px;font-weight:500;color:#cbd5e1}
#msg span{display:inline-block;transition:transform .3s ease-out,opacity .3s ease-out}
#elapsed{font:11px ui-monospace,monospace;color:#94a3b8;font-variant-numeric:tabular-nums}
</style></head><body>
<canvas id="g"></canvas>
<div id="ui"><div id="msg"><span id="msgTxt"></span></div><div id="elapsed">0.0 giây</div></div>
<script>
var cv=document.getElementById('g'),cx=cv.getContext('2d');
var CELL=14,GAP=2,DENSITY=.28,STEP=620,FADE=920,MAXA=.22;
var PH=["Đang đọc bản phác thảo…","Đang diễn giải nội dung…","Đang suy ra mô hình…","Đang dựng mô phỏng…","Sắp xong…"];
var cols=0,rows=0,grid=[],next=[],opa=[],last=0,lastStep=0,t0=Date.now();
function seed(c,r){cols=Math.max(1,Math.ceil(c/CELL));rows=Math.max(1,Math.ceil(r/CELL));
 grid=[];next=new Array(cols*rows);opa=[];
 for(var i=0;i<cols*rows;i++){grid[i]=Math.random()<DENSITY?1:0;opa[i]=grid[i];}}
function step(){for(var y=0;y<rows;y++){var up=y?y-1:rows-1,dn=y===rows-1?0:y+1;
 for(var x=0;x<cols;x++){var l=x?x-1:cols-1,rr=x===cols-1?0:x+1,i=y*cols+x;
 var n=grid[up*cols+l]+grid[up*cols+x]+grid[up*cols+rr]+grid[y*cols+l]+grid[y*cols+rr]+grid[dn*cols+l]+grid[dn*cols+x]+grid[dn*cols+rr];
 next[i]=grid[i]?(n===2||n===3?1:0):(n===3?1:0);}}
 var t=grid;grid=next;next=t;}
function resize(){var w=innerWidth,h=innerHeight,dpr=Math.min(2,devicePixelRatio||1);
 cv.width=w*dpr;cv.height=h*dpr;cv.style.width=w+'px';cv.style.height=h+'px';
 cx.setTransform(dpr,0,0,dpr,0,0);seed(w,h);}
function frame(t){if(!last){last=t;lastStep=t;}
 var dt=Math.min(100,t-last);last=t;
 if(t-lastStep>=STEP){step();lastStep=t;}
 var ch=dt/FADE;
 for(var i=0;i<opa.length;i++){var g=grid[i]||0,c=opa[i];
 opa[i]=c<g?Math.min(g,c+ch):Math.max(g,c-ch);}
 cx.clearRect(0,0,innerWidth,innerHeight);cx.fillStyle='rgb(100 116 139)';
 for(var y=0;y<rows;y++)for(var x=0;x<cols;x++){var o=opa[y*cols+x];
 if(o>.001){cx.globalAlpha=o*MAXA;cx.fillRect(x*CELL,y*CELL,CELL-GAP,CELL-GAP);}}
 cx.globalAlpha=1;requestAnimationFrame(frame);}
var mi=0,msgEl=document.getElementById('msgTxt');
function showMsg(){msgEl.style.opacity=0;msgEl.style.transform='translateY(8px)';
 requestAnimationFrame(function(){requestAnimationFrame(function(){
 msgEl.textContent=PH[mi];msgEl.style.opacity=1;msgEl.style.transform='translateY(0)';});});}
showMsg();setInterval(function(){mi=(mi+1)%PH.length;showMsg();},1400);
var el=document.getElementById('elapsed');
setInterval(function(){var s=(Date.now()-t0)/1000;
 el.textContent=s<60?s.toFixed(1)+' giây':Math.floor(s/60)+' phút '+(s%60).toFixed(1)+' giây';},100);
addEventListener('resize',resize);resize();requestAnimationFrame(frame);
</script></body></html>`;
}

/** Tỉ lệ khung mặc định dùng khi đặt một kết quả mới. */
export function aspectFor(kind: Artifact['kind']): number {
  return kind === 'elements' ? VIRTUAL_W / VIRTUAL_H : 4 / 3;
}

/** Một phần tử văn bản duy nhất qua bộ chuyển đổi khung — các giá trị mặc định
 *  (phông chữ, số đo) được restore() điền khi tải cảnh. Gắn artifactId cho nó
 *  khiến nó trở thành phần tử được sinh ra: bị loại khỏi ảnh chụp phân tích và bị
 *  xóa cùng với kết quả của nó. */
export function makeTextElement(
  x: number,
  y: number,
  text: string,
  opts: { fontSize?: number; strokeColor?: string; artifactId?: string } = {},
): ExcalidrawElement {
  const [el] = convertToExcalidrawElements(
    [{ type: 'text', x, y, text, fontSize: opts.fontSize ?? 16 }] as never,
    { regenerateIds: true },
  ) as ExcalidrawElement[];
  return {
    ...el!,
    strokeColor: opts.strokeColor ?? '#f1f3f5',
    customData: opts.artifactId
      ? { ...(el!.customData ?? {}), artifactId: opts.artifactId }
      : el!.customData,
  };
}

export { MSG_SOURCE };
