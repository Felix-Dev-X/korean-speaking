// 检查线上网站（GitHub Pages）是不是最新、能不能正常用：node scripts/check-live.mjs [--wait 分钟] [--url 网址]
//   1. 线上 index.html 的版本号 = 仓库里的版本号（部署有延迟：--wait 时每 20 秒重试，最多等几分钟）
//   2. 页面引用的每个文件（含离线缓存清单里的）都能下载
//   3. 用浏览器打开首页、单词页、搜索，没有脚本错误
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'https://felix-dev-x.github.io/korean-speaking/app/');
const waitMin = +arg('--wait', 0);
const local = (fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8').match(/app-version" content="([^"]+)/) || [])[1];
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

async function liveVersion() {
  const r = await fetch(URL_ + '?nocache=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return { err: 'HTTP ' + r.status };
  const html = await r.text();
  return { html, v: (html.match(/app-version" content="([^"]+)/) || [])[1] };
}
let live = await liveVersion();
const until = Date.now() + waitMin * 60e3;
while (live.v !== local && Date.now() < until) {
  console.log(`  线上版本 ${live.v || live.err}，仓库版本 ${local}，等部署……`);
  await new Promise((r) => setTimeout(r, 20e3));
  live = await liveVersion();
}
if (live.err) { fail('线上网址打不开：' + live.err); process.exit(1); }
if (live.v !== local) fail(`线上版本 ${live.v} 和仓库版本 ${local} 不一致（部署还没完成，或者推送失败）`);
else console.log(`✓ 线上版本 ${live.v} 是最新的`);

// 所有文件能下载
const files = [...live.html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
const sw = await fetch(URL_ + 'sw.js').then((r) => (r.ok ? r.text() : ''));
const swList = JSON.parse((sw.match(/const ASSETS = (\[[\s\S]*?\]);/) || [])[1] || '[]');
if (!sw) fail('离线缓存 sw.js 下载不了');
const all = [...new Set(files.concat(swList))];
let bad = 0;
await Promise.all(all.map(async (f) => { const r = await fetch(new URL(f, URL_)); if (!r.ok) { bad++; fail(`文件下载失败（${r.status}）：${f}`); } }));
if (!bad) console.log(`✓ ${all.length} 个文件都能下载`);

// 浏览器打开
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL_ + '#home'); await p.waitForSelector('.hero', { timeout: 30000 });
await p.evaluate(() => { location.hash = '#vocab'; });
await p.waitForFunction(() => /15,7\d\d/.test((document.querySelector('.page-title') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => fail('单词页没有加载出完整词库'));
await p.evaluate(() => { location.hash = '#search'; }); await p.waitForSelector('.sq'); await p.fill('.sq', '병원'); await p.waitForTimeout(800);
if (!(await p.locator('.s-word').count())) fail('搜索没有结果');
if (errs.length) fail('页面脚本错误：' + errs.join(' / '));
else console.log('✓ 首页、单词页、搜索正常');
await b.close();
console.log(process.exitCode ? '✗ 线上检查没通过' : '✓ 线上检查通过');
