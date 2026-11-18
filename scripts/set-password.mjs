// 设置（或重设）管理员账号密码：node scripts/set-password.mjs <账号> <密码>
// 等于 node scripts/accounts.mjs set <账号> <密码> admin。管理普通账户请用 scripts/accounts.mjs。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [user, pass] = process.argv.slice(2);
if (!user || !pass) { console.error('用法：node scripts/set-password.mjs <账号> <密码>'); process.exit(1); }
execFileSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'accounts.mjs'), 'set', user, pass, 'admin'], { stdio: 'inherit' });
