// End-to-end wire test: real HTTP, plain POST, no SSE.
//
// Boots a fake OpenAI-compatible endpoint, points the client at it, and drives
// both pipelines for real. Asserts on what actually goes over the wire (no
// `stream`, no `Accept: text/event-stream`) and that a single JSON body is
// handled correctly by analyze and by all three refine paths.
//
// Run with: node --import ./scripts/register-hooks.mjs --experimental-strip-types scripts/check-wire.mts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report } from './check-helpers.mts';

/**
 * The scenario refine path re-renders from the exported template, which is
 * loaded by URL. Serving `public/` from the same fake endpoint keeps this test
 * self-contained while still exercising that path for real (no asset mocking).
 *
 * The asset base is pointed at the endpoint because a root-relative URL has no
 * origin to resolve against in Node.
 */
const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Seen {
  url: string;
  body: Record<string, unknown>;
  accept: string | undefined;
}

const seen: Seen[] = [];
let nextReply = '';
/** When set, the endpoint returns this body verbatim (for failure shapes). */
let nextForced: unknown = null;

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Static asset route: serve the real exported templates/data files.
  if ((req.url ?? '').startsWith('/mb-assets/')) {
    const rel = decodeURIComponent((req.url ?? '').split('?')[0]!).replace(/^\/+/, '');
    readFile(join(FRONTEND, 'public', rel))
      .then((buf) => {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buf);
      })
      .catch(() => {
        res.writeHead(404);
        res.end('not found');
      });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* recorded as empty */
    }
    seen.push({ url: req.url ?? '', body, accept: req.headers.accept as string | undefined });

    // One call shape: a complete, non-streaming chat completion.
    const payload = nextForced ?? {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: nextReply, reasoning: 'brief reasoning' },
          finish_reason: 'stop',
        },
      ],
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const BASE = `http://127.0.0.1:${port}/v1`;

// Must be set before lib/scenarios.ts is evaluated — it reads the base at
// module load, and a root-relative URL has no origin in Node.
const ORIGIN = `http://127.0.0.1:${port}`;
(import.meta as unknown as { env: Record<string, unknown> }).env = {
  VITE_MB_ASSET_BASE: `${ORIGIN}/mb-assets`,
};

// Node's fetch rejects root-relative URLs outright ("Failed to parse URL"),
// where a browser resolves them against the document. lib/scenarios.ts builds
// base-relative asset URLs (correct for the app), so give them an origin here.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (typeof url === 'string' && url.startsWith('/')) {
    return realFetch(ORIGIN + url, init);
  }
  return realFetch(input as never, init);
}) as typeof fetch;

const { chat, analyzeSketch, completeChatEvents } = await import('../src/magic-board/lib/llm.ts');
const { refineArtifactToCallback } = await import('../src/magic-board/lib/refine.ts');

const CFG = {
  base_url: BASE,
  api_key: 'sk-test',
  model: 'test-model',
  max_tokens: 16000,
  analyze_max_tokens: 4096,
};

/** Reset the recorder and set the reply the fake endpoint will return. */
function replyWith(text: string): void {
  seen.length = 0;
  nextReply = text;
}

console.log('wire — analyze is one plain POST');
{
  const doc = {
    kind: 'html_sim',
    title: 'Test sim',
    observation: 'A sketch.',
    derived_models: [],
    notes: '',
    html: '<html><body>sim</body></html>',
  };
  replyWith(JSON.stringify(doc));

  const artifact = await analyzeSketch(CFG, {
    imageBase64: 'AAAA',
    sourceElementIds: ['e1'],
  }, CFG.analyze_max_tokens);

  check('exactly one request was made', seen.length === 1, String(seen.length));
  const req = seen[0]!;
  check('no `stream` field is sent', !('stream' in req.body), JSON.stringify(Object.keys(req.body)));
  check('no `stream_options` is sent', !('stream_options' in req.body));
  check(
    'Accept is not an event-stream',
    !(req.accept ?? '').includes('text/event-stream'),
    String(req.accept),
  );
  check('the small analyze cap is applied', req.body.max_tokens === 4096, String(req.body.max_tokens));
  check('json mode requested', JSON.stringify(req.body.response_format) === '{"type":"json_object"}');
  check('analyze produced an artifact', artifact.kind === 'html_sim', artifact.kind);
  check('title parsed from the body', artifact.title === 'Test sim', artifact.title);
  check('html parsed from the body', (artifact.payload.html ?? '').includes('sim'));
}

