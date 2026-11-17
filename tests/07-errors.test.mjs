// 出错时：显示提示条（能复制错误信息），页面渲染出错显示出错卡片，不白屏；设置页显示版本号
export default async (t) => {
  const p = await t.page('#home', { allowErrors: true });
  // 事件里的脚本错误 → 提示条
  await p.evaluate(() => { setTimeout(() => { null.boom(); }, 0); });
  await p.waitForSelector('#err-bar', { timeout: 3000 });
  t.check(/出了点问题/.test(await p.locator('#err-bar').innerText()), '脚本错误显示提示条');
  t.check(await p.locator('#err-bar .err-copy').isVisible(), '有「复制错误信息」按钮');
  const rec = await p.evaluate(() => window.KSS_ERR.recent()[0]);
  t.check(/版本：/.test(rec) && /页面：/.test(rec) && /错误：/.test(rec), '错误报告含版本、页面、错误内容');
  await p.locator('#err-bar .err-x').click();
  t.eq(await p.locator('#err-bar').count(), 0, '提示条能关掉');

  // 网络失败之类的 Promise 拒绝：只记录，不弹提示
  await p.evaluate(() => { Promise.reject(new Error('网络断了')); });
  await p.waitForTimeout(300);
  t.eq(await p.locator('#err-bar').count(), 0, '非程序错误不弹提示');

  // 页面渲染出错 → 出错卡片
  await p.evaluate(() => { const S = window.__kss.state(); S.__saved = S.srs; Object.defineProperty(S, 'srs', { get() { throw new Error('测试：渲染出错'); }, configurable: true }); });
  await t.go(p, '#review');
  t.check(/这个页面出错了/.test(await p.locator('#app').innerText()), '渲染出错显示出错卡片');
  t.check(await p.locator('#app a[href="#home"]').count() > 0, '出错卡片能回首页');
  await p.evaluate(() => { const S = window.__kss.state(); const v = S.__saved; delete S.srs; S.srs = v; delete S.__saved; });

  // 设置页：版本号 + 错误记录
  await t.go(p, '#prefs');
  const about = await p.locator('section:has(h2:text("关于"))').innerText();
  t.check(/版本：[0-9a-f]{8}/.test(about), '设置页显示版本号：' + about.slice(0, 40));
  t.check(/最近有 \d+ 条错误记录/.test(about), '设置页显示错误记录');

  // 数据文件没加载（网络中断等）→ 提示刷新，不白屏
  const ctx = await t.context();
  await ctx.route('**/data/week1-2.js*', (r) => r.abort());
  const q = await ctx.newPage();
  await q.goto(t.base + '#home'); await q.waitForTimeout(800);
  t.check(/没有加载完整/.test(await q.locator('#app').innerText()), '数据缺失时提示刷新');
};
