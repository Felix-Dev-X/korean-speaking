// 手机底部导航、「练习」页、「更多」、输入时隐藏；电脑上用顶部导航
export default async (t) => {
  const p = await t.page('#home', { device: 'iPhone 13' });
  t.check(!(await p.locator('#nav').isVisible()), '手机上不显示顶部横向导航');
  t.check(await p.locator('#tabbar').isVisible(), '手机上显示底部导航');
  const active = async () => (await p.locator('#tabbar a.active span').allInnerTexts()).join(',');
  t.eq(await active(), '今天', '首页高亮「今天」');
  for (const [k, name, hash] of [['units', '课程', '#units'], ['practice', '练习', '#practice'], ['vocab', '单词', '#vocab'], ['review', '复习', '#review']]) {
    await p.locator(`#tabbar a[data-t="${k}"]`).click(); await p.waitForTimeout(200);
    t.eq([await p.evaluate(() => location.hash), await active()], [hash, name], `点「${name}」`);
  }
  await t.go(p, '#scene-s1');
  t.eq(await active(), '练习', '情景页属于「练习」');
  await p.locator('#tabbar .tb-more').click(); await p.waitForSelector('#more-sheet');
  t.check((await p.locator('.sheet-grid a').count()) >= 10, '「更多」里有全部入口');
  await p.locator('.sheet-grid a[href="#prefs"]').click(); await p.waitForTimeout(200);
  t.eq([await p.evaluate(() => location.hash), await p.locator('#more-sheet').count()], ['#prefs', 0], '选了以后关闭「更多」');

  await t.go(p, '#search'); await p.locator('.sq').focus(); await p.waitForTimeout(150);
  t.check(!(await p.locator('#tabbar').isVisible()), '打字时隐藏底部导航');
  await p.locator('.sq').blur(); await p.waitForTimeout(200);
  t.check(await p.locator('#tabbar').isVisible(), '打完字恢复');

  await p.evaluate(() => { window.__kss.state().vocab['가게'] = { due: '2020-01-01', ivl: 1, ease: 2.3, reps: 1, lapses: 0 }; });
  await t.go(p, '#home');
  t.eq(await p.locator('#tabbar a[data-t="vocab"] .tb-badge').innerText(), '1', '「单词」显示到期数');

  // 最后一项不被底部导航挡住
  await t.go(p, '#units');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(150);
  const [last, top] = await p.evaluate(() => { const it = document.querySelectorAll('#app .unit-item'); return [it[it.length - 1].getBoundingClientRect().bottom, document.querySelector('#tabbar').getBoundingClientRect().top]; });
  t.check(last <= top, `最后一项被挡住（${Math.round(last)} > ${Math.round(top)}）`);

  const d = await t.page('#practice', { ctx: { viewport: { width: 1200, height: 800 } } });
  t.check(await d.locator('#nav').isVisible() && !(await d.locator('#tabbar').isVisible()), '电脑上用顶部导航');
  t.eq(await d.locator('.hub-item').count(), 7, '练习页 7 个入口');
};
