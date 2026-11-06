import {jsonRequest} from './auth.js';

const LUNA = 'gpt-6-luna';
const TERRA = 'gpt-6.1-terra';
const SOL = 'gpt-6.1-sol';
const MODEL_ORDER = {
  auto: [TERRA, LUNA, SOL],
  free: [LUNA],
  plus: [TERRA, SOL, LUNA],
  pro: [SOL, TERRA, LUNA]
};
const EFFORTS = ['low', 'medium', 'high'];
export const INFERENCE_PREF_KEYS = ['chatgptModel', 'chatgptPreset', 'chatgptFast', 'chatgptEffort'];

export function resolveInference(models, preferences = {}) {
  // The catalog drives model selection. Subscription presets are user-selected.
  const preset = Object.hasOwn(MODEL_ORDER, preferences.chatgptPreset) ? preferences.chatgptPreset : 'auto';
  const byId = new Map(models.map(model => [model.id, model]));
  const recommended = MODEL_ORDER[preset].map(id => byId.get(id)).find(Boolean) || models[0];
  const savedModel = byId.get(preferences.chatgptModel);
  const model = savedModel || recommended;
  let recommendedEffort = 'default';
  if (model?.id === LUNA) recommendedEffort = 'low';
  if (model?.id === TERRA || model?.id === SOL) recommendedEffort = 'high';
  const effortChoice = ['default', ...EFFORTS].includes(preferences.chatgptEffort) ? preferences.chatgptEffort : 'auto';
  const autoWritingModel = preset === 'auto' && (model?.id === TERRA || model?.id === LUNA);
  if (autoWritingModel) recommendedEffort = 'medium';
  const recommendedFast = autoWritingModel || (preset === 'pro' && model?.id === SOL);
  return {
    preset, model, recommended, savedModel, recommendedEffort, effortChoice, recommendedFast,
    effort: effortChoice === 'auto' ? recommendedEffort : effortChoice,
    fast: typeof preferences.chatgptFast === 'boolean' ? preferences.chatgptFast : recommendedFast
  };
}

export function withInferenceOptions(request, {effort, fast}) {
  return {
    ...request,
    service_tier: fast ? 'fast' : 'default',
    ...(EFFORTS.includes(effort) ? {reasoning: {effort}} : {})
  };
}
export async function listModels(connection) {
  const data=await jsonRequest('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${await connection.accessToken()}`}},'모델 목록');const models=data.models;
  if (!Array.isArray(models)) throw Error('사용 가능한 모델 목록을 확인하지 못했습니다.');
  const visible=models.filter(m=>m.visibility==='list' && typeof m.slug==='string' && typeof m.display_name==='string');
  if (!visible.length) throw Error('이 계정에서 사용할 수 있는 모델이 없습니다.');
  return visible.map(m=>({id:m.slug,name:m.display_name}));
}
export async function readResponseStream(stream, onText = ()=>{}) {
  if (!stream) throw Error('응답 스트림이 없습니다.');
  const reader=stream.getReader(),decoder=new TextDecoder();let buffer='',output='',completed=false;
  function consume(event) {
    const body=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if (!body || body==='[DONE]') return;
    const value=JSON.parse(body);
    if (value.type==='response.output_text.delta') {output+=value.delta || '';if (output.length>180000) throw Error('초안 응답이 너무 깁니다.');onText(output.length);}
    if (['response.failed','response.incomplete','error'].includes(value.type)) throw Error('AI 응답이 완료되지 않았습니다. 글을 줄이거나 다시 시도해 주세요.');
    if (value.type==='response.completed') completed=true;
  }
  try {
    for (;;) {
      const {done,value}=await reader.read();
      buffer+=done?decoder.decode():decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      let n;while ((n=buffer.indexOf('\n\n'))>=0) {consume(buffer.slice(0,n));buffer=buffer.slice(n+2);}
      if (buffer.length>200000) throw Error('응답 형식이 올바르지 않습니다.');
      if (done) {if (buffer.trim()) consume(buffer);break;}
    }
    if (!completed) throw Error('AI 연결이 중간에 끊겼습니다. 초안은 적용되지 않았습니다.');
    try {return JSON.parse(output.trim());} catch {throw Error('AI가 초안 형식을 지키지 않았습니다. 다시 만들어 주세요.');}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function generateDocument(connection,request,signal,onText) {
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await connection.accessToken()}`},body:JSON.stringify(request),signal});
  if (r.status === 400 || r.status === 403) {
    const {error} = await r.json().catch(() => ({})) || {};
    if (request.service_tier === 'fast' && error?.param === 'service_tier') throw Error('이 모델이나 계정에서 Fast를 사용할 수 없습니다. 설정에서 Fast를 끄고 다시 시도해 주세요.');
    if (request.reasoning && error?.param === 'reasoning.effort') throw Error('이 모델에서 선택한 추론 수준을 사용할 수 없습니다. 설정에서 모델 기본값을 선택해 주세요.');
  }
  if (!r.ok) throw Error(r.status===429?'ChatGPT 사용량 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.':`초안 생성 요청 실패 (HTTP ${r.status}).`);
  return readResponseStream(r.body,onText);
}
