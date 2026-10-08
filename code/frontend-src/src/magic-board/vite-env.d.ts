/// <reference types="vite/client" />

/** Prompt text is inlined at build time via Vite's `?raw` suffix. */
declare module '*.txt?raw' {
  const content: string;
  export default content;
}