console.log('wire — refine html applies SEARCH/REPLACE from a whole response');
{
  const artifact = {
    id: 'a1',
    kind: 'html_sim' as const,
    title: 'Sim',
    source_element_ids: [],
    payload: { html: 'const g = 9.8;\nconst k = 1;\n' },
    analysis: null,
    updated_at: new Date().toISOString(),
  };
  replyWith(
    'PLAN: bump gravity.\n' +
      '<<<<<<< SEARCH\nconst g = 9.8;\n=======\nconst g = 20;\n>>>>>>> REPLACE\n' +
      'SUMMARY: done.',
  );

  const events: string[] = [];
  const outcome = await refineArtifactToCallback(CFG, artifact, 'increase gravity', (ev) =>
    events.push(ev.type),
  );

  check('one request', seen.length === 1, String(seen.length));
  const req = seen[0]!;
  check('refine does not stream either', !('stream' in req.body));
  check('refine uses max_tokens, not the analyze cap', req.body.max_tokens === 16000, String(req.body.max_tokens));
  check('refine is not json mode', !('response_format' in req.body));
  check('thinking surfaced from the plain body', events.includes('thinking'), events.join(','));
  check('edit lifecycle fired', events.includes('edit-start') && events.includes('edit-applied'), events.join(','));
  check('payload returned', outcome.payload?.html !== undefined);
  check('edit applied to the document', outcome.payload?.html === 'const g = 20;\nconst k = 1;\n', JSON.stringify(outcome.payload?.html));
  check('reasoning recorded for the chat turn', outcome.artifact !== undefined);
}

console.log('wire — refine elements applies ops from a whole response');
{
  const artifact = {
    id: 'a2',
    kind: 'elements' as const,
    title: 'Diagram',
    source_element_ids: [],
    payload: { elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0 }] },
    analysis: null,
    updated_at: new Date().toISOString(),
  };
  replyWith(
    JSON.stringify({
      ops: [{ op: 'update', id: 'r1', patch: { x: 90 } }],
      message: 'Moved it.',
    }),
  );

  const events: string[] = [];
  const outcome = await refineArtifactToCallback(CFG, artifact as never, 'move it right', (ev) =>
    events.push(ev.type),
  );
  check('elements path: no stream', !('stream' in seen[0]!.body));
  check('ops applied', outcome.payload?.elements?.[0]?.x === 90, JSON.stringify(outcome.payload));
  check('ops message surfaced', outcome.message === 'Moved it.', String(outcome.message));
}

console.log('wire — refine scenario patches params and re-renders');
{
  const artifact = {
    id: 'a3',
    kind: 'scenario' as const,
    title: 'Anatomy: heart',
    source_element_ids: [],
    payload: {
      scenario: 'anatomy_3d',
      params: { focus: 'heart', systems: [], isolate: true },
      html: '<html>old</html>',
    },
    analysis: null,
    updated_at: new Date().toISOString(),
  };
  replyWith(JSON.stringify({ params: { focus: 'brain' }, message: 'Focusing on the brain.' }));

  const events: string[] = [];
  const outcome = await refineArtifactToCallback(CFG, artifact as never, 'show the brain', (ev) =>
    events.push(ev.type),
  );

  check('scenario path: a model call happened', seen.length >= 1, String(seen.length));
  check('scenario refine does not stream', !('stream' in seen[0]!.body));
  check('scenario params patched', outcome.payload?.params?.focus === 'brain', JSON.stringify(outcome.payload?.params));
  check('scenario retitled', outcome.payload?.title === 'Anatomy: brain', String(outcome.payload?.title));
  check(
    'scenario re-rendered from the template',
    (outcome.payload?.html ?? '').includes('Anatomy 3D'),
    (outcome.payload?.html ?? '').slice(0, 60),
  );
  check('message surfaced', outcome.message === 'Focusing on the brain.', String(outcome.message));
}

console.log('wire — completeChatEvents yields exactly one output');
{
  replyWith('hello world');
  const events: { kind: string; delta: string }[] = [];
  for await (const ev of completeChatEvents(CFG, 'sys', [{ type: 'text', text: 'hi' }], {
    jsonMode: false,
  })) {
    events.push(ev);
  }
  const outputs = events.filter((e) => e.kind === 'output');
  const thinking = events.filter((e) => e.kind === 'thinking');
  check('exactly one output event', outputs.length === 1, String(outputs.length));
  check('output carries the whole body', outputs[0]!.delta === 'hello world', outputs[0]!.delta);
  check('thinking forwarded once', thinking.length === 1 && thinking[0]!.delta === 'brief reasoning');
}

// And confirm the buffered helper returns the text directly.
{
  replyWith('buffered');
  const text = await (await import('../src/magic-board/lib/llm.ts')).completeChat(
    CFG,
    'sys',
    [{ type: 'text', text: 'hi' }],
  );
  check('completeChat returns the text', text === 'buffered', text);
  check('still one POST', seen.length === 1, String(seen.length));
}

// ---------------------------------------------------------------------------
// The classify-first fast path. This is the behaviour that matters: a matching
// sketch must never need a full simulation generated, because a reasoning model
// will spend the entire budget thinking and return `content: ""`.
// ---------------------------------------------------------------------------

const { tryScenarioFastPath, classifySketch } = await import(
  '../src/magic-board/lib/classify.ts'
);

