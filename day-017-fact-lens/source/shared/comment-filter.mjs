// Conservative prefilter for clear solicitations. A URL, product name or the
// word "광고" alone is not spam; ambiguous cases stay for contextual analysis.
export function promotionalCommentReason(value) {
  const text = String(value || '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (/(?:사기|허위|과장|거짓|피해|반박|검증|신고|차단|조심|주의|근거.{0,6}없|믿지\s*마|광고.{0,8}(?:문제|아니|속|과장))/i.test(text)) return null;
  if (/(?:실제|공식).{0,30}(?:다르|다릅|아닌|아닙|없|틀리)|(?:라고|라는|라며|문구|표현).{0,16}(?:광고|본문|기사|설명|주장)|(?:광고|본문|기사).{0,16}(?:문구|표현|라고|라는|라며)/.test(text)) return null;
  const contact = /(?:카[카]?톡|오픈\s*채팅|텔레그램|whatsapp|telegram|디엠|\bdm\b|쪽지|연락|상담|문의)/i;
  const business = /(?:대출|급전|투자|수익|재테크|부업|알바|판매|구매|할인|쿠폰|입점|홍보|광고\s*문의|성인\s*만남|바카라|토토|카지노)/i;
  const offer = /(?:추천인|초대\s*코드|추천\s*코드|리퍼럴|referral|쿠폰|쿠폰\s*코드|할인\s*코드|가입.{0,18}(?:혜택|보너스|지급|포인트|만원|원\s*증정)|무료\s*(?:체험|가입|상담)|최저가|특가|당일\s*승인|원금\s*보장|고수익|discount\s*code|limited\s*time\s*offer)/i;
  const link = /(?:https?:\/\/|www\.|t\.me\/|open\.kakao\.com\/)/i;
  const purchase = /(?:(?:가입|신청|구매|주문|등록).{0,12}(?:하세요|해요|해보|하시|하면|하시면|하고|해주|가능|바로)|(?:받아|받으)(?:가|세|시)|(?:연락|문의).{0,8}(?:주세|주세요)|sign\s*up|buy\s*now)/i;
  if (offer.test(text) && (purchase.test(text) || (link.test(text) && /(?:하세요|오세요|주세요|프로필|링크로)/.test(text)))) return 'offer';
  const solicitation = /(?:(?:문의|상담|연락).{0,12}(?:주세요|주세|환영|가능)|(?:카[카]?톡|텔레그램|whatsapp|telegram|디엠|쪽지).{0,30}(?:문의|상담|연락|추가)|(?:문의|상담|연락).{0,30}(?:카[카]?톡|텔레그램|telegram|whatsapp|쪽지|디엠)|contact\s*me|message\s*me|dm\s*me)/i;
  if (contact.test(text) && business.test(text) && solicitation.test(text)) return 'commercial_contact';
  if (/(?:제\s*(?:채널|블로그|사이트)|제가\s*운영|유튜브|youtube|인스타|instagram)/i.test(text) && /(?:(?:구독|팔로우).{0,10}(?:해|하|부탁|눌러|주세요)|(?:subscribe|follow)\s+(?:me|my|our|us))/i.test(text)) return 'channel_promotion';
  if (/(?:제\s*(?:채널|블로그|사이트)|제가\s*운영)/i.test(text) && /(?:방문.{0,6}(?:해|하|부탁)|들러|놀러\s*오|홍보.{0,6}(?:해|합|하)|클릭)/.test(text)) return 'channel_promotion';
  return null;
}
export const isCommentContent = block => block?.kind === 'comment' || block?.section === 'comment';
export function filterPromotionalComments(blocks) {
  const entries = (Array.isArray(blocks) ? blocks : []).map((block, index) => ({ block, key: block?.imageId || block?.locationId || `comment-${index}` }));
  const excluded = new Set(entries.filter(({ block }) => isCommentContent(block) && promotionalCommentReason(block.text)).map(({ key }) => key));
  return { blocks: entries.filter(({ block, key }) => !isCommentContent(block) || !excluded.has(key)).map(({ block }) => block), excludedCount: excluded.size,
    excludedImageIds: [...new Set(entries.filter(({ block, key }) => block?.imageId && isCommentContent(block) && excluded.has(key)).map(({ block }) => block.imageId))] };
}
export function parseEditedSupplement(text) {
  return String(text).split(/\n\s*\n/).map(value => value.trim()).filter(Boolean).map(value => {
    const caption = value.startsWith('이미지 캡션:');
    return { kind: caption ? 'caption' : 'comment', text: value.replace(/^(?:댓글|이미지 캡션):\s*/, '') };
  });
}
