// 给 app/index.html 里引用的 js/css 加上内容版本号（?v=xxxxxxxx），
// 防止浏览器缓存把新旧文件混在一起用。每次修改 app/ 后运行：node scripts/stamp-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const file = path.join(app, 'index.html');
let html = fs.readFileSync(file, 'utf8');
let n = 0;
html = html.replace(/(src|href)="([^"?#:]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"/g, (m, attr, rel) => {
  const abs = path.join(app, rel);
  if (!fs.existsSync(abs)) return m;
  const v = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  n++;
  return `${attr}="${rel}?v=${v}"`;
});
fs.writeFileSync(file, html);
console.log(`✓ 已给 ${n} 个文件加上版本号`);
