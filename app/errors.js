/* 出错提示：页面上的任何脚本错误都显示一条提示（而不是一片空白），
 * 可以一键复制错误信息（版本、页面、浏览器、出错位置）反馈给开发者。
 * 最近 5 条错误存在本机，「设置 → 关于」里也能复制。
 * 这个文件要在所有其他脚本之前加载。 */
(function () {
  'use strict';
  var KEY = 'kss-errors';
  function version() {
    var m = document.querySelector('meta[name="app-version"]');
    return window.KSS_VERSION || (m && m.content) || '开发版';
  }
  function report(msg, stack) {
    return [
      '韩语口语特训 · 错误报告',
      '版本：' + version() + (window.KSS_ENV === 'artifact' ? '（claude.ai 网页版）' : ''),
      '时间：' + new Date().toLocaleString(),
      '页面：' + (location.hash || '#home'),
      '浏览器：' + navigator.userAgent,
      '错误：' + msg,
      stack ? '位置：\n' + String(stack).split('\n').slice(0, 6).join('\n') : '',
    ].join('\n');
  }
  function recent() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function log(msg, stack) {
    var text = report(msg, stack);
    try { var a = recent(); a.unshift(text); localStorage.setItem(KEY, JSON.stringify(a.slice(0, 5))); } catch (e) { /* ignore */ }
    return text;
  }
  function copy(text) {
    var done = function () { var b = document.querySelector('#err-bar .err-copy'); if (b) b.textContent = '已复制 ✓'; };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { window.prompt('复制下面的错误信息：', text); }
      ta.remove();
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  var count = 0;
  function show(msg, stack) {
    var text = log(msg, stack);
    if (++count > 3) return;   // 同一次打开最多提示 3 次，避免刷屏
    var bar = document.getElementById('err-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'err-bar'; bar.className = 'err-bar'; bar.setAttribute('role', 'alert');
      (document.body || document.documentElement).appendChild(bar);
    }
    bar.innerHTML = '<div class="err-h"><b>😵 出了点问题</b><button type="button" class="err-x" aria-label="关闭">✕</button></div>'
      + '<div class="err-msg"></div>'
      + '<div class="err-tip">刷新一般就好了，学习进度不会因此丢失。如果反复出现，请点「复制错误信息」发给开发者。</div>'
      + '<div class="err-acts"><button type="button" class="btn small err-copy">复制错误信息</button><button type="button" class="btn small primary err-reload">刷新页面</button></div>';
    bar.querySelector('.err-msg').textContent = msg;
    bar.querySelector('.err-copy').onclick = function () { copy(text); };
    bar.querySelector('.err-reload').onclick = function () { location.reload(); };
    bar.querySelector('.err-x').onclick = function () { bar.remove(); };
  }
  // 数据脚本没下载下来（断网、文件更新到一半）：记下来，app.js 启动时提示刷新
  window.KSS_MISSING = [];
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'SCRIPT' && el.src) { window.KSS_MISSING.push(el.src.split('/').pop().split('?')[0]); log('文件没加载：' + el.src); }
  }, true);
  window.addEventListener('error', function (e) {
    // 跨域脚本、浏览器插件、ResizeObserver 的无害提示不算
    if (!e.message || e.message === 'Script error.' || /ResizeObserver/.test(e.message)) return;
    show(e.message, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    // 只提示程序错误；网络失败、用户取消等由各功能自己处理，这里只记下来
    if (r instanceof Error && /^(TypeError|ReferenceError|SyntaxError|RangeError)$/.test(r.name)) show(r.message, r.stack);
    else if (r) log('（未处理的 Promise）' + (r.message || String(r)), r.stack);
  });
  window.KSS_ERR = { show: show, log: log, report: report, recent: recent, copy: copy, version: version };
})();
