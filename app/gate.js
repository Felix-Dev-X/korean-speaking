/* 登录门：只有输对账号密码才能进入。
 * - 两种账号：管理员（admin）可以用 AI 陪练、管理所有账号；普通账户（user）除 AI 陪练外全部功能都能用。
 * - 仓库里只保存每个账号密码的摘要（PBKDF2-SHA256，各自的随机盐），不保存明文；账号名是明文。
 * - 管理账号：网页「设置 → 账号」（管理员，用 GitHub 令牌把改动提交到仓库），或 node scripts/accounts.mjs
 * - 这个文件不加版本号（index.html 里就是 gate.js），这样网页里改了账号、只改这一个文件也能马上生效
 * - 登录后记在这台设备上（勾掉「记住这台设备」则关掉浏览器就要重新登录）；「设置 → 账号 → 退出登录」
 * - 每个账号的学习进度分开保存（管理员用原来的存储，普通账户各自一份）
 * - 说明：这是纯前端网页，这个门只能挡住拿到网址直接打开的人，挡不住能读仓库文件的人。
 * 这个文件放在 <head> 里最先加载：没登录时页面内容一直是隐藏的（见 style.css 的 html:not(.kss-ok)）。 */
(function () {
  'use strict';
  // ── 账号列表：由 scripts/accounts.mjs 或网页「设置 → 账号」生成，不要手改 ──
  var ACCOUNTS = [
    {"name":"admin","role":"admin","salt":"3ecff8f2ed054d399e087ecedb28e399","iter":200000,"hash":"96029ff4bebaf7a086cf74e7b86218dc649841892abdfc79360f7c6f003ce32c"},
    {"name":"user1","role":"user","salt":"87f286fb6af68270c2ba7c8ddabda8ad","iter":200000,"hash":"6b572765d0deea2b60e583bfc5cfbd653a3a2ef086667886bbb51c9e70f7d683"},
    {"name":"user2","role":"user","salt":"f02a7dc989fa30eacb3982ee32287a97","iter":200000,"hash":"7ff37f7b5bb3d43011f43eea4bb3ad5c3b4787f2e3a2f29e285fa4d51269e513"},
    {"name":"user3","role":"user","salt":"d76194fca236130cc8cbf468d6e78b1d","iter":200000,"hash":"29a3daaadfd04843b91afd1ca96d5dcc94479bfd93d022762aa4a910dbfbb148"}
  ];
  // ── 账号列表结束 ──
  var A = window.KSS_GATE_OVERRIDE || ACCOUNTS;   // 自动测试用测试账号覆盖
  var KEY = 'kss-auth';
  var root = document.documentElement;
  function stored() {
    try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch (e) { return null; }
  }
  function logout() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  var norm = function (u) { return String(u || '').trim().toLowerCase(); };
  // 账号（不分大小写）+ 密码 → PBKDF2-SHA256 摘要
  function derive(user, pass, salt, iter) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(norm(user) + '\n' + pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: iter || 200000, hash: 'SHA-256' }, k, 256); })
      .then(hex);
  }
  function find(user) { for (var i = 0; i < A.length; i++) if (A[i].name === norm(user)) return A[i]; return null; }
  // 检查账号密码：对了返回这个账号，不对返回 null
  function check(user, pass) {
    var a = find(user);
    if (!a) return derive(user, pass, 'no-such-user', 200000).then(function () { return null; });   // 账号不存在也花同样的时间
    return derive(user, pass, a.salt, a.iter).then(function (h) { return h === a.hash ? a : null; });
  }
  var token = stored(), me = null;
  for (var i = 0; i < A.length; i++) if (token && A[i].hash === token) me = A[i];
  // 设置页（改密码、管理账号）和 app.js（AI 权限、进度分开存）用
  window.KSS_GATE = {
    logout: logout, derive: derive, check: check, find: find, norm: norm, accounts: A, key: KEY,
    account: me, role: me ? me.role : null, isAdmin: !!(me && me.role === 'admin'),
  };
  if (me) { root.classList.add('kss-ok'); return; }

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
      check(u.value, p.value).then(function (a) {
        if (a) {
          try { (document.getElementById('gate-remember').checked ? localStorage : sessionStorage).setItem(KEY, a.hash); } catch (e2) { /* ignore */ }
          location.reload();   // 重新打开：按这个账号加载它自己的学习进度和权限
          return;
        }
        fails++;
        if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; }
        err.textContent = '账号或密码不对。';
        p.value = ''; p.focus();
        go.disabled = false; go.textContent = '登录';
      }).catch(function () { err.textContent = '登录出错了，请刷新页面再试。'; go.disabled = false; go.textContent = '登录'; });
    };
    setTimeout(function () { try { u.focus(); } catch (e) { /* ignore */ } }, 50);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
