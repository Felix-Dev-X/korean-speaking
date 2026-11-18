// 给 app/index.html 里引用的 js/css 加上内容版本号（?v=xxxxxxxx），
// 防止浏览器缓存把新旧文件混在一起用。每次修改 app/ 后运行：node scripts/stamp-assets.mjs
// 同时：
//   - 在 index.html 写入整体版本号 <meta name="app-version">（设置页和错误报告里显示）
//   - 按 app/sw-template.js 生成离线缓存 app/sw.js（缓存列表 = 所有带版本号的文件 + 图标）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const file = path.join(app, 'index.html');
let html = fs.readFileSync(file, 'utf8');
let n = 0;
const assets = [];
// gate.js（登录门）不加版本号：网页里改密码时只改这一个文件，不用重新打包
const NO_STAMP = new Set(['gate.js']);
html = html.replace(/src="gate\.js\?v=[0-9a-f]+"/, 'src="gate.js"');
const all = crypto.createHash('md5');
html = html.replace(/(src|href)="([^"?#:]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"/g, (m, attr, rel) => {
  const abs = path.join(app, rel);
  if (!fs.existsSync(abs) || NO_STAMP.has(rel)) return m;
  const buf = fs.readFileSync(abs);
  const v = crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);
  all.update(rel + v);
  n++;
  assets.push(`${rel}?v=${v}`);
  return `${attr}="${rel}?v=${v}"`;
});
const version = all.digest('hex').slice(0, 8);
const meta = `<meta name="app-version" content="${version}">`;
if (/<meta name="app-version" content="[^"]*">/.test(html)) html = html.replace(/<meta name="app-version" content="[^"]*">/, meta);
else html = html.replace('</head>', `  ${meta}\n</head>`);
fs.writeFileSync(file, html);

const extra = ['gate.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'].filter((f) => fs.existsSync(path.join(app, f)));
const sw = fs.readFileSync(path.join(app, 'sw-template.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('__ASSETS__', JSON.stringify(assets.concat(extra), null, 2))
  .replace(/^\/\* 离线缓存[\s\S]*?\*\/\n/, (c) => c.replace('由 scripts/stamp-assets.mjs 按这个模板生成 app/sw.js，不要直接改 sw.js。', '这个文件由 scripts/stamp-assets.mjs 按 sw-template.js 生成，不要直接改。'));
fs.writeFileSync(path.join(app, 'sw.js'), sw);
console.log(`✓ 已给 ${n} 个文件加上版本号 · 整体版本 ${version} · 离线缓存 ${assets.length + extra.length} 个文件`);
