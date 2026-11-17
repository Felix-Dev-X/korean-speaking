// 单词：词库后台加载、总表筛选联动、全站搜索单词、四种练习方式、词典释义
export default async (t) => {
  // ── 后台加载完整词库 ──
  const p = await t.page('#home');
  t.check(!(await p.evaluate(() => !!window.KSS.vocabNikl)), '首页打开时不加载 3 MB 的基础词典');
  await p.waitForFunction(() => !!window.KSS.vocabNikl, null, { timeout: 15000 });
  await t.go(p, '#vocab'); await p.waitForSelector('.v-item');
  t.check(/15,7\d\d/.test(await p.locator('.page-title').innerText()), '单词总数 1.5 万+');

  // 直接打开单词页：先显示「正在加载」，加载完自动刷新
  const q = await t.page('#vocab');
  await q.waitForFunction(() => !document.querySelector('.v-loading') && /15,7\d\d/.test(document.querySelector('.page-title').textContent), null, { timeout: 15000 });
  t.check(true, '');

  // ── 筛选联动 ──
  const opts = async () => (await p.locator('.v-3 option').allInnerTexts());
  await p.locator('.v-f').selectOption('book'); await p.waitForTimeout(200);
  t.eq((await opts()).slice(0, 4), ['全部等级', '初级', '中级', '高级'], 'TOPIK 书 → 第三项是等级');
  await p.locator('.v-f').selectOption('life'); await p.waitForTimeout(200);
  t.check(/^第 0?1 课/.test((await opts())[1]), '生活常用 → 第三项是课程：' + (await opts())[1]);
  await p.locator('.v-f').selectOption('all'); await p.locator('.v-3').selectOption('1'); await p.waitForTimeout(250);
  const n1 = parseInt((await p.locator('.v-count').innerText()).replace(/,/g, ''), 10);
  t.check(n1 > 2000 && n1 < 6000, '全部 + 初级 数量合理：' + n1);

  // ── 词典释义 / 同形词顺序 ──
  await p.fill('.v-q', '먹다'); await p.locator('.v-3').selectOption(''); await p.waitForTimeout(400);
  await p.locator('.v-item[data-ko="먹다"] .v-main').click();
  const det = await p.locator('.v-item.open .v-detail').innerText();
  t.check(/📖 ① 将食物送进口中/.test(det), '먹다 的词典解释句以「吃」开头');

  // ── 全站搜索单词 ──
  await t.go(p, '#search'); await p.fill('.sq', '病院'); await p.waitForTimeout(500);
  t.check((await p.locator('.s-word b').allInnerTexts()).includes('병원'), '按汉字搜到 병원');
  await p.fill('.sq', '먹다'); await p.waitForTimeout(500);
  t.eq((await p.locator('.s-word b').first().innerText()), '먹다', '完全一样的词排第一');
  await p.locator('.s-wmain').first().click(); await p.waitForTimeout(500);
  t.eq(await p.evaluate(() => location.hash), '#vocab', '点单词跳到单词页');
  t.eq(await p.locator('.v-item.open b').first().innerText(), '먹다', '并展开这个词');

  // ── 练习方式 ──
  const run = async (mode) => {
    await t.go(p, '#home'); await t.go(p, '#vocab'); await p.waitForSelector('.v-modes');
    await p.locator(`.v-modes .chip[data-m="${mode}"]`).click(); await p.locator('.v-start').click();
  };
  await run('choice'); await p.waitForSelector('.v-opt');
  t.eq(await p.locator('.v-opt').count(), 4, '选择题 4 个选项');
  const cur = () => p.locator('.vf').getAttribute('data-ko');
  const zh = await p.evaluate((k) => window.__kss.vocab().find((w) => w.ko === k).zh, await cur());
  const texts = (await p.locator('.v-opt').allInnerTexts()).map((x) => x.replace(/^\d\s*/, ''));
  const right = texts.findIndex((x) => zh.startsWith(x.split('；')[0]));
  t.check(right >= 0, '正确选项在里面');
  t.check(texts.every((x) => !/[가-힣]/.test(x)), '选项里没有韩语提示');
  const leak = await p.evaluate(() => window.__kss.vocab().filter((w) => /[가-힣]/.test(window.__kss.vZhShort(w.zh))).map((w) => w.ko));
  t.check(!leak.length, `${leak.length} 个词的选项会露出韩语：${leak.slice(0, 8).join('、')}`);
  await p.locator('.v-opt').nth(right).click(); await p.waitForTimeout(1200);
  t.check((await p.locator('.vf-count').innerText()).startsWith('2 /'), '答对自动下一个');

  await run('listen'); await p.waitForSelector('.v-opt');
  t.eq(await p.locator('.vf-body .v-front').count(), 0, '听音选义不显示韩语');
  await p.locator('.v-skip').click();
  t.check(/不对/.test(await p.locator('.v-res').innerText()), '不知道 = 答错');

  await run('dict'); await p.waitForSelector('.v-in');
  const ans = await cur();
  await p.fill('.v-in', ans + ' '); await p.press('.v-in', 'Enter'); await p.waitForTimeout(200);
  t.check(/对了/.test(await p.locator('.v-res').innerText()), '听写答对（忽略空格）');
  await p.locator('.v-next').click(); await p.waitForTimeout(200);
  const ans2 = await cur();
  await p.fill('.v-in', ans2.slice(0, -1) + (ans2.endsWith('가') ? '나' : '가')); await p.locator('.v-ok').click(); await p.waitForTimeout(200);
  t.eq(await p.locator('.v-diff mark').count(), 1, '听写标出打错的字');
  await p.locator('.v-typo').click(); await p.waitForTimeout(200);
  t.check(await p.evaluate((k) => { const v = window.__kss.state().vocab[k]; return v && v.lapses === 0 && v.reps === 1; }, ans2), '「只是打错字」算模糊');

  await run('card'); await p.locator('.v-flip').click(); await p.locator('.rate .r2').click();
  t.check((await p.locator('.vf-count').innerText()).startsWith('2 /'), '卡片模式照常');

  // ── 全屏专注模式：按钮固定在屏幕底部、不用滚动页面 ──
  const m = await t.page('#vocab', { device: 'iPhone 13' });
  await m.waitForSelector('.v-modes'); await m.locator('.v-modes .chip[data-m="card"]').click(); await m.locator('.v-start').click();
  const inView = (sel) => m.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, sel);
  t.check(await inView('.v-flip'), '「翻面」按钮在屏幕内');
  await m.locator('.vf-body .v-front').click();   // 点卡片也能翻面
  t.check(await m.locator('.vf-rate').isVisible(), '点卡片翻面');
  for (let i = 0; i < 3; i++) {
    t.check(await inView('.vf-rate .r2') && await inView('.vf-rate .r0'), `第 ${i + 1} 个词：评分按钮在屏幕内`);
    await m.locator('.vf-rate .r2').click(); await m.waitForTimeout(150);
    if (i < 2) await m.locator('.v-flip').click();
  }
  t.eq(await m.evaluate(() => [scrollY, getComputedStyle(document.body).overflow]), [0, 'hidden'], '背词时页面不滚动');
  t.check(!(await m.locator('#tabbar').isVisible()), '背词时隐藏底部导航');
  // 键盘：空格翻面，1/2/3 评分，Esc 结束
  await m.keyboard.press('Space'); await m.keyboard.press('Digit3'); await m.waitForTimeout(150);
  t.check((await m.locator('.vf-count').innerText()).startsWith('5 /'), '键盘：空格翻面、数字评分');
  await m.keyboard.press('Escape'); await m.waitForTimeout(150);
  t.check(/背完了 4 个/.test(await m.locator('.vf-body').innerText()), 'Esc 结束后显示完成页');
  await m.locator('.v-back').click(); await m.waitForTimeout(200);
  t.eq(await m.locator('.vf').count(), 0, '回到单词页后关闭专注模式');
  // 背词中切到别的页面：专注模式自动关闭
  await m.locator('.v-start').click(); await t.go(m, '#home');
  t.eq([await m.locator('.vf').count(), await m.evaluate(() => document.body.classList.contains('vf-open'))], [0, false], '切页面后专注模式关闭');
};
