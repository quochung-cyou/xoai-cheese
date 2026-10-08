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
 * Chính chiếc bảng trắng. `initialData` chỉ được đọc khi gắn, nên component
 * cha gắn lại qua `key` khi nạp một bảng khác. restore() tái tạo các cấu trúc
 * nội bộ của appState đã được tuần tự hóa (Map collaborators, v.v.) mà một
 * khối JSON thuần không biểu diễn được.
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
        // Giao diện Excalidraw bằng tiếng Việt. Locale `vi-VN` nằm sẵn trong
        // gói @excalidraw/excalidraw và được nạp lazy khi langCode đổi.
        langCode: 'vi-VN',
        // Vẻ ngoài bảng phấn — nền tối, nét "phấn" trắng, phông chữ viết tay.
        // Áp dụng sau khi restore để cảnh đã lưu không thể làm sống lại các
        // tùy chọn nền sáng.
        viewBackgroundColor: BOARD_BG,
        currentItemStrokeColor: '#f1f3f5',
        currentItemBackgroundColor: 'transparent',
        currentItemFontFamily: 1, // Virgil — phông chữ viết tay của Excalidraw
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
