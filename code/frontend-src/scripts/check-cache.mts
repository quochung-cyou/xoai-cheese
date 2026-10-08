// Output cache + spawn placement behaviour.
// Run with: node --experimental-strip-types scripts/check-cache.mts
import { check, report, resetStorage } from './check-helpers.mts';

const {
  cacheByteSize,
  clearCachedOutputs,
  hashSketch,
  listCachedOutputs,
  markCachedSpawned,
  putCachedOutput,
  removeCachedOutput,
  updateCachedArtifact,
} = await import('../src/magic-board/lib/cache.ts');
const { findFreeRect } = await import('../src/magic-board/lib/placement.ts');

// NB: artifactSceneElements / skeletonToSceneElements live in lib/artifacts.ts
// and pull in @excalidraw/excalidraw, which only resolves under Vite — they are
// covered by `npm run build` rather than this harness.

type El = { id: string; version: number; versionNonce: number; isDeleted: boolean };

function el(id: string, version = 1, versionNonce = 1, isDeleted = false): El {
  return { id, version, versionNonce, isDeleted };
}

function artifact(id: string, title = 'Sim', kind: 'html_sim' | 'elements' = 'html_sim') {
  return {
    id,
    kind,
    title,
    source_element_ids: [],
    payload: kind === 'elements' ? { elements: [] } : { html: '<html>sim</html>' },
    analysis: null,
    updated_at: new Date().toISOString(),
  };
}

console.log('cache — sketch hashing');
{
  const a = [el('x', 1, 1), el('y', 2, 5)];
  const b = [el('y', 2, 5), el('x', 1, 1)]; // order must not matter
  check('hash is order-independent', hashSketch(a as never) === hashSketch(b as never));
  check('hash is stable', hashSketch(a as never) === hashSketch(a as never));
  check(
    'different content hashes differently',
    hashSketch(a as never) !== hashSketch([el('x', 1, 1)] as never),
  );
  check(
    'a version bump changes the hash',
    hashSketch(a as never) !== hashSketch([el('x', 9, 1), el('y', 2, 5)] as never),
  );
  check(
    'deleted elements are ignored',
    hashSketch(a as never) === hashSketch([...a, el('gone', 1, 1, true)] as never),
  );
}

console.log('cache — put / list / lookup');
{
  resetStorage();
  const sketchA = [el('a1'), el('a2')];
  const sketchB = [el('b1')];
  const outA = putCachedOutput(hashSketch(sketchA as never), artifact('art-1', 'First'), {
    x: 0,
    y: 0,
    w: 100,
    h: 80,
  });
  const outB = putCachedOutput(hashSketch(sketchB as never), artifact('art-2', 'Second'));

  check('two entries cached', listCachedOutputs().length === 2, String(listCachedOutputs().length));
  check('entry ids differ', outA.id !== outB.id);
  check('source bounds kept', outA.sourceBounds?.w === 100);
  check('no bounds is null', outB.sourceBounds === null);

  const hashA = hashSketch(sketchA as never);
  const found = listCachedOutputs().find((c) => c.hash === hashA);
  check('lookup by exact sketch hits', found?.artifact.id === 'art-1', found?.artifact.id);
  check(
    'lookup of an unknown sketch misses',
    listCachedOutputs().find((c) => c.hash === hashSketch([el('zzz')] as never)) === undefined,
  );
}

console.log('cache — re-analyzing the same sketch updates in place');
{
  resetStorage();
  const sketch = [el('same')];
  const hash = hashSketch(sketch as never);
  const first = putCachedOutput(hash, artifact('art-old', 'Old'));
  const second = putCachedOutput(hash, artifact('art-new', 'New'));

  check('no duplicate row', listCachedOutputs().length === 1, String(listCachedOutputs().length));
  check('same cache entry id reused', first.id === second.id);
  check('artifact replaced', listCachedOutputs()[0]!.artifact.id === 'art-new');
}

console.log('cache — refine updates the stored payload');
{
  resetStorage();
  const entry = putCachedOutput(hashSketch([el('r')] as never), artifact('art-r'));
  updateCachedArtifact(entry.id, { html: '<html>refined</html>' });
  const stored = listCachedOutputs()[0]!;
  check('payload updated', stored.artifact.payload.html === '<html>refined</html>');
  check(
    'other fields intact',
    stored.artifact.id === 'art-r' && stored.hash === entry.hash,
  );

  // Unknown id must be a no-op, not a throw.
  updateCachedArtifact('does-not-exist', { html: 'x' });
  check('unknown id is a no-op', listCachedOutputs().length === 1);
}

