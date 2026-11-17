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
  const zh = await p.locator('.v-after .v-mean').innerText();
  const texts = await p.locator('.v-opt').allInnerTexts();
  const right = texts.findIndex((x) => zh.startsWith(x.split('；')[0]));
  t.check(right >= 0, '正确选项在里面');
  t.check(texts.every((x) => !/[가-힣]/.test(x)), '选项里没有韩语提示');
  const leak = await p.evaluate(() => window.__kss.vocab().filter((w) => /[가-힣]/.test(window.__kss.vZhShort(w.zh))).map((w) => w.ko));
  t.check(!leak.length, `${leak.length} 个词的选项会露出韩语：${leak.slice(0, 8).join('、')}`);
  await p.locator('.v-opt').nth(right).click(); await p.waitForTimeout(1200);
  t.check((await p.locator('.prog').innerText()).startsWith('2 /'), '答对自动下一个');

  await run('listen'); await p.waitForSelector('.v-opt');
  t.eq(await p.locator('.v-session > .v-front').count(), 0, '听音选义不显示韩语');
  await p.locator('.v-skip').click();
  t.check(/不对/.test(await p.locator('.v-res').innerText()), '不知道 = 答错');

  await run('dict'); await p.waitForSelector('.v-in');
  const ans = await p.locator('.v-after .v-front').innerText();
  await p.fill('.v-in', ans + ' '); await p.press('.v-in', 'Enter'); await p.waitForTimeout(200);
  t.check(/对了/.test(await p.locator('.v-res').innerText()), '听写答对（忽略空格）');
  await p.locator('.v-next').click(); await p.waitForTimeout(200);
  const ans2 = await p.locator('.v-after .v-front').innerText();
  await p.fill('.v-in', ans2.slice(0, -1) + (ans2.endsWith('가') ? '나' : '가')); await p.locator('.v-ok').click(); await p.waitForTimeout(200);
  t.eq(await p.locator('.v-diff mark').count(), 1, '听写标出打错的字');
  await p.locator('.v-typo').click(); await p.waitForTimeout(200);
  t.check(await p.evaluate((k) => { const v = window.__kss.state().vocab[k]; return v && v.lapses === 0 && v.reps === 1; }, ans2), '「只是打错字」算模糊');

  await run('card'); await p.locator('.v-flip').click(); await p.locator('.rate .r2').click();
  t.check((await p.locator('.prog').innerText()).startsWith('2 /'), '卡片模式照常');
};
