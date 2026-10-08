import type { RefineEvent, RefineRun } from '../../lib/types';

export function newRun(): RefineRun {
  return {
    stage: 'loading',
    thinking: '',
    narration: '',
    edits: [],
    rewriteLines: null,
  };
}

export function applyEvent(run: RefineRun, ev: RefineEvent): void {
  // Close the thinking window on the first non-thinking event.
  if (run.thinkingStarted != null && run.thinkingMs == null && ev.type !== 'thinking') {
    run.thinkingMs = performance.now() - run.thinkingStarted;
  }
  switch (ev.type) {
    case 'status':
      run.stage = ev.stage;
      if (ev.lines != null) run.docLines = ev.lines;
      break;
    case 'thinking':
      if (run.thinkingStarted == null) run.thinkingStarted = performance.now();
      run.thinking += ev.delta;
      run.stage = 'streaming';
      break;
    case 'narration':
      run.narration += ev.delta;
      run.stage = 'streaming';
      break;
    case 'edit-start':
      run.edits.push({ index: ev.index, status: 'locating' });
      run.stage = 'streaming';
      break;
    case 'edit-located': {
      const e = run.edits.find((x) => x.index === ev.index);
      if (e) {
        e.status = 'patching';
        e.line = ev.line;
        e.excerpt = ev.excerpt;
      }
      break;
    }
    case 'edit-applied': {
      const e = run.edits.find((x) => x.index === ev.index);
      if (e) {
        e.status = 'applied';
        e.line = ev.line ?? e.line;
        e.search = ev.search;
        e.replace = ev.replace;
      }
      break;
    }
    case 'edit-invalid': {
      const e = run.edits.find((x) => x.index === ev.index);
      if (e) {
        e.status = 'failed';
        e.reason = ev.reason;
        e.search = ev.search ?? e.search;
        e.replace = ev.replace ?? e.replace;
      }
      break;
    }
    case 'rewrite-start':
      run.rewriteLines = 0;
      run.stage = 'streaming';
      break;
    case 'rewrite-progress':
      run.rewriteLines = ev.lines;
      break;
    default:
      break;
  }
}

export function stageLabel(run: RefineRun): string {
  const applied = run.edits.filter((e) => e.status === 'applied').length;
  if (run.stage === 'loading') {
    return run.docLines
      ? `Loaded document (${run.docLines} lines)`
      : 'Loading document…';
  }
  if (run.stage === 'calling-model') return 'Calling the model…';
  if (run.rewriteLines != null) return `Rewriting document… ${run.rewriteLines} lines`;
  if (applied > 0) return `Editing… ${applied} applied`;
  if (run.edits.length > 0) return 'Editing…';
  return 'Working…';
}
