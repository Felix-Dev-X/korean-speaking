// 测试工具：静态服务器、浏览器、断言
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pw = require('playwright');
export const { devices } = pw;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
// 只提供 app/ 目录（和 GitHub Pages 上 /app/ 一样）；地址用 localhost，Service Worker 才能注册
export function startServer() {
  const base = path.join(ROOT, 'app');
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(base, p);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://localhost:${srv.address().port}/`, close: () => srv.close() })));
}
export function launch() {
  const exe = process.env.CHROMIUM_PATH;
  return pw.chromium.launch(exe ? { executablePath: exe } : {});
}
// claude.ai 网页版（单文件）：外面套上视口设置（claude.ai 发布时会自动加）
export function artifactFile() {
  const f = path.join(os.tmpdir(), 'kss-artifact-test.html');
  fs.writeFileSync(f, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' + fs.readFileSync(path.join(ROOT, 'dist', 'korean-speaking.html'), 'utf8'));
  return 'file://' + f;
}

// 登录：测试默认已登录（把 gate.js 里的摘要写进 localStorage，和真登录后一样）
// 读 gate.js 里的账号列表（测试默认用第一个管理员登录）
export function gateAccounts() {
  const m = fs.readFileSync(path.join(ROOT, 'app', 'gate.js'), 'utf8').match(/var ACCOUNTS = (\[[\s\S]*?\n  \]);/);
  return m ? JSON.parse(m[1]) : [];
}
export const AUTH = (gateAccounts().find((a) => a.role === 'admin') || {}).hash;

export function makeT(browser, base, name) {
  const failures = [], contexts = [];
  const t = {
    base, browser, failures, checks: 0, name,
    fast: !!process.env.FAST,
    fail(msg) { failures.push(msg); },
    check(cond, msg) { t.checks++; if (!cond) failures.push(msg); return !!cond; },
    eq(a, b, msg) { t.checks++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) failures.push(`${msg}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); return ok; },
    // 新开一个"设备"（独立的存储）。opts.device = 'iPhone 13'；opts.seed = 预置进度；opts.init = 额外的初始化脚本
    async context(opts = {}) {
      const ctx = await browser.newContext(Object.assign({ viewport: { width: 375, height: 800 } }, opts.device ? devices[opts.device] : {}, opts.ctx || {}));
      contexts.push(ctx);
      if (!opts.noAuth) await ctx.addInitScript((h) => { try { localStorage.setItem('kss-auth', h); } catch (e) { /* ignore */ } }, AUTH);
      await ctx.addInitScript((seed) => {
        // 测试里不真的发音
        if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { (window.__said = window.__said || []).push(u.text); };
        if (seed && !localStorage.getItem('kss-v1')) localStorage.setItem('kss-v1', JSON.stringify(seed));
      }, opts.seed || null);
      if (opts.init) await ctx.addInitScript(opts.init.fn, opts.init.arg);
      return ctx;
    },
    // 打开页面；页面上的脚本错误自动记为失败（opts.allowErrors 除外）
    async page(hash = '#home', opts = {}) {
      const ctx = opts.context || await t.context(opts);
      const p = await ctx.newPage();
      p.errs = [];
      p.on('pageerror', (e) => { p.errs.push(e.message); if (!opts.allowErrors) failures.push(`页面脚本错误（${hash}）：${e.message}`); });
      await p.goto((opts.url || base) + hash);
      await p.waitForSelector(opts.noAuth ? '#gate, #app > div' : '#app > div', { timeout: 15000, state: 'attached' });
      return p;
    },
    async go(p, hash) { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(120); },
    state: (p) => p.evaluate(() => window.__kss.state()),
    async close() { for (const c of contexts) await c.close().catch(() => {}); },
  };
  return t;
}
