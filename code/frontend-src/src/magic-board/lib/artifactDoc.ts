/**
 * artifactDoc — pure HTML-document transforms applied to stored artifact docs
 * (model-generated html_sims and anything imported). Ported from ai4edu's
 * `lib/artifactDoc.ts`, minus the legacy-scaffold migration that only
 * applied to that project's pre-baked docs.
 */
import { BOARD_BG } from './boardTheme';

export const globalsTag = (artifactId: string): string =>
  `<script>window.__MAGIC_BOARD_ARTIFACT_ID__=${JSON.stringify(artifactId)};</script>`;

export const GLOBALS_TAG_RE =
  /<script>window\.__MAGIC_BOARD_ARTIFACT_ID__=[^<]*<\/script>/;

/** Inject the artifact id into an iframe document so scripts inside the
 *  sandboxed iframe can identify themselves in postMessage traffic.
 *  (Artifact iframes run on an opaque origin — no localStorage, and the
 *  parent can't reach their DOM, so postMessage is the only channel.) */
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

/** Generated sims paint their own opaque background (sandboxed iframes can't
 *  be truly transparent), so seed them with the board color and live-sync it
 *  over the postMessage bridge when the canvas color changes. !important so
 *  the doc's own body styling can't fight it. */
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

/** Stored-doc pipeline — applied everywhere a doc enters or survives on an
 *  element. */
export const prepareArtifactHtml = (html: string): string => ensureBoardBlend(html);
