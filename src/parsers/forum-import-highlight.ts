import {
  XENFORO_POST_SELECTORS,
  XENFORO_THREAD_POST_LIST_SELECTORS
} from './forum-import-selectors'

const MARK_CLASS = 'lexpatrol-import-highlight'
const STYLE_ID = 'lexpatrol-import-highlight-style'

export type ForumHighlightScope = 'first' | 'all'

/**
 * Скрипт для встроенного webview: подсветка того же блока(ов), что забирает авто-импорт XenForo.
 * Возвращает JSON { ok, reason?, tag?, className?, count? }.
 */
export function getForumImportHighlightScript(scope: ForumHighlightScope = 'first'): string {
  const postJson = JSON.stringify([...XENFORO_POST_SELECTORS])
  const listJson = JSON.stringify([...XENFORO_THREAD_POST_LIST_SELECTORS])
  const scopeJson = JSON.stringify(scope)
  return `(function(){
    var POST_SEL = ${postJson};
    var LIST_SEL = ${listJson};
    var SCOPE = ${scopeJson};
    var MARK = ${JSON.stringify(MARK_CLASS)};
    var STYLE_ID = ${JSON.stringify(STYLE_ID)};
    function pickBody(root) {
      return root.querySelector('.message-body.js-selectToQuote') ||
        root.querySelector('.message-body') ||
        root.querySelector('.js-postBody') ||
        root.querySelector('.message-content') ||
        root.querySelector('.message-body .bbWrapper') ||
        root.querySelector('.js-postBody .bbWrapper') ||
        root.querySelector('.message-content .bbWrapper') ||
        root.querySelector('.bbWrapper');
    }
    function threadRoot() {
      return document.querySelector('#thread-view') ||
        document.querySelector('.p-body-main') ||
        document.querySelector('[data-template="thread_view"]') ||
        document.body;
    }
    function sortPosts(a, b) {
      var pos = a.compareDocumentPosition(b);
      if (pos & 4) return -1;
      if (pos & 2) return 1;
      return 0;
    }
    var prev = document.getElementsByClassName(MARK);
    while (prev.length) { prev[0].classList.remove(MARK); }
    var tr = threadRoot();
    if (SCOPE === 'all') {
      var posts = [];
      var li, j;
      for (li = 0; li < LIST_SEL.length; li++) {
        try {
          var nl = tr.querySelectorAll(LIST_SEL[li]);
          if (nl.length) {
            for (j = 0; j < nl.length; j++) posts.push(nl[j]);
            break;
          }
        } catch (e) {}
      }
      if (!posts.length) {
        var markers = tr.querySelectorAll('[data-content^="post-"]');
        var seenRoots = [];
        for (j = 0; j < markers.length; j++) {
          var el = markers[j];
          var root = el.closest('article.message--post, article.message--article') ||
            el.closest('.message.message--post') || el;
          if (seenRoots.indexOf(root) >= 0) continue;
          seenRoots.push(root);
          posts.push(root);
        }
      }
      posts.sort(sortPosts);
      var targets = [];
      var seenBodies = [];
      for (j = 0; j < posts.length; j++) {
        var bb = pickBody(posts[j]);
        if (!bb || seenBodies.indexOf(bb) >= 0) continue;
        seenBodies.push(bb);
        var inner = (bb.innerHTML || '').trim();
        var plain = (bb.textContent || '').replace(/\\s+/g, ' ').trim();
        if (inner.length >= 15 && plain.length >= 10) targets.push(bb);
      }
      if (!targets.length) return { ok: false, reason: 'no_forum_block' };
      if (!document.getElementById(STYLE_ID)) {
        var st2 = document.createElement('style');
        st2.id = STYLE_ID;
        st2.textContent = '.' + MARK + '{outline:3px solid rgba(34,197,94,0.9)!important;outline-offset:2px;background:rgba(34,197,94,0.07)!important;transition:outline .15s,background .15s}';
        document.head.appendChild(st2);
      }
      for (j = 0; j < targets.length; j++) targets[j].classList.add(MARK);
      try { targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e4) {}
      return { ok: true, count: targets.length, tag: targets[0].tagName, className: targets[0].className || '' };
    }
    var post = null;
    for (var i = 0; i < POST_SEL.length; i++) {
      try { post = document.querySelector(POST_SEL[i]); } catch (e) { post = null; }
      if (post) break;
    }
    var target = null;
    if (post) {
      var bb1 = pickBody(post);
      if (bb1 && (bb1.innerHTML || '').trim().length >= 80 &&
          (bb1.textContent || '').replace(/\\s+/g, ' ').trim().length >= 80) {
        target = bb1;
      }
    }
    if (!target) {
      var wraps = tr.querySelectorAll('.bbWrapper');
      var best = null, bestN = 0;
      for (var w = 0; w < wraps.length; w++) {
        var n = (wraps[w].textContent || '').replace(/\\s+/g, ' ').length;
        if (n > bestN) { bestN = n; best = wraps[w]; }
      }
      if (best && bestN >= 400) target = best;
    }
    if (!target) return { ok: false, reason: 'no_forum_block' };
    target.classList.add(MARK);
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = '.' + MARK + '{outline:3px solid rgba(34,197,94,0.9)!important;outline-offset:2px;background:rgba(34,197,94,0.07)!important;transition:outline .15s,background .15s}';
      document.head.appendChild(st);
    }
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    return { ok: true, count: 1, tag: target.tagName, className: target.className || '' };
  })();`
}

export function getForumImportHighlightClearScript(): string {
  return `(function(){
    var MARK = ${JSON.stringify(MARK_CLASS)};
    var nodes = document.getElementsByClassName(MARK);
    while (nodes.length) { nodes[0].classList.remove(MARK); }
  })();`
}
