import { analysisFixture, verdictFixture } from './analysis-fixture.mjs';
import { sourceBlocks } from '../shared/analysis.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE, responseText, collectedSources } from '../shared/report.mjs';
import { extractionSchema, verdictSchema, parseStructuredResponse, StructuredOutputError } from '../shared/structured.mjs';
import { requestStructured, checkArticle } from '../extension/provider.js';
const obj = { claims: [{ claim: '달은 지구를 공전한다', quote: '달은 지구 주위를 공전한다.' }] };
const message = text => ({ id: 'msg-1', type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text, annotations: [] }] });
const complete = output => ({ status: 'completed', output });
const frame = event => `data: ${JSON.stringify(event)}\n\n`;
function stream(events, chunkSize = 37, noTrailingBlank = false) {
  let text = events.map(frame).join(''); if (noTrailingBlank) text = text.trimEnd();
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
test('reproduces old failure: delta JSON survives a completed event without embedded output', async () => {
  const text = JSON.stringify(obj);
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { ...message(''), content: [] } },
    ...[text.slice(0, 18), text.slice(18)].map(delta => ({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg-1', delta })),
    { type: 'response.completed', response: complete([]) },
  ];
  const result = await readSSE(stream(events, 1));
  assert.deepEqual(parseStructuredResponse(result, extractionSchema), obj);
});
test('full final text and done events replace deltas without duplicating JSON', async () => {
  const text = JSON.stringify(obj), item = message(text);
  const result = await readSSE(stream([
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg-1', delta: text },
    { type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: 'msg-1', text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: complete([item]) },
  ], 23, true));
  assert.equal(responseText(result), text);
  assert.deepEqual(parseStructuredResponse(result, extractionSchema), obj);
});
test('output_item.done and content_part.done can independently supply final JSON', async () => {
  for (const event of [
    { type: 'response.output_item.done', output_index: 0, item: message(JSON.stringify(obj)) },
    { type: 'response.content_part.done', output_index: 0, item_id: 'msg-1', content_index: 0, part: { type: 'output_text', text: JSON.stringify(obj) } },
  ]) assert.deepEqual(parseStructuredResponse(await readSSE(stream([event, { type: 'response.completed', response: complete([]) }])), extractionSchema), obj);
});
test('streamed web-search results and citation annotations survive a thin terminal event', async () => {
  const url = 'https://evidence.example/source';
  const result = await readSSE(stream([
    { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', status: 'completed', action: { sources: [{ url, title: 'Evidence' }] } } },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, item_id: 'm', delta: '{}' },
    { type: 'response.output_text.annotation.added', output_index: 1, content_index: 0, item_id: 'm', annotation_index: 0, annotation: { type: 'url_citation', url: 'https://citation.example/', title: 'Citation' } },
    { type: 'response.completed', response: complete([]) },
  ]));
  const provenance = collectedSources(result);
  assert.equal(provenance.searched, true); assert.ok(provenance.sources.has(url)); assert.ok(provenance.sources.has('https://citation.example/'));
});
test('analysis text is not concatenated with the final JSON', () => {
  const response = complete([{ ...message('analysis prose'), channel: 'analysis' }, message(JSON.stringify(obj))]);
  assert.deepEqual(parseStructuredResponse(response, extractionSchema), obj);
});
test('refusal is explicit even when streamed and never treated as empty JSON', async () => {
  const result = await readSSE(stream([{ type: 'response.refusal.delta', output_index: 0, item_id: 'm', content_index: 0, delta: 'Declined' }, { type: 'response.completed', response: complete([]) }]));
  assert.throws(() => parseStructuredResponse(result, extractionSchema), error => error.code === 'refusal');
});
test('one complete JSON fence is parsed; prose, trailing garbage, multiple objects and wrong schemas are rejected', () => {
  assert.deepEqual(parseStructuredResponse(complete([message(`\uFEFF\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``)]), extractionSchema), obj);
  for (const text of ['some prose {}', '{} {}', '```json\n{}\n```\nextra', '{"claims":null}', '{"claims":[null]}', '{"claims":[{"claim":3,"quote":"x"}]}', '{"claims":[],"extra":"x"}']) assert.throws(() => parseStructuredResponse(complete([message(text)]), extractionSchema), StructuredOutputError);
  assert.throws(() => parseStructuredResponse(complete([message('{"verdict":"true","explanation":"x","caveat":"","sources":[]}')]), verdictSchema), error => error.code === 'schema_mismatch');
});
function mockProvider(responses) {
  const requests = [], diagnostics = [];
  globalThis.chrome = { runtime: { async sendMessage() { return { ok: true, data: 'QA_TOKEN' }; } }, storage: { session: { async set(value) { diagnostics.push(value); } } } };
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); const next = responses.shift(); if (!next) throw Error('Unexpected extra request'); return typeof next === 'function' ? next() : next; };
  return { requests, diagnostics };
}
const jsonStream = value => stream([{ type: 'response.completed', response: complete([message(JSON.stringify(value))]) }]);
const signal = () => new AbortController().signal;
test('request actually sends strict schema plus explicit JSON contract, retaining the selected 6.1 sol model', async () => {
  const { requests } = mockProvider([jsonStream(obj)]);
  const result = await requestStructured('gpt-6.1-sol', 'Extract', 'PRIVATE_ARTICLE', extractionSchema, false, signal());
  assert.deepEqual(result.parsed, obj); assert.equal(requests[0].model, 'gpt-6.1-sol');
  assert.equal(requests[0].text.format.type, 'json_schema'); assert.equal(requests[0].text.format.strict, true);
  assert.deepEqual(requests[0].text.format.schema, extractionSchema); assert.ok(requests[0].instructions.includes(JSON.stringify(extractionSchema)));
  assert.ok(requests[0].instructions.includes('ONE valid JSON object')); assert.equal(requests[0].store, false); assert.equal(requests[0].stream, true);
});
test('malformed completed result retries once with the same schema/model; diagnostics contain no source text or tokens', async () => {
  const bad = stream([{ type: 'response.completed', response: complete([message('PRIVATE_ARTICLE plain prose')]) }]);
  const { requests, diagnostics } = mockProvider([bad, jsonStream(obj)]);
  const result = await requestStructured('gpt-6.1-sol', 'Extract', 'PRIVATE_ARTICLE', extractionSchema, false, signal());
  assert.equal(result.formatRetries, 1); assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].text, requests[1].text); assert.equal(requests[1].model, 'gpt-6.1-sol');
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE_ARTICLE')); assert.ok(!JSON.stringify(diagnostics).includes('QA_TOKEN'));
});
test('persistent malformed JSON fails after two requests with phase and code; it never becomes a claim', async () => {
  const { requests } = mockProvider([jsonStream({ wrong: true }), jsonStream({ wrong: true })]);
  await assert.rejects(requestStructured('gpt-6.1-sol', 'Extract', 'input', extractionSchema, false, signal()), error => error.message.includes('주장 추출') && error.message.includes('schema_mismatch'));
  assert.equal(requests.length, 2);
});
test('refusal, failed stream, and HTTP errors are not retried', async () => {
  const responses = [
    () => stream([{ type: 'response.completed', response: complete([{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }]) }]),
    () => stream([{ type: 'response.failed', response: { error: { code: 'x' } } }]),
    () => new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } }),
  ];
  for (const makeResponse of responses) {
    const { requests } = mockProvider([makeResponse()]);
    await assert.rejects(requestStructured('gpt-6.1-sol', 'Extract', 'input', extractionSchema, false, signal())); assert.equal(requests.length, 1);
  }
});
test('retried verdict may use only the new attempt search provenance', async () => {
  const verdict = { verdict: 'supported', explanation: 'QA explanation', caveat: '', sources: [{ url: 'https://old.example/', relation: 'supports', evidence: 'QA evidence' }] };
  const { requests } = mockProvider([
    jsonStream(analysisFixture(obj.claims.map(claim => ({ ...claim, origin: 'body' })), { sourceBlocks: sourceBlocks({ title: 'QA', text: obj.claims[0].quote }) })),
    stream([{ type: 'response.completed', response: complete([{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://old.example/' }] } }, message('not JSON')]) }]),
    stream([{ type: 'response.completed', response: complete([{ type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://new.example/' }] } }, message(JSON.stringify(verdictFixture(verdict, { aspects: [{ id: 'topic-1-aspect-1' }] })))]) }]),
  ]);
  const report = await checkArticle({ title: 'QA', text: obj.claims[0].quote, url: 'https://article.example/' }, 'gpt-6.1-sol', signal(), () => {});
  assert.equal(report.claims[0].verdict, 'insufficient'); assert.deepEqual(report.claims[0].sources, []); assert.equal(requests.length, 3);
});
