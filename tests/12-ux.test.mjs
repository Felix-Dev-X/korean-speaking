// 人性化：撤销上一个、中断后接着练、一键继续上次、慢速重听、新手引导
export default async (t) => {
  const today = new Date().toISOString().slice(0, 10);

  // ── 撤销（背单词）──
  const p = await t.page('#vocab', { device: 'iPhone 13' });
  await p.waitForSelector('.v-modes'); await p.locator('.v-modes .chip[data-m="card"]').click();
  await p.locator('.v-start').click();
  t.check(!(await p.locator('.vf-undo').isVisible()), '还没做时没有「撤销」');
  const k1 = await p.locator('.vf').getAttribute('data-ko');
  await p.locator('.v-flip').click(); await p.locator('.vf-rate .r0').click(); await p.waitForTimeout(100);
  t.check(await p.locator('.vf-undo').isVisible(), '评分后出现「撤销」');
  t.check(await p.evaluate((k) => !!window.__kss.state().vocab[k], k1), '评分已记录');
  await p.locator('.vf-undo').click(); await p.waitForTimeout(150);
  t.eq(await p.locator('.vf').getAttribute('data-ko'), k1, '撤销后回到上一个词');
  t.check((await p.locator('.vf-count').innerText()).startsWith('1 /'), '撤销后进度回退');
  t.check(await p.evaluate((k) => !window.__kss.state().vocab[k], k1), '撤销后记录恢复（还是新词）');
  t.eq(await p.evaluate((d) => window.__kss.state().vocabNew[d] || 0, today), 0, '撤销后今天新词数也恢复');
  // 标熟练也能撤销；键盘 Z
  await p.locator('.vf-known').click(); await p.waitForTimeout(100);
  t.check(await p.evaluate((k) => (window.__kss.state().vocab[k] || {}).ivl >= 90, k1), '标熟练');
  await p.keyboard.press('z'); await p.waitForTimeout(150);
  t.check(await p.evaluate((k) => !window.__kss.state().vocab[k], k1) && (await p.locator('.vf').getAttribute('data-ko')) === k1, '键盘 Z 撤销标熟练');

  // ── 中断后接着练（背单词）──
  await p.locator('.v-flip').click(); await p.locator('.vf-rate .r2').click(); await p.waitForTimeout(80);
  await p.locator('.v-flip').click(); await p.locator('.vf-rate .r2').click(); await p.waitForTimeout(80);
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('kss-v1-resume-v')).queue.length);
  const nextKo = await p.locator('.vf').getAttribute('data-ko');
  await t.go(p, '#home');   // 中途离开（来电话、切页面……）
  t.eq(await p.locator('.vf').count(), 0, '离开后全屏关闭');
  const rc = await p.locator('.resume-card').innerText();
  t.check(new RegExp(`还剩 ${left} 个`).test(rc), '首页提示「单词没背完：还剩 N 个」：' + rc.replace(/\n/g, ' '));
  await p.reload(); await p.waitForSelector('.hero');
  t.check(await p.locator('.resume-card').isVisible(), '刷新后也还在');
  await p.locator('.rs-v').click(); await p.waitForSelector('.vf');
  t.eq(await p.locator('.vf').getAttribute('data-ko'), nextKo, '继续：从没背完的那个词开始');
  t.check((await p.locator('.vf-count').innerText()).startsWith('3 /'), '继续：进度接着算');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  t.check(await p.evaluate(() => !localStorage.getItem('kss-v1-resume-v')), '主动结束后不再提示继续');
  await p.locator('.v-back').click(); await t.go(p, '#home');
  t.eq(await p.locator('.resume-card').count(), 0, '首页不再显示');

  // ── 撤销 + 接着练（复习句子）──
  const d = (n) => Math.round(Date.now() / 864e5) + n;
  const seed = { srs: { 'u01-c0': [d(-1), 3, 230, 1, 0], 'u01-c1': [d(-1), 3, 230, 1, 0], 'u01-c2': [d(-1), 3, 230, 1, 0] }, settings: {} };
  const r = await t.page('#review', { device: 'iPhone 13', seed });
  await r.locator('.rv-start').click();
  const id1 = await r.locator('.vf').getAttribute('data-id');
  const before = await r.evaluate((id) => JSON.stringify(window.__kss.state().srs[id]), id1);
  await r.locator('.vf-foot .show').click(); await r.locator('.vf-rate .r2').click(); await r.waitForTimeout(100);
  await r.locator('.vf-undo').click(); await r.waitForTimeout(150);
  t.eq(await r.locator('.vf').getAttribute('data-id'), id1, '复习：撤销回到上一张');
  t.eq(await r.evaluate((id) => JSON.stringify(window.__kss.state().srs[id]), id1), before, '复习：撤销后复习记录恢复');
  await r.locator('.vf-foot .show').click(); await r.locator('.vf-rate .r2').click(); await r.waitForTimeout(100);
  await t.go(r, '#home');
  t.check(/复习没做完：还剩 2 张/.test(await r.locator('.resume-card').innerText()), '复习：首页提示还剩 2 张');
  await r.locator('.rs-r').click(); await r.waitForSelector('.vf');
  t.check((await r.locator('.vf-count').innerText()).startsWith('2 / 3'), '复习：接着练');

  // ── 一键继续上次 ──
  const c = await t.page('#unit-u05');
  await t.go(c, '#scene-s3'); await t.go(c, '#unit-u05'); await t.go(c, '#home');
  const cont = c.locator('.continue-btn');
  t.check(await cont.isVisible() && /继续上次：第 \d+ 课/.test(await cont.innerText()), '首页「继续上次」显示最近打开的课');
  await cont.click(); await c.waitForTimeout(150);
  t.eq(await c.evaluate(() => location.hash), '#unit-u05', '点了回到那一课');

  // ── 慢速重听：▶ 再点一下 = 慢速 ──
  await c.evaluate(() => { window.__rates = []; const orig = window.speechSynthesis.speak; window.speechSynthesis.speak = (u) => { window.__rates.push(u.rate); orig.call(window.speechSynthesis, u); }; });
  const play = c.locator('.tab-body button.icon[title*="慢速"]').first();
  await play.click(); await c.waitForTimeout(100); await play.click(); await c.waitForTimeout(100);
  const rates = await c.evaluate(() => window.__rates);
  t.check(rates.length >= 2 && rates[rates.length - 1] < rates[rates.length - 2] * 0.8, '第二次点 ▶ 用慢速：' + JSON.stringify(rates));
  t.check(/🐢/.test(await play.innerText()), '按钮短暂变成 🐢');

  // ── 新手引导：新账号第一次打开 ──
  const o = await t.page('#home', { device: 'iPhone 13', onboarding: true });
  await o.waitForSelector('.vf', { timeout: 5000 });
  t.check(/欢迎来练韩语口语/.test(await o.locator('.vf-body').innerText()), '新用户第一次打开显示新手引导');
  await o.waitForFunction(() => !!window.KSS.vocabNikl, null, { timeout: 15000 }); await o.waitForTimeout(300);
  t.check(await o.locator('.vf').isVisible(), '后台词库加载完不会关掉正在进行的全屏界面');
  await o.locator('.ob-next').click();
  t.check(await o.locator('.ob-play').isVisible(), '第 2 步：听发音');
  await o.locator('.ob-no').click();
  t.check(await o.locator('.ob-help').isVisible(), '没声音时给出排查办法');
  await o.locator('.ob-yes').click();
  t.check(await o.locator('.vf-body .slot .check, .vf-body .slot > *').count() > 0, '第 3 步：试说话（带 🎤）');
  await o.locator('.ob-skip2').click();
  await o.locator('.ob-start').click(); await o.waitForTimeout(200);
  t.eq([await o.locator('.vf').count(), await o.evaluate(() => location.hash)], [0, '#day-1'], '引导结束后开始第 1 天');
  await o.reload(); await o.waitForTimeout(800);
  t.eq(await o.locator('.vf').count(), 0, '看过引导后不再自动弹出');
  await t.go(o, '#prefs'); await o.locator('.ob-again').click();
  t.check(await o.locator('.vf').isVisible(), '设置里可以重新打开引导');
  // 已经有学习记录的老用户不弹
  const old = await t.page('#home', { onboarding: true, seed: { log: { [today]: { sec: 60, reps: 3 } }, settings: {} } });
  await old.waitForTimeout(800);
  t.eq(await old.locator('.vf').count(), 0, '已有学习记录的不弹引导');
};
