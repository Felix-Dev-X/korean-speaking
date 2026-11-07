// 把 app/ 打包成一个单文件网页（发布为 claude.ai Artifact 用）：node scripts/build-artifact.mjs
// 输出 dist/korean-speaking.html。网页版模式（KSS_ENV = 'artifact'）：
//   - 用手机键盘的语音输入代替网页语音识别/录音（发布页面不能使用麦克风）
//   - AI 陪练和批改通过 claude.ai 的 sample 能力使用观看者自己的 Claude 账户
//   - 学习进度同步到观看者自己的账户（db: data/users/<id>/progress）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES } from './load-data.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const read = (f) => fs.readFileSync(path.join(app, f), 'utf8');
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script');

const html = read('index.html');
const body = html.slice(html.indexOf('<header'), html.indexOf('</footer>') + '</footer>'.length)
  .replace('进度保存在本机浏览器', '登录后进度自动同步到你的账户');
const desc = (html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '';

const parts = [
  '<title>韩语口语特训</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  `<meta name="description" content="${desc}">`,
  `<style>\n${read('style.css')}\n</style>`,
  body,
  "<script>window.KSS_ENV = 'artifact';</script>",
  ...FILES.map((f) => `<script>\n${safeJs(read('data/' + f + '.js'))}\n</script>`),
  `<script>\n${safeJs(read('app.js'))}\n</script>`,
];
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'korean-speaking.html');
fs.writeFileSync(out, parts.join('\n') + '\n');
console.log('✓ ' + path.relative(root, out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
