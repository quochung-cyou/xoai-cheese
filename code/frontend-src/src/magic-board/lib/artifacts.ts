/**
 * artifacts — everything the model's output becomes on the canvas.
 *
 * Ported from ai4edu's `lib/artifacts.ts`. The canvas-element plumbing is
 * unchanged (that is the actual magic): a generated HTML doc becomes an
 * Excalidraw `iframe` element, a generated skeleton list becomes native
 * editable elements, and a curved connector arrow ties each back to the
 * sketch it came from.
 *
 * Dropped in the port: scenario-check grid helpers and the legacy-scaffold
 * html migration.
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

/** postMessage namespace shared with the injected board-blend shim. */
const MSG_SOURCE = 'magic-board';

/** Elements the model owns — excluded from analyze snapshots so generated
 *  output never feeds back into the next analysis. */
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

/** Common bounds of a non-empty element subset, {x, y, w, h}. */
export function boundsOf(elements: readonly ExcalidrawElement[]): Rect | null {
  if (!elements.length) return null;
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Where a new artifact goes: to the right of its source sketch,
 *  top-aligned. */
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
 * The canvas elements an artifact renders as, positioned at `rect`: a single
 * iframe element for sims, a converted skeleton group for diagrams.
 *
 * Shared by live analyze placement, refine rebuilds, and cache spawning so
 * all three produce identical output.
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

/** Any non-transparent fill on a generated iframe — Excalidraw paints it on
 *  the canvas behind the sim, so it must stay transparent. */
const needsClearBg = (el: ExcalidrawElement): boolean =>
  el.type === 'iframe' && !!artifactIdOf(el) && el.backgroundColor !== 'transparent';

/** Make an iframe element's stored html carry the same artifact id as its
 *  customData.artifactId — injects when the tag is absent and rewrites it
 *  when stale (elements copied on the canvas get rebound to a new artifact).
 *  Also drops any opaque fill so the sim blends with the board.
 *
 *  NOTE: the iframe's `sandbox` attribute is built inside Excalidraw and only
 *  gains `allow-same-origin` for its own recognized embed types, so an
 *  artifact document always runs on an opaque origin. Its data fetches are
 *  therefore cross-origin and depend on the asset host sending
 *  `Access-Control-Allow-Origin` — see the shim in scripts/export-scenarios.mts
 *  and the assetCors plugin in vite.config.ts. */
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

/** Backfill pass for whole scenes — run on load so restored iframes can
 *  identify themselves in the postMessage bridge. */
export function ensureArtifactGlobals(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.map(syncArtifactGlobals);
}

/**
 * Build an Excalidraw `iframe` element wrapping a generated HTML document —
 * the same shape Excalidraw's own wireframe-to-code produces
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
 * Convert the model's skeleton list (1000x750 virtual canvas) into real
 * scene elements fitted into `rect`, tagged with the artifact id and one
 * shared group. Skeleton ids are preserved (regenerateIds: false) so refine
 * ops can address elements by id.
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

/** Mark every generated element of an artifact deleted (undo-safe removal). */
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

/** Swap the html inside an artifact's iframe element. */
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

/** Persist live iframe state (e.g. a flipbook's current page) on the
 *  element's customData — saved with the scene, survives reloads and refine
 *  html swaps. */
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

/** Pending-artifact ids are namespaced per analyze run
 *  (`__pending__:<runId>`) so parallel analyses never fight over the shared
 *  placeholder: run A's result only promotes run A's elements. */
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

/** Undo-safe deletion for pending elements — all runs, or one run's. */
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

/** Promote a run's pending placeholder into the real artifact — same
 *  element, same rect the user may have moved/resized; only id + html
 *  change. The connector arrow shares the pending id and is retagged here
 *  too. */
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

/** Route a connector arrow around whatever sits in its corridor.
 *
 *  An obstacle is any non-generated element vertically between the two
 *  endpoints whose x-range intersects the corridor span — including elements
 *  wider than the corridor (a spanning frame contributes the distance to its
 *  nearer edge, which is what plain edge-scanning misses).
 *
 *  Returns `bow` = signed sideways clearance (+right / −left) and `band` =
 *  the [top, bottom] fraction of the run the route must hold the dodge
 *  through. No obstacle -> gentle decorative arc. */
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

  const HALF = 30; // corridor half-width around the drop line
  const PAD = 36; // breathing room beyond the obstacle edge
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

  // Dodging RIGHT must clear every blocker's right edge measured from the
  // drop line; same for LEFT. Pick the smaller excursion.
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

/** Curved connector arrow: source bottom-center -> target top-center as a
 *  smooth arc. With a `band` (from connectorRoute) the interior points sit at
 *  the obstacle's vertical band and the bow is its actual clearance — the
 *  curve exits, runs alongside, and re-enters below. `sourceId`/`targetId`
 *  become Excalidraw element bindings, so the arrow re-routes when either end
 *  moves. `fullPoints` in customData keeps the final offsets so
 *  setArrowProgress can animate the draw-in. */
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

/** Register `arrowId` under `boundElements` on each endpoint element —
 *  required companion of startBinding/endBinding. */
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

/** Draw-in animation frame for a connector arrow: grows every point of the
 *  curved path toward its stored offset and fades in. p goes 0 → 1. */
export function setArrowProgress(
  elements: readonly ExcalidrawElement[],
  arrowId: string,
  p: number,
): ExcalidrawElement[] {
  return elements.map((el) => {
    if (el.id !== arrowId || el.type !== 'arrow') return el;
    const cd = el.customData as Record<string, unknown> | undefined;
    const full = (cd?.fullPoints as [number, number][] | undefined) ?? [[0, 0]];
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
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

/** Self-contained loading doc for the pending iframe: a Game-of-Life canvas
 *  backdrop with rotating status lines and a live elapsed timer. Vanilla JS —
 *  artifacts can't rely on React inside the srcdoc. */
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
<div id="ui"><div id="msg"><span id="msgTxt"></span></div><div id="elapsed">0.0s</div></div>
<script>
var cv=document.getElementById('g'),cx=cv.getContext('2d');
var CELL=14,GAP=2,DENSITY=.28,STEP=620,FADE=920,MAXA=.22;
var PH=["Reading the sketch…","Interpreting the content…","Deriving the model…","Building the simulation…","Finishing up…"];
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
 el.textContent=s<60?s.toFixed(1)+'s':Math.floor(s/60)+'m '+(s%60).toFixed(1)+'s';},100);
addEventListener('resize',resize);resize();requestAnimationFrame(frame);
</script></body></html>`;
}

/** Default aspect ratios used when placing a new artifact. */
export function aspectFor(kind: Artifact['kind']): number {
  return kind === 'elements' ? VIRTUAL_W / VIRTUAL_H : 4 / 3;
}

/** Single text element via the skeleton converter — defaults (font, metrics)
 *  are filled by restore() on scene load. Tagging it with an artifactId makes
 *  it a generated element: excluded from analyze snapshots and deleted
 *  together with its artifact. */
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
