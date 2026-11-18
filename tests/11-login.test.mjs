// 登录门：没登录看不到内容；输错不能进；输对能进；记住设备；退出登录。
// 用测试专用账号（覆盖 gate.js 里的配置），不需要真正的密码。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, AUTH, artifactFile } from './lib.mjs';

export default async (t) => {
  // 真实配置：只有摘要，没有明文
  const gate = fs.readFileSync(path.join(ROOT, 'app', 'gate.js'), 'utf8');
  t.check(/^[0-9a-f]{64}$/.test(AUTH || ''), 'gate.js 里有 64 位的密码摘要');
  t.check(/iter: (\d+)/.test(gate) && +gate.match(/iter: (\d+)/)[1] >= 100000, 'PBKDF2 迭代次数 ≥ 10 万');

  const salt = 'test-salt-0001', iter = 1000, user = 'Tester', pass = 'right-pass-123';
  const hash = crypto.pbkdf2Sync(user.toLowerCase() + '\n' + pass, salt, iter, 32, 'sha256').toString('hex');
  const override = { fn: (c) => { window.KSS_GATE_OVERRIDE = c; }, arg: { salt, iter, hash } };

  for (const [name, url] of [['GitHub 版', null], ['claude.ai 版', artifactFile()]]) {
    const ctx = await t.context({ device: 'iPhone 13', noAuth: true, init: override });
    const p = await t.page('#home', { context: ctx, noAuth: true, url });
    await p.waitForSelector('#gate');
    t.check(await p.locator('#gate').isVisible(), `${name}：没登录时显示登录框`);
    t.check(!(await p.locator('#app').isVisible()) && !(await p.locator('.hdr').isVisible()), `${name}：没登录时看不到内容`);
    // 输错
    await p.fill('#gate-user', user); await p.fill('#gate-pass', 'wrong-pass');
    await p.locator('.gate-go').click(); await p.waitForTimeout(400);
    t.check(/账号或密码不对/.test(await p.locator('.gate-err').innerText()), `${name}：密码错误提示`);
    t.check(!(await p.locator('#app').isVisible()), `${name}：密码错误进不去`);
    await p.fill('#gate-user', 'someone'); await p.fill('#gate-pass', pass);
    await p.locator('.gate-go').click(); await p.waitForTimeout(400);
    t.check(/账号或密码不对/.test(await p.locator('.gate-err').innerText()), `${name}：账号错误也进不去`);
    // 输对（账号不分大小写）
    await p.fill('#gate-user', ' tester '); await p.fill('#gate-pass', pass);
    await p.locator('.gate-go').click();
    await p.waitForSelector('.hero', { timeout: 5000 });
    t.check(!(await p.locator('#gate').count()) && await p.locator('#app').isVisible(), `${name}：登录后能进`);
    // 记住这台设备：重新打开不用再登录
    await p.reload(); await p.waitForTimeout(400);
    t.check(await p.locator('.hero').isVisible() && !(await p.locator('#gate').count()), `${name}：重新打开不用再登录`);
    // 退出登录
    await t.go(p, '#prefs');
    await p.locator('.logout').click(); await p.locator('.confirm-box .ok').click();
    await p.waitForSelector('#gate', { timeout: 5000 });
    t.check(!(await p.locator('#app').isVisible()), `${name}：退出登录后又要登录`);
  }

  // 不勾「记住这台设备」：只在这次打开有效
  const ctx = await t.context({ noAuth: true, init: override });
  const p = await t.page('#home', { context: ctx, noAuth: true });
  await p.waitForSelector('#gate');
  await p.fill('#gate-user', user); await p.fill('#gate-pass', pass); await p.locator('#gate-remember').uncheck();
  await p.locator('.gate-go').click(); await p.waitForSelector('.hero');
  t.eq(await p.evaluate(() => [localStorage.getItem('kss-auth'), !!sessionStorage.getItem('kss-auth')]), [null, true], '不记住时只存在这次会话');

  // 连错 5 次要等 30 秒
  const q = await t.page('#home', { context: await t.context({ noAuth: true, init: override }), noAuth: true });
  await q.waitForSelector('#gate');
  for (let i = 0; i < 6; i++) { await q.fill('#gate-user', user); await q.fill('#gate-pass', 'bad' + i); await q.locator('.gate-go').click(); await q.waitForTimeout(150); }
  t.check(/秒后再试/.test(await q.locator('.gate-err').innerText()), '连错 5 次后要等一会儿');

  // ── 设置里修改密码：用 GitHub 令牌把新摘要提交到仓库（这里模拟 GitHub 接口） ──
  const gateSrc = fs.readFileSync(path.join(ROOT, 'app', 'gate.js'), 'utf8');
  let putBody = null, authHeader = '';
  const c2 = await t.context({ noAuth: true, init: override });
  await c2.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    authHeader = req.headers().authorization || '';
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'abc123', content: Buffer.from(gateSrc).toString('base64') }) });
    putBody = JSON.parse(req.postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const s = await t.page('#prefs', { context: c2, noAuth: true });
  await s.waitForSelector('#gate'); await s.fill('#gate-user', user); await s.fill('#gate-pass', pass); await s.locator('.gate-go').click();
  await s.waitForSelector('.account'); await s.locator('.pw-change > summary').click();
  const fillPw = async (o, n1, n2, tok) => { await s.fill('.pw-user', user); await s.fill('.pw-old', o); await s.fill('.pw-new', n1); await s.fill('.pw-new2', n2); if (tok != null && await s.locator('.gh-token').count()) await s.fill('.gh-token', tok); await s.locator('.pw-go').click(); await s.waitForTimeout(500); return s.locator('.pw-msg').innerText(); };
  t.check(/不一样/.test(await fillPw(pass, 'new-pass-456', 'new-pass-457', 'tok')), '两次新密码不一样时提示');
  t.check(/至少 8 位/.test(await fillPw(pass, 'short', 'short', 'tok')), '新密码太短时提示');
  t.check(/当前密码不对/.test(await fillPw('wrong-old-pass', 'new-pass-456', 'new-pass-456', 'tok')), '当前密码不对时不能改');
  t.eq(putBody, null, '验证没通过时不提交');
  const ok = await fillPw(pass, 'new-pass-456', 'new-pass-456', 'github_pat_test');
  t.check(/已保存到网站仓库/.test(ok), '修改成功提示：' + ok);
  t.eq(authHeader, 'Bearer github_pat_test', '用令牌访问 GitHub');
  const newSrc = putBody ? Buffer.from(putBody.content, 'base64').toString('utf8') : '';
  const m = newSrc.match(/var CONFIG = \{ salt: '([0-9a-f]+)', iter: (\d+), hash: '([0-9a-f]{64})' \};/);
  t.check(m && putBody.sha === 'abc123', '提交的是更新了 CONFIG 的 gate.js');
  if (m) t.eq(crypto.pbkdf2Sync(user.toLowerCase() + '\n' + 'new-pass-456', m[1], +m[2], 32, 'sha256').toString('hex'), m[3], '新摘要对应新密码（换了新的盐）');
  t.check(newSrc.replace(/var CONFIG = \{[^}]*\};/, '') === gateSrc.replace(/var CONFIG = \{[^}]*\};/, ''), 'gate.js 其他内容没变（中文注释没有乱码）');
  t.check(!newSrc.includes('new-pass-456'), '提交的文件里没有明文密码');
  t.check(await s.evaluate(() => localStorage.getItem('kss-gh-token')) === 'github_pat_test', '记住令牌');
};
