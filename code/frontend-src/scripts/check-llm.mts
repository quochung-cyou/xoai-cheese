// Wire contract for the LLM client: plain POST, no SSE.
// Run with: node --import ./scripts/raw-loader.mjs --experimental-strip-types scripts/check-llm.mts
import { check, report } from './check-helpers.mts';

const { buildPayload, parseChatResponse, LlmError } = await import(
  '../src/magic-board/lib/llm.ts'
);

/** The default config shape the app ships with. */
const CFG = {
  base_url: 'https://api.openai.com/v1',
  api_key: 'sk-test',
  model: 'gpt-4o',
  max_tokens: 16000,
  analyze_max_tokens: 4096,
};

console.log('payload — plain POST, never streaming');
{
  const p = buildPayload(CFG, 'system', [{ type: 'text', text: 'hi' }], {
    jsonMode: true,
  });
  check('no stream flag is sent', !('stream' in p), JSON.stringify(Object.keys(p)));
  check('no stream_options is sent', !('stream_options' in p));
  check(
    'messages carry the system prompt',
    (p.messages as { role: string }[])[0]!.role === 'system',
  );
  check('json_mode asks for a JSON object', JSON.stringify(p.response_format) === '{"type":"json_object"}');
  check('model is passed through', p.model === 'gpt-4o');
}

console.log('payload — the analyze cap is respected, and only there');
{
  const analyze = buildPayload(CFG, 's', [], { jsonMode: true, maxTokens: 4096 });
  check('analyze sends the small cap', analyze.max_tokens === 4096, String(analyze.max_tokens));

  const refine = buildPayload(CFG, 's', [], { jsonMode: false });
  check('refine falls back to max_tokens', refine.max_tokens === 16000, String(refine.max_tokens));

  const noCap = buildPayload({ ...CFG, max_tokens: undefined }, 's', [], {
    jsonMode: false,
  });
  check('an unset cap is omitted entirely', !('max_tokens' in noCap));

  const nl = buildPayload(CFG, 's', [], { jsonMode: false, maxTokens: 4096 });
  check('plain mode sends no response_format', !('response_format' in nl));
}

console.log('payload — optional knobs only when configured');
{
  const bare = buildPayload({ ...CFG, temperature: undefined, top_p: undefined }, 's', [], {
    jsonMode: true,
  });
  check('temperature omitted when unset', !('temperature' in bare));
  check('top_p omitted when unset', !('top_p' in bare));

  const tuned = buildPayload(
    { ...CFG, temperature: 0.3, top_p: 0.9, reasoning_effort: 'low' },
    's',
    [],
    { jsonMode: true },
  );
  check('temperature sent when set', tuned.temperature === 0.3);
  check('reasoning effort mapped', JSON.stringify(tuned.reasoning) === '{"effort":"low"}');

  const off = buildPayload({ ...CFG, reasoning_effort: 'off' }, 's', [], { jsonMode: true });
  check('reasoning off disables it', JSON.stringify(off.reasoning) === '{"enabled":false}');

  const budget = buildPayload(
    { ...CFG, reasoning_max_tokens: 512, reasoning_effort: 'high' },
    's',
    [],
    { jsonMode: true },
  );
  check(
    'explicit thinking budget beats effort',
    JSON.stringify(budget.reasoning) === '{"max_tokens":512}',
  );
  check('llama.cpp budget fields set', budget.thinking_budget_tokens === 512);
}

console.log('response — plain message, no deltas');
{
  const ok = parseChatResponse({
    choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  });
  check('reads message.content', ok.text === 'hello', JSON.stringify(ok));
  check('no thinking when absent', ok.thinking === '', JSON.stringify(ok.thinking));
}

console.log('response — reasoning surfaces as thinking');
{
  const r = parseChatResponse({
    choices: [
      { message: { content: 'done', reasoning: 'because reasons' }, finish_reason: 'stop' },
    ],
  });
  check('flat reasoning captured', r.thinking === 'because reasons');
  check('output still captured', r.text === 'done');

  const alt = parseChatResponse({
    choices: [{ message: { content: 'x', reasoning_content: 'alt' }, finish_reason: 'stop' }],
  });
  check('reasoning_content captured', alt.thinking === 'alt');

  const details = parseChatResponse({
    choices: [
      {
        message: {
          content: 'x',
          reasoning_details: [{ type: 'reasoning.text', text: 'part A' }, { summary: 'part B' }],
        },
        finish_reason: 'stop',
      },
    ],
  });
  check('reasoning_details joined', details.thinking === 'part Apart B', details.thinking);

  const both = parseChatResponse({
    choices: [
      {
        message: { content: 'x', reasoning: 'flat', reasoning_details: [{ text: 'dup' }] },
        finish_reason: 'stop',
      },
    ],
  });
  check('flat field wins over details (no duplication)', both.thinking === 'flat', both.thinking);
}

console.log('response — array content parts (some gateways)');
{
  const parts = parseChatResponse({
    choices: [
      {
        message: {
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
        finish_reason: 'stop',
      },
    ],
  });
  check('array parts concatenated', parts.text === 'ab', parts.text);
}

console.log('response — error surfaces');
{
  let msg = '';
  try {
    parseChatResponse({ error: { message: 'quota exceeded' } });
  } catch (e) {
    msg = e instanceof LlmError ? e.message : String(e);
  }
  check('body error is raised as LlmError', msg.includes('quota exceeded'), msg);
}
{
  let threw = false;
  try {
    parseChatResponse({ choices: [] });
  } catch {
    threw = true;
  }
  check('empty choices raises', threw);
}
{
  let threw = false;
  try {
    parseChatResponse(null);
  } catch {
    threw = true;
  }
  check('null body raises', threw);
}

console.log('response — truncation is reported clearly (small analyze cap)');
{
  // Copy is localised, so assert the two failure modes are distinguishable
  // rather than matching English text: a truncated response must not produce
  // the same message as a model that answered with whitespace only.
  let truncated = '';
  try {
    parseChatResponse({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
    });
  } catch (e) {
    truncated = e instanceof LlmError ? e.message : String(e);
  }
  let empty = '';
  try {
    parseChatResponse({
      choices: [{ message: { content: '   ' }, finish_reason: 'stop' }],
    });
  } catch (e) {
    empty = e instanceof LlmError ? e.message : String(e);
  }
  check('finish_reason=length raises a specific message', truncated.length > 20, truncated);
  check(
    'whitespace-only output raises a different message',
    empty.length > 20 && empty !== truncated,
    empty,
  );
}

report();
