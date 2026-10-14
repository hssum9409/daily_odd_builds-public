(() => {
  'use strict';

  const ns = globalThis.DCScrollHelper ??= {};
  const GALLERIES = Object.freeze({ normal: '/board', minor: '/mgallery/board', mini: '/mini/board' });
  // Only selectors verified on live normal/minor/mini pages (see docs/analysis.md).
  const TARGETS = Object.freeze({
    comments: ['#focus_cmt .comment_count', '#focus_cmt', '.comment_wrap .comment_count'],
    commentWrite: ['#focus_cmt .cmt_write_box', '.cmt_write_box.clear'],
    boardList: ['#bottom_listwrap .gall_listwrap.list', '#bottom_listwrap', '.gall_listwrap.list'],
  });

  // Shared URL validation also runs in the worker, where there is no page DOM.
  function parsePageUrl(href) {
    const other = { pageType: 'other', galleryType: null, galleryId: null, postNo: null };
    let url;
    try { url = new URL(href); } catch { return other; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return other;
    const path = url.pathname.replace(/\/$/, '');
    if (url.hostname === 'gallog.dcinside.com') {
      if (path === '' || /^\/[a-zA-Z0-9_]+(?:\/(posting|comment|scrap|guestbook))?$/.test(path)) {
        return { ...other, pageType: 'gallog' };
      }
      return other;
    }
    if (url.hostname !== 'gall.dcinside.com') return other;
    const directoryType = { '': 'normal', '/index.php': 'normal', '/m': 'minor', '/n': 'mini' }[path];
    if (directoryType) return { ...other, pageType: 'directory', galleryType: directoryType };
    const entry = Object.entries(GALLERIES).find(([, base]) =>
      ['view', 'lists', 'write'].some(kind => path === `${base}/${kind}`));
    const ids = url.searchParams.getAll('id');
    if (!entry || ids.length !== 1 || !/^[a-zA-Z0-9_]+$/.test(ids[0])) return other;
    const [galleryType, base] = entry;
    const route = path.slice(base.length + 1);
    const context = { ...other, galleryType, galleryId: ids[0] };
    if (route === 'write') return { ...context, pageType: 'write' }; // Explicitly unsupported overlay.
    if (route === 'lists') return { ...context, pageType: 'list' };
    const numbers = url.searchParams.getAll('no');
    if (route === 'view' && numbers.length === 1 && /^[1-9]\d*$/.test(numbers[0])) {
      return { ...context, pageType: 'view', postNo: numbers[0] };
    }
    return context;
  }

  function isSupportedPage(context) { return ['view', 'list', 'directory', 'gallog'].includes(context.pageType); }
  function isSupportedPageUrl(href) { return isSupportedPage(parsePageUrl(href)); }
  function parseContext(href, doc) {
    const context = parsePageUrl(href);
    const landmarks = { view: '.view_content_wrap .writing_view_box', list: 'table.gall_list',
      directory: '#categ_listwrap', gallog: '.gallog_wrap #container .gallog_menu' };
    if (landmarks[context.pageType] && !doc.querySelector(landmarks[context.pageType])) {
      return { ...context, pageType: 'other', postNo: null };
    }
    return context;
  }

  function galleryUrl(context) {
    if (!GALLERIES[context.galleryType] || !context.galleryId) return null;
    const url = new URL(`${GALLERIES[context.galleryType]}/lists/`, 'https://gall.dcinside.com');
    url.searchParams.set('id', context.galleryId);
    return url.href;
  }

  function gallogUrl(doc, context = {}) {
    // Only verified account controls; never an author's/commenter's profile link.
    const box = doc.querySelector('#login_box');
    if (box?.querySelector('.user_info .btn_inout.logout')) for (const link of box.querySelectorAll('.user_option a')) {
      if (!link.textContent.trim().startsWith('갤로그')) continue;
      const handler = link.getAttribute('onclick') ?? '';
      const literal = handler.match(/^\s*window\.open\(['"]([^'"]+)['"]\);?\s*$/)?.[1];
      let url;
      try { url = new URL(literal ?? link.getAttribute('href'), 'https://gall.dcinside.com'); } catch { continue; }
      if (url.protocol === 'https:' && url.hostname === 'gallog.dcinside.com' && !url.port && !url.username && !url.password &&
          /^\/[a-zA-Z0-9_]+\/?$/.test(url.pathname) && !url.search && !url.hash) return url.href;
    }
    // Gallog's account control is separate from gallery sidebars. The root URL
    // routes to the logged-in user's own gallog, never the profile being viewed.
    if (context.pageType === 'gallog' &&
        doc.querySelector('.gallog_wrap .btn_top_loginout')?.textContent.trim() === '로그아웃') {
      return 'https://gallog.dcinside.com/';
    }
    return null;
  }

  function visible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function resolveTarget(action, doc, context) {
    if (!['view', 'list'].includes(context.pageType)) return null;
    if (action === 'boardList' && context.pageType === 'list') {
      return [...doc.querySelectorAll('.gall_listwrap.list, table.gall_list')].find(visible) ?? null;
    }
    for (const selector of TARGETS[action] ?? []) {
      for (const element of doc.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        if (action === 'commentWrite') {
          const input = element.querySelector(`textarea[id="memo_${context.postNo}"]`);
          if (!visible(input) || input.disabled || input.readOnly) continue;
        }
        return element;
      }
    }
    return null;
  }

  function capabilities(context, doc) {
    const supported = isSupportedPage(context);
    const board = ['view', 'list'].includes(context.pageType);
    const commentsLandmark = context.pageType === 'view' && !!doc.querySelector('#focus_cmt, .comment_wrap, a[href="#focus_cmt"]');
    return {
      top: supported,
      bottom: supported,
      gallery: context.pageType === 'view' && !!galleryUrl(context),
      comments: supported && !!(resolveTarget('comments', doc, context) || commentsLandmark),
      // A known comment container permits seeking a writer that may be inserted later.
      // If an existing writer is disabled/hidden, do not advertise it as available.
      commentWrite: context.pageType === 'view' && (doc.querySelector('.cmt_write_box')
        ? !!resolveTarget('commentWrite', doc, context) : commentsLandmark),
      boardList: board && !!(resolveTarget('boardList', doc, context) ||
        doc.querySelector('#bottom_listwrap, a[href="#bottom_listwrap"]')),
    };
  }

  Object.assign(ns, { parseContext, parsePageUrl, isSupportedPage, isSupportedPageUrl, galleryUrl, gallogUrl, resolveTarget, capabilities,
    directoryUrl: 'https://gall.dcinside.com/#categ_listwrap', minorDirectoryUrl: 'https://gall.dcinside.com/m#categ_listwrap' });
})();
