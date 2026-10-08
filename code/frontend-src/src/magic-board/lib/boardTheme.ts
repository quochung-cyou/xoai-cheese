/**
 * Chalkboard canvas color — shared between the Excalidraw board
 * (viewBackgroundColor) and sim docs, which bake it in as their fallback
 * background. Sandboxed artifact iframes can't be truly transparent (opaque
 * white in Chrome), so they paint this instead and live-update via the
 * postMessage bridge.
 */
export const BOARD_BG = '#1e2420';

/** Branding for the board chrome. */
export const APP_NAME = 'Bảng Ma Thuật';

/** Artifact sizing shared by live analyze placement and cache spawning. */
export const ARTIFACT_FALLBACK_H = 420;
export const ARTIFACT_MIN_H = 300;
export const ARTIFACT_MAX_H = 600;
