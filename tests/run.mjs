// 自动测试：node tests/run.mjs [名字关键词...]
//   例：node tests/run.mjs            全部
//       node tests/run.mjs vocab sync 只跑文件名包含 vocab 或 sync 的
//   FAST=1 node tests/run.mjs        全站巡检只抽样（本地快速检查用）
// 需要 Playwright（npm install 后 npx playwright install chromium）。
// 每个测试文件导出 default async (t) => {…}；t 提供 page()、check()、eq() 等，见 lib.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launch, makeT, ROOT } from './lib.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const want = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()
  .filter((f) => !want.length || want.some((w) => f.includes(w)));
if (!fs.existsSync(path.join(ROOT, 'dist', 'korean-speaking.html'))) {
  console.error('缺少 dist/korean-speaking.html，先运行：node scripts/build-artifact.mjs'); process.exit(1);
}
const server = await startServer();
const browser = await launch();
let failed = 0;
const t0 = Date.now();
for (const f of files) {
  const t = makeT(browser, server.base, f);
  const s = Date.now();
  try { await (await import(path.join(dir, f))).default(t); }
  catch (e) { t.fail('测试中断：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
  await t.close();
  const ok = !t.failures.length;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${f}  (${t.checks} 项检查, ${((Date.now() - s) / 1000).toFixed(1)}s)`);
  t.failures.forEach((m) => console.log('    ✗ ' + m));
}
await browser.close();
server.close();
console.log(`\n${failed ? '✗' : '✓'} ${files.length - failed}/${files.length} 个测试文件通过（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
process.exit(failed ? 1 : 0);
