/**
 * Скрипт для executeJavaScript(webview): один клик по странице → CSS / XPath (подсказка для полей).
 * Подсказка с pointer-events: none — клики доходят до страницы.
 */

export type WebviewPickerResult = {
  css: string
  xpath: string
  relativeCss: string | null
  tagName: string
  textSample: string
}

export function getWebviewPickerScript(): string {
  return `(function(){
return new Promise(function(resolve){
  var hint=document.createElement('div');
  hint.id='lexpatrol-picker-hint';
  hint.textContent='LexPatrol: клик по элементу — подставить селектор. Esc — отмена.';
  hint.style.cssText='position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);background:#0c0e12;color:#e8eaed;padding:10px 18px;border-radius:10px;font:13px system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.45);pointer-events:none;border:1px solid rgba(255,255,255,.12)';
  document.documentElement.appendChild(hint);
  document.body.style.cursor='crosshair';

  function esc(s){return (typeof CSS!=='undefined'&&CSS.escape)?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,'\\\\$&');}

  function cssPath(el){
    if(!el||el.nodeType!==1)return'';
    if(el.id)return'#'+esc(el.id);
    var parts=[];
    var cur=el;
    var depth=0;
    while(cur&&cur.nodeType===1&&cur!==document.documentElement&&depth<16){
      if(cur.id){parts.unshift('#'+esc(cur.id));break;}
      var tag=cur.tagName.toLowerCase();
      var par=cur.parentElement;
      if(!par)break;
      var same=[].filter.call(par.children,function(c){return c.tagName===cur.tagName;});
      var idx=same.indexOf(cur)+1;
      parts.unshift(tag+':nth-of-type('+idx+')');
      cur=par;
      depth++;
    }
    return parts.join(' > ');
  }

  function xpathFromEl(el){
    if(!el||el.nodeType!==1)return'';
    if(el.id)return'//*[@id="'+String(el.id).replace(/"/g,'&quot;')+'"]';
    var segs=[];
    var cur=el;
    var d=0;
    while(cur&&cur.nodeType===1&&d<20){
      if(cur.id){segs.unshift('//*[@id="'+String(cur.id).replace(/"/g,'&quot;')+'"]');break;}
      var i=1,s=cur.previousSibling;
      while(s){if(s.nodeType===1&&s.tagName===cur.tagName)i++;s=s.previousSibling;}
      segs.unshift(cur.tagName.toLowerCase()+'['+i+']');
      cur=cur.parentElement;
      d++;
    }
    return '/'+(segs.length?segs.join('/')+'':'');
  }

  function relativeInRow(el){
    var tr=el.closest?el.closest('tr'):null;
    if(!tr||!el)return null;
    var cells=tr.querySelectorAll('td,th');
    for(var i=0;i<cells.length;i++){
      if(cells[i]===el)return (el.tagName||'').toLowerCase()+':nth-child('+(i+1)+')';
    }
    return null;
  }

  function cleanup(){
    document.removeEventListener('click',onClick,true);
    document.removeEventListener('keydown',onKey,true);
    document.body.style.cursor='';
    if(hint.parentNode)hint.parentNode.removeChild(hint);
  }

  function onClick(e){
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var t=e.target;
    if(t===hint){return;}
    cleanup();
    var css=cssPath(t);
    var xp=xpathFromEl(t);
    var rel=relativeInRow(t);
    resolve({
      css:css,
      xpath:xp,
      relativeCss:rel,
      tagName:t.tagName||'',
      textSample:(t.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120)
    });
  }

  function onKey(e){
    if(e.key==='Escape'){
      e.preventDefault();
      cleanup();
      resolve(null);
    }
  }

  document.addEventListener('click',onClick,true);
  document.addEventListener('keydown',onKey,true);
});
})()`
}

export function parsePickerResult(raw: unknown): WebviewPickerResult | null {
  if (raw == null) return null
  if (typeof raw === 'object' && raw !== null && 'css' in (raw as object)) {
    return raw as WebviewPickerResult
  }
  return null
}
