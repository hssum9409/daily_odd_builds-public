// Runs in the isolated world, only on an exact namu.wiki /w/ document.
// Never fetches a page, linked source, iframe, image, hidden text or external site.
export function extractArticle() {
  const u = new URL(location.href);
  if (u.origin !== 'https://namu.wiki' || !u.pathname.startsWith('/w/')) throw Error('나무위키 문서(/w/) 탭에서 열어 주세요.');
  let root = document.querySelector('.wiki-content'), rendererAttribute=null;
  // The current site hashes CSS class names. Identify the article renderer from
  // its real section anchors and its component boundary, never document.body.
  if (!root) {
    const headings=[...document.querySelectorAll('h2,h3,h4,h5,h6')].filter(h=>[...h.querySelectorAll('a[id]')].some(a=>/^s-\d+(?:\.\d+)*$/.test(a.id)));
    const first=headings[0];
    if(first){
      for(const attr of [...first.attributes].filter(a=>a.name.startsWith('data-v-'))){
        let last=first;
        while(last.parentElement?.hasAttribute(attr.name))last=last.parentElement;
        const candidate=last.parentElement;
        if(candidate && !['BODY','HTML'].includes(candidate.tagName) && !candidate.querySelector('h1,nav,header,footer') && headings.every(h=>candidate.contains(h))){root=candidate;rendererAttribute=attr.name;break;}
      }
    }
  }
  if (!root) throw Error('본문을 찾지 못했어요. 문서 로딩 또는 접근 확인을 마친 뒤 다시 읽어 주세요.');
  const excluded = 'script,style,noscript,nav,aside,form,button,iframe,video,audio,summary,.wiki-macro-toc,.wiki-toc,.wiki-category,.wiki-footer,.wiki-edit-section,.wiki-folding,[role="navigation"],[role="complementary"],[hidden],[aria-hidden="true"],[contenteditable="true"],a[href^="/edit/"],a[href^="#fn-"],a[href^="#rfn-"]';
  const omitted=new Set();
  for(const child of root.children){
    if(rendererAttribute && !child.hasAttribute(rendererAttribute))omitted.add(child);
    if(child.querySelectorAll('a[href^="#s-"]').length>=3 && !child.querySelector('h2,h3,h4,h5,h6'))omitted.add(child);
  }
  const visible = node => {
    for (let el=node; el && el!==root.parentElement; el=el.parentElement) {
      if (el.matches(excluded) || omitted.has(el)) return false;
      const s=getComputedStyle(el); if(s.display==='none' || s.visibility==='hidden' || s.visibility==='collapse' || s.opacity==='0') return false;
      if((s.overflowY==='hidden' || s.overflowY==='clip') && el.clientHeight<2)return false;
      if(el.parentElement?.matches('details:not([open])'))return false;
    }
    return true;
  };
  const blocks=[]; let section='본문', chars=0, truncated=false;
  // DOM order retains headings, table rows and paragraphs without duplicated text.
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node, current=null, chunks=[];
  function flush() {
    if(truncated)return;
    const text=chunks.join(' ').replace(/\s+/g,' ').trim(); chunks=[];
    if(text.length<12)return;
    for(let i=0;i<text.length;i+=2200){
      const part=text.slice(i,i+2200);
      if(chars+part.length>60000 || blocks.length>=400){truncated=true;return;}
      blocks.push({id:`b${blocks.length+1}`,section:section.slice(0,200),text:part});chars+=part.length;
    }
  }
  while((node=walker.nextNode())) {
    const parent=node.parentElement;
    if(!parent || !visible(parent) || parent.closest('sup,.footnote,.wiki-fn-content,.wiki-fn-backlink'))continue;
    const owner=parent.closest('h1,h2,h3,h4,h5,h6,tr,li,blockquote') || parent.closest('.wiki-paragraph,p,div') || parent;
    if(owner!==current){
      flush();if(truncated)break;current=owner;
      if(/^H[1-6]$/.test(owner.tagName)){
        const hw=document.createTreeWalker(owner,NodeFilter.SHOW_TEXT),parts=[];let hn;
        while((hn=hw.nextNode()))if(hn.parentElement && visible(hn.parentElement))parts.push(hn.textContent);
        section=parts.join(' ').replace(/\s+/g,' ').trim();
      }
    }
    chunks.push(node.textContent);
  }
  flush();
  const title=(document.querySelector('h1')?.innerText || document.title.replace(/ - 나무위키$/,'')).replace(/\[편집\]/g,'').trim();
  return {title:title.slice(0,300),url:u.href.split('#')[0],blocks,chars,truncated,extractor:rendererAttribute?'section-renderer':'wiki-content',capturedAt:new Date().toISOString()};
}