/** The system prompt of the first request that looks like the classifier. */
function classifyRequest() {
  return seen.find((s) => {
    const msgs = s.body.messages as { content?: unknown }[] | undefined;
    const sys = msgs?.[0]?.content;
    return typeof sys === 'string' && sys.includes('fast sketch classifier');
  });
}

/** The system prompt of a generation (analyze) request. */
function generationRequest() {
  return seen.find((s) => {
    const msgs = s.body.messages as { content?: unknown }[] | undefined;
    const sys = msgs?.[0]?.content;
    return typeof sys === 'string' && sys.includes('multimodal STEM engine');
  });
}

console.log('classify — the prompt carries the whole catalog');
{
  replyWith(JSON.stringify({ scenario: null, params: {}, observation: 'nothing clear' }));
  await classifySketch(CFG, 'AAAA');

  const req = classifyRequest();
  check('a classify request was made', req !== undefined);
  const sys = String((req!.body.messages as { content: string }[])[0]!.content);
  check('catalog placeholder was substituted', !sys.includes('{{SCENARIOS}}'));
  check('catalog lists the 3D anatomy item', sys.includes('**anatomy_3d**'));
  check('catalog lists the equation plot', sys.includes('**function_plot**'));
  check('each entry carries its params spec', sys.includes('params:'));
  check(
    'classify is capped by classify_max_tokens',
    req!.body.max_tokens === 1024,
    String(req!.body.max_tokens),
  );
  check('classify asks for JSON', JSON.stringify(req!.body.response_format) === '{"type":"json_object"}');
}

console.log('classify — a clear match spawns the template, no generation');
{
  replyWith(
    JSON.stringify({
      scenario: 'sphere',
      params: { radius: 0.9 },
      observation: 'A shaded ball with an equator.',
    }),
  );

  const artifact = await tryScenarioFastPath(CFG, 'AAAA');
  check('a template artifact was produced', artifact !== null);
  check('kind is scenario', artifact!.kind === 'scenario', artifact!.kind);
  check('payload names the template', artifact!.payload.scenario === 'sphere');
  check('params came from the classifier', artifact!.payload.params?.radius === 0.9);
  check(
    'the template was rendered locally (no model)',
    (artifact!.payload.html ?? '').includes('importmap'),
    (artifact!.payload.html ?? '').slice(0, 80),
  );
  check('title derived from the template', artifact!.title === 'sphere', artifact!.title);
  check(
    'the observation leads the analysis',
    (artifact!.analysis?.observation ?? '').startsWith('A shaded ball'),
    artifact!.analysis?.observation,
  );
  check('exactly ONE request was made', seen.length === 1, String(seen.length));
  check('and it was the small classify call', generationRequest() === undefined);
}

console.log('classify — "3d heart" style sketch resolves to the anatomy template');
{
  replyWith(
    JSON.stringify({
      scenario: 'anatomy_3d',
      params: { focus: 'heart' },
      observation: 'The label “3d heart”.',
    }),
  );
  const artifact = await tryScenarioFastPath(CFG, 'AAAA');
  check('heart matched the 3D anatomy template', artifact?.payload.scenario === 'anatomy_3d');
  check('focus param carried through', artifact?.payload.params?.focus === 'heart');
  check('title reads as anatomy', artifact?.title === 'Anatomy: heart', artifact?.title);
  check(
    'the real anatomy viewer was rendered',
    (artifact?.payload.html ?? '').includes('structures.json'),
  );
  check('only one request', seen.length === 1, String(seen.length));
}

console.log('classify — no match falls through to generation');
{
  replyWith(JSON.stringify({ scenario: null, params: {}, observation: 'a doodle' }));
  const artifact = await tryScenarioFastPath(CFG, 'AAAA');
  check('null scenario yields no artifact', artifact === null);
  check('only the classify call happened', seen.length === 1, String(seen.length));
}

console.log('classify — an unknown id is not trusted');
{
  replyWith(JSON.stringify({ scenario: 'not_a_real_template', params: {} }));
  const artifact = await tryScenarioFastPath(CFG, 'AAAA');
  check('unknown ids fall back to generation', artifact === null);
}

console.log('classify — narration instead of JSON is tolerated by the caller');
{
  // A model that ignores json_mode may still wrap the object in prose; the
  // classifier must not explode on it.
  replyWith('Sure! {"scenario":"torus","params":{},"observation":"a donut"}');
  const artifact = await tryScenarioFastPath(CFG, 'AAAA');
  check('prose-wrapped JSON still matches', artifact?.payload.scenario === 'torus', artifact?.payload.scenario);
}

console.log('classify — a starved reasoning model is reported clearly');
{
  // Exactly the observed failure: reasoning ate the whole budget.
  seen.length = 0;
  nextReply = '';
  nextForced = {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'thinking... '.repeat(50),
        },
        finish_reason: 'length',
      },
    ],
  };
  let msg = '';
  try {
    await classifySketch(CFG, 'AAAA');
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check(
    'the empty-content/length case explains itself',
    msg.includes('cut off') && msg.includes('max tokens'),
    msg,
  );
  nextForced = null;
}

server.close();
report();
