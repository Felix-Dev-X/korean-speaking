// 体积和速度上限：超了说明加的东西让网页明显变慢，需要先想办法（压缩、按需加载……）
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const LIMIT = {
  firstLoadKB: 2600,   // GitHub 版首屏要下载的脚本+样式（不含后台加载的词库）
  artifactKB: 8000,    // claude.ai 单文件版（上限 16 MB，留足余量）
  homeMs: 4000,        // CPU 降速 4 倍（模拟中低端手机）时首页出来的时间
};
export default async (t) => {
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  let kb = 0;
  for (const m of html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"?]+)/g)) kb += fs.statSync(path.join(ROOT, 'app', m[1])).size / 1024;
  t.check(kb < LIMIT.firstLoadKB, `首屏文件 ${Math.round(kb)} KB，超过上限 ${LIMIT.firstLoadKB} KB`);
  const art = fs.statSync(path.join(ROOT, 'dist', 'korean-speaking.html')).size / 1024;
  t.check(art < LIMIT.artifactKB, `claude.ai 版 ${Math.round(art)} KB，超过上限 ${LIMIT.artifactKB} KB`);

  // 版本号、离线缓存是不是最新（忘了运行 stamp-assets 会导致手机用旧文件）
  for (const m of html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=([0-9a-f]+)"/g)) {
    const { createHash } = await import('node:crypto');
    const v = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'app', m[1]))).digest('hex').slice(0, 8);
    t.check(v === m[2], `${m[1]} 的版本号过期了，请运行 node scripts/stamp-assets.mjs`);
  }
  const sw = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  t.check(sw.includes((html.match(/app-version" content="([^"]+)/) || [])[1]), 'sw.js 和页面版本号对不上，请运行 node scripts/stamp-assets.mjs');
  const dist = fs.readFileSync(path.join(ROOT, 'dist', 'korean-speaking.html'), 'utf8');
  t.check(dist.includes(fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8').slice(0, 2000)) && dist.includes((html.match(/app-version" content="([^"]+)/) || [])[1]),
    'dist 没有重新打包，请运行 node scripts/build-artifact.mjs');

  // 首页速度
  const ctx = await t.context();
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const s = Date.now();
  await p.goto(t.base + '#home'); await p.waitForSelector('.hero');
  const ms = Date.now() - s;
  t.check(ms < LIMIT.homeMs, `首页 ${ms} ms，超过上限 ${LIMIT.homeMs} ms`);
  console.log(`    首屏 ${Math.round(kb)} KB · claude.ai 版 ${Math.round(art)} KB · 首页（CPU 降速 4 倍）${ms} ms`);
};
