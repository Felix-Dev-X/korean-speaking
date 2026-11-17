// 发布到公开仓库（GitHub Pages）：node scripts/publish.mjs <公开仓库的本地目录> [--full] [--push]
//   1. 打包（版本号、离线缓存、claude.ai 单文件版）+ 数据检查 + 自动测试（默认快速版，--full 跑完整版）
//   2. 把本目录完整同步到公开仓库目录（新增、修改、删除都同步；不动 .git 和 node_modules），列出改动
//   3. --push：在公开仓库提交并推送，然后等线上部署完成，检查线上版本
// 任何一步失败就停下，不会推送。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dst = args.find((a) => !a.startsWith('--'));
if (!dst || !fs.existsSync(path.join(dst, '.git'))) { console.error('用法：node scripts/publish.mjs <公开仓库的本地目录> [--full] [--push]'); process.exit(1); }
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, Object.assign({ cwd: src, stdio: 'inherit' }, opts));

console.log('① 打包和检查');
run('node', ['scripts/stamp-assets.mjs']);
run('node', ['scripts/build-artifact.mjs']);
run('node', ['scripts/check-data.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
run('node', ['tests/run.mjs'], { env: Object.assign({}, process.env, args.includes('--full') ? {} : { FAST: '1' }) });

console.log('\n② 同步到 ' + dst);
const SKIP = new Set(['.git', 'node_modules']);
const list = (base, rel = '') => fs.readdirSync(path.join(base, rel), { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const r = path.join(rel, e.name);
  return e.isDirectory() ? list(base, r) : [r];
});
const hash = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const want = new Set(list(src));
const changes = [];
for (const f of want) {
  const a = path.join(src, f), b = path.join(dst, f);
  if (!fs.existsSync(b)) changes.push('+ ' + f);
  else if (hash(a) !== hash(b)) changes.push('~ ' + f);
  else continue;
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.copyFileSync(a, b);
}
for (const f of list(dst)) if (!want.has(f)) { fs.rmSync(path.join(dst, f)); changes.push('- ' + f); }
console.log(changes.length ? changes.join('\n') : '（没有改动）');

if (args.includes('--push') && changes.length) {
  console.log('\n③ 提交并推送');
  const git = (a) => execFileSync('git', a, { cwd: dst, stdio: 'inherit' });
  const msg = (args.find((a) => a.startsWith('--message=')) || '').slice(10) || '更新';
  git(['add', '-A']);
  git(['commit', '-q', '-m', msg]);
  git(['push', 'origin', 'HEAD']);
  console.log('\n④ 等线上部署完成并检查');
  run('node', ['scripts/check-live.mjs', '--wait', '6']);
}
