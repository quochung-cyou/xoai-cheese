/** Board-scene companion cards. The bundled lesson is reattached on every spawn. */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { bindArrow, makeConnectorArrow, makeSimIframeElement, setArrowProgress } from './artifacts';
import { lessonForArtifact } from './lessons';
import { noteDocument, quizDocument } from './lessonDocuments';
import type { Artifact, Rect } from './types';

const CARD_W = 340;
const CARD_H = 330;
const GAP = 28;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + 16 && a.x + a.w + 16 > b.x &&
    a.y < b.y + b.h + 16 && a.y + a.h + 16 > b.y;
}

/** Id of the precise model element owning this companion (copies have distinct ids). */
export function lessonParentOf(element: ExcalidrawElement): string | null {
  const value = (element.customData as Record<string, unknown> | undefined)?.lessonParent;
  return typeof value === 'string' ? value : null;
}

/** Attach the Vietnamese note and interactive quiz to each anatomy model once.
 * Do not change the Artifact payload/cache: both paths and restored boards use
 * this bundled content, and the scene (including arrows) is autosaved normally. */
export function ensureAnatomyLessons(
  elements: readonly ExcalidrawElement[],
  artifacts: readonly Artifact[],
): ExcalidrawElement[] {
  let next = [...elements];
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const models = elements.filter((el) =>
    !el.isDeleted && el.type === 'iframe' &&
    typeof (el.customData as Record<string, unknown> | undefined)?.artifactId === 'string' &&
    !lessonParentOf(el));

  for (const model of models) {
    const artifactId = (model.customData as { artifactId: string }).artifactId;
    const artifact = byId.get(artifactId);
    if (!artifact || !lessonForArtifact(artifact)) continue;
    if (next.some((el) => !el.isDeleted && lessonParentOf(el) === model.id &&
      (el.customData as Record<string, unknown> | undefined)?.lessonPart === 'note')) continue;
    const lesson = lessonForArtifact(artifact)!;
    const main = { x: model.x, y: model.y, w: model.width, h: model.height };
    let y = main.y + main.h + 62;
    const left = main.x;
    // Reserve one row for both cards. Ignore arrows; they carry broad bounds.
    const occupied = next.filter((el) => !el.isDeleted && el.type !== 'arrow');
    for (let attempt = 0; attempt < 24; attempt++) {
      const row = { x: left, y, w: CARD_W * 2 + GAP, h: CARD_H };
      if (!occupied.some((el) => overlaps(row, { x: el.x, y: el.y, w: el.width, h: el.height }))) break;
      y += CARD_H + 62;
    }
    const noteRect = { x: left, y, w: CARD_W, h: CARD_H };
    const quizRect = { x: left + CARD_W + GAP, y, w: CARD_W, h: CARD_H };
    const note = makeSimIframeElement(noteRect, noteDocument(lesson), `lesson:${model.id}:note`);
    const quiz = makeSimIframeElement(quizRect, quizDocument(lesson), `lesson:${model.id}:quiz`);
    const annotate = (el: ExcalidrawElement, part: string): ExcalidrawElement => ({
      ...el,
      customData: { ...(el.customData ?? {}), lessonParent: model.id, lessonPart: part },
    });
    const noteCard = annotate(note, 'note');
    const quizCard = annotate(quiz, 'quiz');
    const noteArrow = makeConnectorArrow(main, noteRect, {
      artifactId: `lesson:${model.id}`, sourceId: model.id, targetId: noteCard.id,
    });
    const quizArrow = makeConnectorArrow(main, quizRect, {
      artifactId: `lesson:${model.id}`, sourceId: model.id, targetId: quizCard.id,
    });
    next = bindArrow(
      [...next, noteCard, quizCard, annotate(noteArrow, 'note-arrow'), annotate(quizArrow, 'quiz-arrow')],
      noteArrow.id, model.id, noteCard.id,
    );
    next = bindArrow(next, quizArrow.id, model.id, quizCard.id);
    // Standard connector arrows start invisible for animation; show them
    // immediately on manual/cache/restore paths (no animation loop here).
    next = setArrowProgress(next, noteArrow.id, 1);
    next = setArrowProgress(next, quizArrow.id, 1);
  }
  return next;
}
