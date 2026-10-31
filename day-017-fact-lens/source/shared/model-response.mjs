import { readSSE, providerMessage } from './report.mjs';
const LIMIT = 8_000_000;
const knownCodes = new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'rate_limit_exceeded', 'invalid_request_error', 'unsupported_parameter', 'unsupported_value', 'invalid_value', 'invalid_type', 'invalid_json_schema', 'context_length_exceeded', 'model_not_found', 'insufficient_quota']);
const knownParameters = new Set(['service_tier', 'input', 'model', 'stream', 'store', 'tools', 'tool_choice', 'text', 'text.format', 'text.format.schema']);
function mime(response) {
  const value = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return value.length <= 100 && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value) ? value : 'unspecified';
}
export class ModelTransportError extends Error {
  constructor(code, response, detail = {}) {
    const messages = {
      unexpected_html: '서버가 모델 결과 대신 HTML 페이지를 반환했습니다. 로그인·네트워크 중간 응답을 확인해 주세요.',
      invalid_json: '서버 응답이 유효한 SSE 또는 JSON 형식이 아닙니다.',
      unexpected_json: '서버가 모델 결과와 다른 구조의 JSON을 반환했습니다.',
      not_completed: '서버가 완료되지 않은 결과를 반환했습니다. 완료된 검증으로 처리하지 않았습니다.',
      response_too_large: '서버 응답이 너무 큽니다. 전송할 본문·댓글·이미지 범위를 줄여 주세요.',
      stream_error: '서버의 모델 응답 스트림을 완료하지 못했습니다.',
      provider_error: providerMessage(detail.providerCode),
      http_error: response.status === 401 ? '로그인이 만료됐거나 사용 권한이 없습니다. 다시 연결해 주세요.' : providerMessage(detail.providerCode),
    };
    const contentType = mime(response);
    const reasons = { tier_rejected: '이 계정·모델에서 요청한 Fast 처리를 허용하지 않았습니다. Fast 모드를 해제하고 다시 시도해 주세요.', structured_format_rejected: '서버가 구조화 출력 옵션을 거절했습니다.', input_format_rejected: '서버가 텍스트·이미지 입력 형식을 거절했습니다.', context_limit: '모델의 입력 길이 한도를 초과했습니다. 전송 범위를 줄이거나 더 긴 입력을 지원하는 모델을 선택해 주세요.', model_unavailable: '선택한 모델이 이 요청 형식을 지원하지 않거나 사용할 수 없습니다.', access_rejected: '계정의 모델·요금제 사용 권한을 확인해 주세요.' };
    const reason = reasons[detail.errorCategory];
    super(`${reason || messages[code] || '모델 응답을 처리하지 못했습니다.'} [${code}; HTTP ${response.status}; Content-Type ${contentType}]`);
    this.name = 'ModelTransportError'; this.code = code;
    this.diagnostic = { code, httpStatus: response.status, contentType, ...detail };
  }
}
async function boundedText(response, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let result = '', size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > LIMIT) throw new ModelTransportError('response_too_large', response);
      result += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function errorDetails(data) {
  const error = data?.error, detail = data?.detail;
  const issues = Array.isArray(detail) ? detail.slice(0, 8) : [];
  const candidate = typeof error === 'string' ? error : error?.code || error?.type || detail?.code || data?.code;
  const messages = [typeof error === 'string' ? error : error?.message, typeof detail === 'string' ? detail : detail?.message, data?.message, data?.error_description, ...issues.map(issue => issue?.msg)].filter(value => typeof value === 'string').map(value => value.slice(0, 4000));
  const param = error?.param || detail?.param || data?.param || issues.map(issue => Array.isArray(issue?.loc) ? issue.loc.filter(part => part !== 'body').join('.') : '').find(value => /service_tier|text|input/.test(value));
  const parameter = knownParameters.has(param) ? param : typeof param === 'string' && /^input(?:\[\d+\]|\.\d+)?(?:\.content(?:\[\d+\]|\.\d+)?)?(?:\.(?:type|image_url|role))?$/.test(param) ? 'input' : typeof param === 'string' && param.startsWith('text.format') ? 'text.format' : undefined;
  // Inspect only error descriptors locally; never return/store their contents,
  // issue.input values, arbitrary field names, quoted page text or tokens.
  const text = `${candidate || ''} ${parameter || ''} ${messages.join(' ')}`.toLowerCase();
  let errorCategory = 'unspecified';
  if (/service[_ -]?tier|priority processing/.test(text)) errorCategory = 'tier_rejected';
  else if (/context.{0,20}(length|limit|exceed)|too many tokens|input.{0,12}too long/.test(text)) errorCategory = 'context_limit';
  else if (/json[_ -]?schema|text\.format|response_format|additionalproperties/.test(text)) errorCategory = 'structured_format_rejected';
  else if (/model.{0,40}(not supported|unsupported|not found|unavailable|does not support)/.test(text)) errorCategory = 'model_unavailable';
  else if (/permission|subscription|scope|grant|unauthorized/.test(text)) errorCategory = 'access_rejected';
  else if (parameter === 'input' || /input_image|input_text|invalid.{0,12}input|content.{0,20}(array|string)/.test(text)) errorCategory = 'input_format_rejected';
  const errorShape = Array.isArray(detail) ? 'detail_array' : typeof detail === 'string' ? 'detail_string' : detail && typeof detail === 'object' ? 'detail_object' : typeof error === 'string' ? 'error_string' : error && typeof error === 'object' ? 'error_object' : typeof data?.message === 'string' ? 'message_string' : 'unknown';
  const tierReason = errorCategory !== 'tier_rejected' ? undefined : /unsupported[_ ](?:parameter|field)|extra inputs/.test(text) ? 'parameter_unsupported' : /not allowed|forbidden|not permitted|not available/.test(text) ? 'not_allowed' : /unsupported.{0,15}(value|alias)|literal_error|invalid.{0,15}(value|argument)/.test(text) || issues.some(issue => issue?.type === 'literal_error') ? 'unsupported_value' : 'unspecified';
  return { providerCode: knownCodes.has(candidate) ? candidate : 'unspecified', errorCategory, errorShape, ...(parameter ? { parameter } : {}), ...(tierReason ? { tierReason } : {}) };
}
function completedJson(data, response) {
  const value = ['response.completed', 'response.failed', 'response.incomplete'].includes(data?.type) ? data.response : data;
  if (value?.error || data?.type === 'error') throw new ModelTransportError('provider_error', response, errorDetails(value));
  if (!value || value.status !== 'completed') {
    if (['failed', 'incomplete', 'in_progress', 'queued', 'cancelled'].includes(value?.status)) throw new ModelTransportError('not_completed', response);
    throw new ModelTransportError('unexpected_json', response);
  }
  if (!Array.isArray(value.output) || value.output.some(item => !item || typeof item.type !== 'string')) throw new ModelTransportError('unexpected_json', response);
  return value;
}
export async function readModelResponse(response, signal) {
  const contentType = mime(response);
  if (response.ok && contentType === 'text/event-stream') {
    try { return { completed: await readSSE(response, signal), transport: 'sse', contentType }; }
    catch (error) {
      if (signal?.aborted) throw error;
      // SSE error messages are generated locally; never include a provider body.
      const failure = new ModelTransportError('stream_error', response);
      failure.message = `${error.message} [stream_error; HTTP ${response.status}; Content-Type ${contentType}]`;
      throw failure;
    }
  }
  const text = (await boundedText(response, signal)).replace(/^\uFEFF/, '').trim();
  if (!response.ok) {
    let data; try { data = JSON.parse(text); } catch { /* body not copied to errors */ }
    throw new ModelTransportError('http_error', response, errorDetails(data));
  }
  // Some intermediaries omit or replace the event-stream MIME header. Only SSE
  // framing plus an actual response.completed event can establish completion.
  if (/^(?:(?:data|event|id|retry):|:)/.test(text)) {
    try { return { completed: await readSSE(new Response(text), signal), transport: 'sse-header-mismatch', contentType }; }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new ModelTransportError('stream_error', response);
    }
  }
  if (/^\s*</.test(text)) throw new ModelTransportError('unexpected_html', response);
  let data;
  try { data = JSON.parse(text); } catch { throw new ModelTransportError('invalid_json', response); }
  return { completed: completedJson(data, response), transport: 'json', contentType };
}
