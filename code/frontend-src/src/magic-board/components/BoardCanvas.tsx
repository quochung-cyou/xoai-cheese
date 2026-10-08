import { useMemo } from 'react';
import { Excalidraw, restore } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';

import { BOARD_BG } from '../lib/boardTheme';
import type { BoardScene } from '../lib/types';

interface BoardCanvasProps {
  scene: BoardScene;
  onSceneChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  /** Receive the Excalidraw API handle (selection, live scene) once mounted. */
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}

/**
 * The whiteboard itself. `initialData` is only read on mount, so the parent
 * remounts via `key` when a different board is loaded. restore() rehydrates
 * serialized appState internals (collaborators Map, etc.) that a plain JSON
 * blob cannot represent.
 */
export default function BoardCanvas({ scene, onSceneChange, onApi }: BoardCanvasProps) {
  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const restored = restore(
      {
        elements: (scene.elements ?? []) as ExcalidrawElement[],
        appState: scene.appState as unknown as AppState,
        files: (scene.files ?? {}) as unknown as BinaryFiles,
      },
      null,
      null,
    );
    return {
      elements: restored.elements,
      appState: {
        ...restored.appState,
        // Chalkboard look — dark board, white "chalk" strokes, hand font.
        // Applied post-restore so saved scenes can't resurrect light prefs.
        viewBackgroundColor: BOARD_BG,
        currentItemStrokeColor: '#f1f3f5',
        currentItemBackgroundColor: 'transparent',
        currentItemFontFamily: 1, // Virgil — Excalidraw's handwriting font
        currentItemRoughness: 1,
      },
      files: restored.files,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-canvas h-full w-full">
      <Excalidraw
        initialData={initialData}
        onChange={onSceneChange}
        excalidrawAPI={onApi}
        theme="light"
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}
