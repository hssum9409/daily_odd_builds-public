import { responseText } from './report.mjs';
const string = { type: 'string' };
export const extractionSchema = { type: 'object', additionalProperties: false, required: ['claims'], properties: {
  claims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'quote'], properties: { claim: string, quote: string } } },
} };
export const verdictSchema = { type: 'object', additionalProperties: false, required: ['verdict', 'explanation', 'caveat', 'sources'], properties: {
  verdict: { type: 'string', enum: ['supported', 'refuted', 'mixed', 'insufficient'] }, explanation: string, caveat: string,
  sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'evidence', 'relation'], properties: {
    url: string, evidence: string, relation: { type: 'string', enum: ['supports', 'contradicts', 'context'] },
  } } },
} };
export const visionSchema = { type: 'object', additionalProperties: false, required: ['images'], properties: {
  images: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'transcription', 'description', 'uncertainty'], properties: {
    id: string, transcription: string, description: string, uncertainty: string,
  } } },
} };
export class StructuredOutputError extends Error {
  constructor(code, response, text) {
    super(({ empty_output: '모델이 구조화할 텍스트 결과를 반환하지 않았습니다.', invalid_json: '모델 응답이 유효한 JSON이 아닙니다.', schema_mismatch: '모델 응답의 필드·자료형이 요구한 구조와 다릅니다.', refusal: '모델이 이 요청에 대한 응답을 거절했습니다.' })[code]);
    this.name = 'StructuredOutputError'; this.code = code;
    // No article, generated text, account, credential or provider error body.
    this.diagnostic = { code, textLength: text.length, outputTypes: (response.output || []).map(item =>
      ['message', 'reasoning', 'web_search_call'].includes(item.type) ? item.type : 'other'), status: response.status === 'completed' ? 'completed' : 'other' };
  }
}
// The schemas above use this deliberately small, closed JSON Schema subset.
// This checks the actual output, independently of what the provider accepted.
export function matchesSchema(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required.some(key => !Object.hasOwn(value, key))) return false;
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(schema.properties).every(([key, child]) => !Object.hasOwn(value, key) || matchesSchema(value[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) && (!Number.isInteger(schema.maxItems) || value.length <= schema.maxItems) && value.every(item => matchesSchema(item, schema.items));
  if (schema.type === 'string') return typeof value === 'string' && (!schema.enum || schema.enum.includes(value));
  return false;
}
export function parseStructuredResponse(response, schema) {
  const text = responseText(response).replace(/^\uFEFF/, '').trim();
  const refused = (response.output || []).some(item => item.type === 'message' && (item.content || []).some(part => part.type === 'refusal'));
  if (refused) throw new StructuredOutputError('refusal', response, text);
  if (!text) throw new StructuredOutputError('empty_output', response, text);
  // One complete JSON code fence is recoverable without a model call. Never
  // extract a guessed substring from prose or concatenate multiple JSON objects.
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  let parsed;
  try { parsed = JSON.parse(fenced ? fenced[1].trim() : text); }
  catch { throw new StructuredOutputError('invalid_json', response, text); }
  if (!matchesSchema(parsed, schema)) throw new StructuredOutputError('schema_mismatch', response, text);
  return parsed;
}
export function outputContract(schema) {
  return `OUTPUT CONTRACT (mandatory): Return exactly ONE valid JSON object matching the following JSON Schema. Do not return markdown, code fences, introductory prose, comments or a human-readable report. All required keys must be present and have the specified types. Do not add keys. Use only the original input/evidence; never invent a quote, fact or URL to satisfy the schema.\nJSON Schema:\n${JSON.stringify(schema)}`;
}
