// 登录门和账号：没登录看不到内容；输错不能进；管理员 / 普通账户的区别（AI 陪练）；进度按账号分开；
// 记住设备；退出登录；管理员改密码、增删账号（模拟 GitHub 接口）。用测试专用账号，不需要真正的密码。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, AUTH, artifactFile, gateAccounts } from './lib.mjs';

const mk = (name, pass, role, iter = 1000) => {
  const salt = 'salt-' + name;
  return { name, role, salt, iter, hash: crypto.pbkdf2Sync(name + '\n' + pass, salt, iter, 32, 'sha256').toString('hex') };
};

export default async (t) => {
  // 真实配置：只有摘要，没有明文；至少一个管理员
  const real = gateAccounts();
  t.check(/^[0-9a-f]{64}$/.test(AUTH || ''), 'gate.js 里有管理员的密码摘要');
  t.check(real.length >= 1 && real.every((a) => /^[0-9a-f]{64}$/.test(a.hash) && a.iter >= 100000 && /^[0-9a-f]{32}$/.test(a.salt) && ['admin', 'user'].includes(a.role)), '每个账号都有摘要、随机盐、≥10 万次迭代、角色');
  t.check(new Set(real.map((a) => a.salt)).size === real.length, '每个账号的盐都不一样');

  const ACC = [mk('tester', 'right-pass-123', 'admin'), mk('stu', 'stu-pass-456', 'user'), mk('stu2', 'stu2-pass-789', 'user')];
  const override = { fn: (c) => { window.KSS_GATE_OVERRIDE = c; }, arg: ACC };
  const login = async (p, u, pw) => { await p.waitForSelector('#gate'); await p.fill('#gate-user', u); await p.fill('#gate-pass', pw); await p.locator('.gate-go').click(); };

  for (const [name, url] of [['GitHub 版', null], ['claude.ai 版', artifactFile()]]) {
    const ctx = await t.context({ device: 'iPhone 13', noAuth: true, init: override });
    const p = await t.page('#home', { context: ctx, noAuth: true, url });
    await p.waitForSelector('#gate');
    t.check(await p.locator('#gate').isVisible(), `${name}：没登录时显示登录框`);
    t.check(!(await p.locator('#app').isVisible()) && !(await p.locator('.hdr').isVisible()), `${name}：没登录时看不到内容`);
    await login(p, 'Tester', 'wrong-pass'); await p.waitForTimeout(300);
    t.check(/账号或密码不对/.test(await p.locator('.gate-err').innerText()), `${name}：密码错误提示`);
    await login(p, 'nobody', 'right-pass-123'); await p.waitForTimeout(300);
    t.check(/账号或密码不对/.test(await p.locator('.gate-err').innerText()), `${name}：账号不存在也进不去`);
    await login(p, 'stu', 'right-pass-123'); await p.waitForTimeout(300);
    t.check(/账号或密码不对/.test(await p.locator('.gate-err').innerText()), `${name}：别的账号的密码不能用`);
    // 管理员（账号不分大小写）
    await login(p, ' Tester ', 'right-pass-123');
    await p.waitForSelector('.hero', { timeout: 15000 });
    t.check(!(await p.locator('#gate').count()), `${name}：管理员登录后能进`);
    await t.go(p, '#ai');
    t.check(!(await p.locator('.ai-lock').count()), `${name}：管理员能用 AI 陪练`);
    await p.reload(); await p.waitForSelector('#app > div', { state: 'attached' }); await p.waitForTimeout(300);
    t.check(!(await p.locator('#gate').count()), `${name}：重新打开不用再登录`);
    await t.go(p, '#prefs');
    t.check(/当前登录：tester（管理员）/.test(await p.locator('.account').innerText()), `${name}：设置里显示当前账号`);
    await p.locator('.logout').click(); await p.locator('.confirm-box .ok').click();
    await p.waitForSelector('#gate', { timeout: 15000 });
    t.check(!(await p.locator('#app').isVisible()), `${name}：退出登录后又要登录`);
    // 普通账户
    await login(p, 'stu', 'stu-pass-456');
    await p.waitForSelector('.account', { timeout: 15000 });   // 刚才停在设置页
    await t.go(p, '#ai');
    t.check(await p.locator('.ai-lock').isVisible(), `${name}：普通账户打开 AI 陪练显示「只对管理员开放」`);
    await t.go(p, '#ai-s1');
    t.check(await p.locator('.ai-lock').isVisible(), `${name}：普通账户也不能直接打开 AI 对话`);
    await t.go(p, '#practice');
    t.check(!(await p.locator('.hub-item[href="#ai"]').count()), `${name}：普通账户的练习页没有 AI 陪练`);
    await t.go(p, '#unit-u01'); await p.click('.tab[data-k="mission"]'); await p.waitForTimeout(150);
    t.eq(await p.locator('.ai-grade:visible, .copy-grade:visible').count(), 0, `${name}：普通账户没有 AI 批改`);
    await t.go(p, '#prefs');
    t.check(/普通账户/.test(await p.locator('.account').innerText()) && !(await p.locator('.acct-mgr').count()), `${name}：普通账户不能管理账号`);
    t.check(!(await p.locator('#api-key').count()), `${name}：普通账户没有 API Key 设置`);
  }

  // 电脑上：普通账户的顶部导航没有 AI 陪练
  const d = await t.page('#home', { context: await t.context({ noAuth: true, init: override, ctx: { viewport: { width: 1200, height: 800 } } }), noAuth: true });
  await login(d, 'stu', 'stu-pass-456'); await d.waitForSelector('.hero');
  t.check(!(await d.locator('#nav a[data-r="ai"]').isVisible()) && await d.locator('#nav a[data-r="vocab"]').isVisible(), '普通账户的顶部导航没有 AI 陪练');

  // 进度按账号分开：同一台设备上 stu 学的词，stu2 和管理员看不到
  const c3 = await t.context({ noAuth: true, init: override });
  const e = await t.page('#vocab', { context: c3, noAuth: true });
  await login(e, 'stu', 'stu-pass-456'); await e.waitForSelector('.v-item');
  await e.locator('.v-item .v-main').first().click(); await e.locator('.v-detail .r2').click();
  const stuWords = await e.evaluate(() => Object.keys(window.__kss.state().vocab).length);
  t.eq(stuWords, 1, 'stu 学了 1 个词');
  t.check(await e.evaluate(() => !!localStorage.getItem('kss-v1-stu') && !localStorage.getItem('kss-v1')), '普通账户的进度存在自己的位置');
  await e.evaluate(() => window.KSS_GATE.logout()); await login(e, 'stu2', 'stu2-pass-789'); await e.waitForSelector('#app > div', { state: 'attached' }); await e.waitForTimeout(400);
  t.eq(await e.evaluate(() => Object.keys(window.__kss.state().vocab).length), 0, 'stu2 看不到 stu 的进度');
  await e.evaluate(() => window.KSS_GATE.logout()); await login(e, 'stu', 'stu-pass-456'); await e.waitForSelector('#app > div', { state: 'attached' }); await e.waitForTimeout(400);
  t.eq(await e.evaluate(() => Object.keys(window.__kss.state().vocab).length), 1, 'stu 重新登录后进度还在');

  // 不勾「记住这台设备」：只在这次打开有效
  const f = await t.page('#home', { context: await t.context({ noAuth: true, init: override }), noAuth: true });
  await f.waitForSelector('#gate'); await f.fill('#gate-user', 'stu'); await f.fill('#gate-pass', 'stu-pass-456'); await f.locator('#gate-remember').uncheck();
  await f.locator('.gate-go').click(); await f.waitForSelector('.hero');
  t.eq(await f.evaluate(() => [localStorage.getItem('kss-auth'), !!sessionStorage.getItem('kss-auth')]), [null, true], '不记住时只存在这次会话');

  // 连错 5 次要等 30 秒
  const q = await t.page('#home', { context: await t.context({ noAuth: true, init: override }), noAuth: true });
  await q.waitForSelector('#gate');
  for (let i = 0; i < 6; i++) { await q.fill('#gate-user', 'tester'); await q.fill('#gate-pass', 'bad' + i); await q.locator('.gate-go').click(); await q.waitForTimeout(150); }
  t.check(/秒后再试/.test(await q.locator('.gate-err').innerText()), '连错 5 次后要等一会儿');

  // ── 管理员：改密码、增删账号（模拟 GitHub 接口，仓库里的 gate.js 用测试账号列表） ──
  const gateSrc = fs.readFileSync(path.join(ROOT, 'app', 'gate.js'), 'utf8')
    .replace(/var ACCOUNTS = \[[\s\S]*?\n  \];/, 'var ACCOUNTS = [\n' + ACC.map((a) => '    ' + JSON.stringify(a)).join(',\n') + '\n  ];');
  let repo = gateSrc, puts = [], authHeader = '';
  const c2 = await t.context({ noAuth: true, init: override });
  await c2.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    authHeader = req.headers().authorization || '';
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'sha' + puts.length, content: Buffer.from(repo).toString('base64') }) });
    const body = JSON.parse(req.postData()); puts.push(body); repo = Buffer.from(body.content, 'base64').toString('utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const repoAccts = () => JSON.parse(repo.match(/var ACCOUNTS = (\[[\s\S]*?\n  \]);/)[1]);
  const okHash = (a, pw) => a && crypto.pbkdf2Sync(a.name + '\n' + pw, a.salt, a.iter, 32, 'sha256').toString('hex') === a.hash;
  const s = await t.page('#prefs', { context: c2, noAuth: true });
  await login(s, 'tester', 'right-pass-123'); await s.waitForSelector('.account');
  t.eq(await s.locator('.acct-row').count(), 3, '账号管理列出全部账号');
  await s.fill('.gh-token', 'github_pat_test');
  // 修改我的密码
  await s.locator('.pw-change > summary').click();
  const pw = async (o, n1, n2) => { await s.fill('.pw-old', o); await s.fill('.pw-new', n1); await s.fill('.pw-new2', n2); await s.locator('.pw-go').click(); await s.waitForTimeout(500); return s.locator('.pw-msg').innerText(); };
  t.check(/不一样/.test(await pw('right-pass-123', 'new-pass-456', 'new-pass-457')), '两次新密码不一样时提示');
  t.check(/至少 8 位/.test(await pw('right-pass-123', 'short', 'short')), '新密码太短时提示');
  t.check(/当前密码不对/.test(await pw('wrong-old-pass', 'new-pass-456', 'new-pass-456')), '当前密码不对时不能改');
  t.eq(puts.length, 0, '验证没通过时不提交');
  t.check(/已保存到网站仓库/.test(await pw('right-pass-123', 'new-pass-456', 'new-pass-456')), '改密码成功');
  t.eq(authHeader, 'Bearer github_pat_test', '用令牌访问 GitHub');
  let ra = repoAccts();
  t.check(okHash(ra.find((a) => a.name === 'tester'), 'new-pass-456') && ra.find((a) => a.name === 'tester').salt !== 'salt-tester', '新摘要对应新密码（换了新的盐）');
  t.check(okHash(ra.find((a) => a.name === 'stu'), 'stu-pass-456'), '改自己的密码不影响别的账号');
  t.check(repo.replace(/var ACCOUNTS = \[[\s\S]*?\n  \];/, '') === gateSrc.replace(/var ACCOUNTS = \[[\s\S]*?\n  \];/, ''), 'gate.js 其他内容没变（中文注释没有乱码）');
  t.check(!repo.includes('new-pass-456'), '提交的文件里没有明文密码');
  t.check(await s.evaluate(() => localStorage.getItem('kss-gh-token')) === 'github_pat_test', '记住令牌');
  // 新增普通账户
  await s.locator('.acct-mgr > summary').click();
  await s.fill('.ac-name', 'Newbie'); await s.locator('.ac-rand').click();
  const np = await s.locator('.ac-pass').inputValue();
  t.check(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(np), '随机生成密码：' + np);
  await s.locator('.ac-go').click(); await s.waitForTimeout(500);
  ra = repoAccts();
  t.check(okHash(ra.find((a) => a.name === 'newbie' && a.role === 'user'), np), '新增普通账户（账号统一小写）');
  t.check((await s.locator('.ac-msg').innerText()).includes(np), '新增后显示密码，方便发给对方');
  t.eq(await s.locator('.acct-row').count(), 4, '列表更新');
  // 重设别人的密码
  await s.locator('.acct-row[data-name="stu"] .acct-reset').click();
  await s.fill('.ac-pass', 'stu-new-pass-1'); await s.locator('.ac-go').click(); await s.waitForTimeout(500);
  t.check(okHash(repoAccts().find((a) => a.name === 'stu' && a.role === 'user'), 'stu-new-pass-1'), '重设普通账户密码（类型不变）');
  // 删除
  await s.locator('.acct-row[data-name="stu2"] .acct-del').click(); await s.locator('.confirm-box .ok').click(); await s.waitForTimeout(500);
  t.check(!repoAccts().some((a) => a.name === 'stu2'), '删除账号');
  t.eq(await s.locator('.acct-row[data-name="tester"] .acct-del').count(), 0, '不能删除自己');
  const before = puts.length;
  await s.fill('.ac-name', 'tester'); await s.fill('.ac-pass', 'whatever-123'); await s.selectOption('.ac-role', 'user'); await s.locator('.ac-go').click(); await s.waitForTimeout(300);
  t.check(/不能把自己改成普通账户/.test(await s.locator('.ac-msg').innerText()) && puts.length === before, '不能把自己降成普通账户');
  await s.fill('.ac-name', 'x'); await s.selectOption('.ac-role', 'user'); await s.locator('.ac-go').click(); await s.waitForTimeout(200);
  t.check(/2–32 位/.test(await s.locator('.ac-msg').innerText()), '账号格式不对时提示');
};
