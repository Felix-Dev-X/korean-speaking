// 管理登录账号（写进 app/gate.js，只保存密码摘要）：
//   node scripts/accounts.mjs list                         列出账号和角色
//   node scripts/accounts.mjs set <账号> <密码> [admin|user]  新增或重设密码（默认 user = 普通账户）
//   node scripts/accounts.mjs remove <账号>                  删除账号（至少要留一个管理员）
// 管理员可以用 AI 陪练；普通账户除 AI 陪练外全部功能都能用。改完运行 npm run build 再发布。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'gate.js');
const RE = /var ACCOUNTS = \[[\s\S]*?\n  \];/;
export function readAccounts(src = fs.readFileSync(file, 'utf8')) {
  const m = src.match(RE);
  if (!m) throw new Error('gate.js 里没找到 ACCOUNTS');
  return JSON.parse(m[0].replace(/^var ACCOUNTS = /, '').replace(/;$/, ''));
}
export function writeAccounts(list, src = fs.readFileSync(file, 'utf8')) {
  const body = 'var ACCOUNTS = [\n' + list.map((a) => '    ' + JSON.stringify(a)).join(',\n') + '\n  ];';
  return src.replace(RE, body);
}
export const norm = (u) => String(u || '').trim().toLowerCase();
export function makeAccount(name, pass, role) {
  const salt = crypto.randomBytes(16).toString('hex'), iter = 200000;
  return { name: norm(name), role, salt, iter, hash: crypto.pbkdf2Sync(norm(name) + '\n' + pass, salt, iter, 32, 'sha256').toString('hex') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, name, pass, role = 'user'] = process.argv.slice(2);
  let list = readAccounts();
  if (cmd === 'list' || !cmd) {
    list.forEach((a) => console.log(`${a.role === 'admin' ? '管理员  ' : '普通账户'}  ${a.name}`));
    process.exit(0);
  }
  if (cmd === 'set') {
    if (!name || !pass) { console.error('用法：node scripts/accounts.mjs set <账号> <密码> [admin|user]'); process.exit(1); }
    if (!/^[a-z0-9._-]{2,32}$/.test(norm(name))) { console.error('账号只能用字母、数字和 . _ -，2–32 位'); process.exit(1); }
    if (pass.length < 8) { console.error('密码至少 8 位'); process.exit(1); }
    if (!['admin', 'user'].includes(role)) { console.error('角色只能是 admin 或 user'); process.exit(1); }
    const a = makeAccount(name, pass, role);
    const i = list.findIndex((x) => x.name === a.name);
    if (i >= 0 && list[i].role === 'admin' && role !== 'admin' && list.filter((x) => x.role === 'admin').length === 1) { console.error('至少要留一个管理员'); process.exit(1); }
    if (i >= 0) list[i] = a; else list.push(a);
    fs.writeFileSync(file, writeAccounts(list));
    console.log(`✓ ${i >= 0 ? '已重设' : '已新增'} ${a.role === 'admin' ? '管理员' : '普通账户'} ${a.name}。接下来运行 npm run build 再发布。`);
  } else if (cmd === 'remove') {
    const i = list.findIndex((x) => x.name === norm(name));
    if (i < 0) { console.error('没有这个账号'); process.exit(1); }
    if (list[i].role === 'admin' && list.filter((x) => x.role === 'admin').length === 1) { console.error('至少要留一个管理员'); process.exit(1); }
    list.splice(i, 1);
    fs.writeFileSync(file, writeAccounts(list));
    console.log(`✓ 已删除 ${norm(name)}。接下来运行 npm run build 再发布。`);
  } else { console.error('命令只有 list / set / remove'); process.exit(1); }
}