console.log('cache — spawn bookkeeping and removal');
{
  resetStorage();
  const entry = putCachedOutput(hashSketch([el('s')] as never), artifact('art-s'));
  check('never spawned initially', listCachedOutputs()[0]!.spawnedAt === undefined);

  markCachedSpawned(entry.id);
  check('spawn timestamp recorded', typeof listCachedOutputs()[0]!.spawnedAt === 'string');

  check('cache size is positive', cacheByteSize() > 0);
  removeCachedOutput(entry.id);
  check('entry removed', listCachedOutputs().length === 0);
  check('size back to zero', cacheByteSize() === 0);

  putCachedOutput(hashSketch([el('c1')] as never), artifact('art-c1'));
  putCachedOutput(hashSketch([el('c2')] as never), artifact('art-c2'));
  check('two cached again', listCachedOutputs().length === 2);
  clearCachedOutputs();
  check('clear wipes everything', listCachedOutputs().length === 0);
}

console.log('cache — corrupt entries are skipped, not fatal');
{
  resetStorage();
  putCachedOutput(hashSketch([el('ok')] as never), artifact('art-ok'));
  // Point the index at a garbage row as well.
  const raw = JSON.parse(localStorage.getItem('magic-board.cache.index')!);
  localStorage.setItem('magic-board.cache.index', JSON.stringify([...raw, 'garbage']));
  localStorage.setItem('magic-board.cache.garbage', '{not json');
  const list = listCachedOutputs();
  check('good entry survives', list.length === 1 && list[0]!.artifact.id === 'art-ok');
}

console.log('placement — finds a free slot');
{
  // No source sketch: falls back to the anchor.
  const r1 = findFreeRect(null, 4 / 3, [], { x: 0, y: 0 });
  check('places at the anchor', r1.x === 0 && r1.y === 0);
  check('aspect respected', Math.abs(r1.w / r1.h - 4 / 3) < 0.001, String(r1.w / r1.h));

  // Anchor slot occupied -> the next candidate must not overlap.
  const r2 = findFreeRect(null, 4 / 3, [r1], { x: 0, y: 0 });
  check('second spawn avoids the first', r2.x !== r1.x || r2.y !== r1.y);

  // Source sketch present: sits to its right, sharing the top edge.
  const source = { x: 100, y: 50, w: 200, h: 150 };
  const r3 = findFreeRect(source, 4 / 3, [], { x: 0, y: 0 });
  check('placed right of the source', r3.x === source.x + source.w + 80, String(r3.x));
  check('top-aligned with the source', r3.y === source.y, String(r3.y));
  check('height clamped to the minimum', r3.h === 300, String(r3.h));

  // A tall source clamps to the maximum instead.
  const tall = findFreeRect({ x: 0, y: 0, w: 10, h: 5000 }, 4 / 3, [], { x: 0, y: 0 });
  check('height clamped to the maximum', tall.h === 600, String(tall.h));
}

console.log('placement — evades obstacles and stacks when full');
{
  // Fill the first row candidate so the search must move.
  const blocked = findFreeRect(null, 1, [], { x: 0, y: 0 });
  const next = findFreeRect(null, 1, [blocked], { x: 0, y: 0 });
  check('does not overlap the blocker', !(
    next.x < blocked.x + blocked.w &&
    next.x + next.w > blocked.x &&
    next.y < blocked.y + blocked.h &&
    next.y + next.h > blocked.y
  ));

  // A wall of blockers across the whole search area forces the deep fallback.
  const wall: { x: number; y: number; w: number; h: number }[] = [];
  for (let row = 0; row < 12; row++) {
    for (let k = -4; k <= 4; k++) {
      wall.push({ x: k * 120, y: row * (420 + 60), w: 560, h: 420 });
    }
  }
  const deep = findFreeRect(null, 4 / 3, wall, { x: 0, y: 0 });
  check('fallback still returns a rect', deep.w > 0 && deep.h > 0);
  check('fallback y is finite', Number.isFinite(deep.y), String(deep.y));
}

console.log('placement — artifact rows size up like the live path');
{
  // The source-bounds rect a live analyze would pass for a 300x200 sketch.
  const source = { x: 40, y: 40, w: 300, h: 200 };
  const rect = findFreeRect(source, 4 / 3, [], { x: 0, y: 0 });
  check('sim rect keeps 4:3', Math.abs(rect.w / rect.h - 4 / 3) < 0.001);
  check('sim rect is at least the minimum height', rect.h >= 300, String(rect.h));
  check('sim rect is at most the maximum height', rect.h <= 600, String(rect.h));

  const diagram = findFreeRect(source, 1000 / 750, [], { x: 0, y: 0 });
  check('diagram rect keeps 4:3-ish aspect', Math.abs(diagram.w / diagram.h - 4 / 3) < 0.001);
}

report();
