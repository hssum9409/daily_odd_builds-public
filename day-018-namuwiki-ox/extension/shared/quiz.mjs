export const DEFAULT_MODEL = 'gpt-6.1-terra';
export const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export function questionCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 5 && number <= 20 ? number : 10;
}
export function isArticleUrl(value) {
  try { const u = new URL(value); return u.origin === 'https://namu.wiki' && !u.username && !u.password && u.pathname.startsWith('/w/') && u.pathname.length > 3; } catch { return false; }
}
export function quizSchema(count) {
  const item = {type:'object',additionalProperties:false,required:['statement','answer','sourceId','quote','explanation','correction'],properties:{statement:{type:'string',minLength:1,maxLength:300},answer:{type:'boolean'},sourceId:{type:'string',minLength:1,maxLength:30},quote:{type:'string',minLength:12,maxLength:1400},explanation:{type:'string',minLength:1,maxLength:700},correction:{type:'string',maxLength:300}}};
  return {type:'object',additionalProperties:false,required:['questions'],properties:{questions:{type:'array',minItems:count,maxItems:count,items:item}}};
}
const fail = () => { throw Object.assign(Error('문항과 본문 근거의 연결을 다시 정리해야 합니다.'),{code:'quiz_evidence'}); };
export function validateQuiz(data, article, count) {
  if (!Array.isArray(data?.questions) || data.questions.length !== count) fail();
  const seen = new Set();
  return data.questions.map((q, index) => {
    if (!q || typeof q.answer !== 'boolean') fail();
    for (const [key,max] of [['statement',300],['quote',1400],['explanation',700],['correction',300],['sourceId',30]]) {
      if (typeof q[key] !== 'string' || q[key].length > max || (key !== 'correction' && !q[key].trim())) fail();
    }
    const block = article.blocks.find(b => b.id === q.sourceId);
    const quote = normalize(q.quote), statement = normalize(q.statement);
    const key = statement.replace(/[\s.!?。！？]/g,'').toLocaleLowerCase('ko');
    if (!block || quote.length < 12 || !normalize(block.text).includes(quote) || seen.has(key)) fail();
    if (!q.answer && !q.correction.trim()) fail();
    // No model-created URL is accepted as evidence; origin is always the captured block.
    if (/https?:\/\//i.test(q.explanation + q.correction)) fail();
    seen.add(key);
    return {id:`q${index+1}`,statement,answer:q.answer,sourceId:block.id,quote,explanation:q.explanation.trim(),correction:q.answer?'':q.correction.trim(),section:block.section};
  });
}
export function validateArticle(article) {
  if (!article || !isArticleUrl(article.url) || typeof article.title !== 'string' || !article.title.trim() || !Array.isArray(article.blocks) || article.blocks.length > 400) throw Error('나무위키 본문을 확인하지 못했습니다. 문서 탭에서 다시 읽어 주세요.');
  const ids = new Set(); let chars=0;
  for (const block of article.blocks) {
    if (!/^b\d+$/.test(block.id) || ids.has(block.id) || typeof block.text !== 'string' || block.text.length > 2200 || typeof block.section !== 'string') throw Error('본문 구간이 올바르지 않습니다.');
    ids.add(block.id); chars += block.text.length;
  }
  if (chars < 150) throw Object.assign(Error('출제할 본문이 너무 짧아요. 문서를 갱신해 주세요.'),{code:'article_too_short'});
  if (chars > 65000) throw Object.assign(Error('출제할 본문이 너무 커요. 문서를 갱신해 주세요.'),{code:'article_too_long'});
  return article;
}
export function score(questions, answers) { return questions.reduce((n,q) => n + (answers[q.id] === q.answer ? 1 : 0), 0); }
