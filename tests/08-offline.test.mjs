// 离线：第一次打开后，断网也能打开课程、单词
export default async (t) => {
  const ctx = await t.context();
  const p = await t.page('#home', { context: ctx });
  await p.evaluate(() => navigator.serviceWorker.ready);
  // 等离线缓存装好（含 3 MB 词库）
  await p.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; const c = await caches.open(ks[0]); return (await c.keys()).length > 50; }, null, { timeout: 30000, polling: 300 });
  const ver = await p.evaluate(() => document.querySelector('meta[name=app-version]').content);
  t.eq(await p.evaluate(async () => (await caches.keys()).join()), 'kss-' + ver, '缓存名带版本号');

  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('.hero', { timeout: 10000 });
  t.check(true, '断网后首页能打开');
  await t.go(p, '#unit-u01');
  t.check((await p.locator('#app').innerText()).length > 200, '断网后课程能打开');
  await t.go(p, '#vocab'); await p.waitForFunction(() => /15,7\d\d/.test(document.querySelector('.page-title').textContent), null, { timeout: 10000 });
  t.check(true, '断网后完整词库能用');
  await t.go(p, '#prefs');
  t.check(/离线可用：✅/.test(await p.locator('#app').innerText()), '设置页显示离线可用');
  await ctx.setOffline(false);
};
