/* 登录门：只有输对管理员账号密码才能进入。
 * - 仓库里只保存密码的摘要（PBKDF2-SHA256），不保存明文。换密码：node scripts/set-password.mjs <账号> <密码>
 * - 登录后记在这台设备上（勾掉「记住这台设备」则关掉浏览器就要重新登录）；「设置 → 关于 → 退出登录」
 * - 说明：这是纯前端网页，这个门只能挡住拿到网址直接打开的人，挡不住能读仓库文件的人。
 * 这个文件放在 <head> 里最先加载：没登录时页面内容一直是隐藏的（见 style.css 的 html:not(.kss-ok)）。 */
(function () {
  'use strict';
  // ── 由 scripts/set-password.mjs 生成，不要手改 ──
  var CONFIG = { salt: '7679dcb4e088f6f627b11a41bc1dfd4e', iter: 200000, hash: '9e13e9a0e7300bc961e9e68c2f59847ff056acdfc822458a9235158e76a4c2b6' };
  // ── 生成结束 ──
  var C = window.KSS_GATE_OVERRIDE || CONFIG;   // 自动测试用测试账号覆盖
  var KEY = 'kss-auth';
  var root = document.documentElement;
  function stored() {
    try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch (e) { return null; }
  }
  if (stored() === C.hash) { root.classList.add('kss-ok'); window.KSS_GATE = { logout: logout }; return; }

  function logout() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  }
  window.KSS_GATE = { logout: logout };

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function derive(user, pass) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(user.trim().toLowerCase() + '\n' + pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(C.salt), iterations: C.iter, hash: 'SHA-256' }, k, 256); })
      .then(hex);
  }

  function show() {
    var g = document.createElement('div');
    g.id = 'gate';
    g.innerHTML = '<form class="gate-box" autocomplete="on">'
      + '<div class="gate-logo">말</div>'
      + '<h1>韩语口语特训</h1><p class="gate-sub">请登录</p>'
      + '<label for="gate-user">账号</label><input id="gate-user" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>'
      + '<label for="gate-pass">密码</label><div class="gate-pw"><input id="gate-pass" name="password" type="password" autocomplete="current-password" required><button type="button" class="gate-eye" aria-label="显示密码">👁</button></div>'
      + '<label class="gate-remember"><input type="checkbox" id="gate-remember" checked> 记住这台设备</label>'
      + '<div class="gate-err" role="alert"></div>'
      + '<button type="submit" class="gate-go">登录</button></form>';
    document.body.appendChild(g);
    var f = g.querySelector('form'), u = g.querySelector('#gate-user'), p = g.querySelector('#gate-pass'), err = g.querySelector('.gate-err'), go = g.querySelector('.gate-go');
    g.querySelector('.gate-eye').onclick = function () { p.type = p.type === 'password' ? 'text' : 'password'; };
    var fails = 0, waitUntil = 0;
    if (!window.crypto || !crypto.subtle) { err.textContent = '这个浏览器不能登录（需要 https 打开）。'; go.disabled = true; }
    f.onsubmit = function (e) {
      e.preventDefault();
      if (Date.now() < waitUntil) { err.textContent = '试错太多次了，请 ' + Math.ceil((waitUntil - Date.now()) / 1000) + ' 秒后再试。'; return; }
      if (!u.value.trim() || !p.value) { err.textContent = '请输入账号和密码。'; return; }
      go.disabled = true; go.textContent = '登录中……'; err.textContent = '';
      derive(u.value, p.value).then(function (h) {
        if (h === C.hash) {
          try { (document.getElementById('gate-remember').checked ? localStorage : sessionStorage).setItem(KEY, h); } catch (e2) { /* ignore */ }
          root.classList.add('kss-ok');
          g.remove();
          return;
        }
        fails++;
        if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; }
        err.textContent = '账号或密码不对。';
        p.value = ''; p.focus();
      }).catch(function () { err.textContent = '登录出错了，请刷新页面再试。'; })
        .then(function () { go.disabled = false; go.textContent = '登录'; });
    };
    setTimeout(function () { try { u.focus(); } catch (e) { /* ignore */ } }, 50);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
