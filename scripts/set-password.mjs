// 设置（或更换）登录账号密码：node scripts/set-password.mjs <账号> <密码>
// 只把密码的摘要写进 app/gate.js（PBKDF2-SHA256，20 万次，随机盐），不保存明文。
// 改完运行 npm run build 再发布；所有设备上的旧登录会失效，需要用新密码重新登录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [user, pass] = process.argv.slice(2);
if (!user || !pass) { console.error('用法：node scripts/set-password.mjs <账号> <密码>'); process.exit(1); }
if (pass.length < 10) { console.error('密码至少 10 位'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const iter = 200000;
const hash = crypto.pbkdf2Sync(user.trim().toLowerCase() + '\n' + pass, salt, iter, 32, 'sha256').toString('hex');
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'gate.js');
const src = fs.readFileSync(file, 'utf8');
const next = src.replace(/var CONFIG = \{[^}]*\};/, `var CONFIG = { salt: '${salt}', iter: ${iter}, hash: '${hash}' };`);
if (next === src) { console.error('没找到 gate.js 里的 CONFIG'); process.exit(1); }
fs.writeFileSync(file, next);
console.log('✓ 已更新登录账号密码（app/gate.js 里只有摘要）。接下来运行 npm run build 再发布。');
