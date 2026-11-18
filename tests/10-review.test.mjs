// 复习句子：全屏专注模式（按钮固定在底部、三个阶段、键盘操作、记分）
export default async (t) => {
  const d = (n) => Math.round(Date.now() / 864e5) + n;
  // 三张到期卡：reps 0 → ① 跟读，reps 1 → ② 回想，reps 4 → ③ 实战
  const seed = { srs: { 'u01-c0': [d(-1), 0, 230, 0, 0], 'u01-c1': [d(-1), 3, 230, 1, 0], 'u01-c2': [d(-1), 10, 250, 4, 0] }, settings: {} };
  const p = await t.page('#review', { device: 'iPhone 13', seed });
  t.eq(await p.locator('.vf').count(), 0, '复习页先显示「开始复习」，不直接进入');
  t.check(/3/.test(await p.locator('.review-start .v-plan-n b').innerText()), '显示到期 3 张');
  await p.locator('.rv-start').click();
  t.check(await p.locator('.vf').isVisible(), '点开始进入全屏');
  const inView = (sel) => p.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }, sel);
  const seenStages = new Set();
  for (let i = 0; i < 3; i++) {
    const id = await p.locator('.vf').getAttribute('data-id');
    const stage = await p.locator('.stage-tag').innerText();
    seenStages.add(stage.slice(0, 1));
    if (await p.locator('.vf-foot .show').isVisible()) {
      t.check(await inView('.vf-foot .show'), `「显示答案」在屏幕内（${stage}）`);
      await p.locator('.vf-foot .show').click();
    }
    t.check(await inView('.vf-rate .r2') && await inView('.vf-rate .r0'), `评分按钮在屏幕内（${stage}）`);
    t.check(await p.locator('.vf-body .answer').isVisible() || /跟读/.test(stage), '显示答案后能看到韩语');
    await p.locator('.vf-rate .r2').click(); await p.waitForTimeout(150);
    const c = await p.evaluate((id) => window.__kss.state().srs[id], id);
    t.check(c && c.due > new Date().toISOString().slice(0, 10), `「秒出」后 ${id} 推迟复习`);
  }
  t.eq([...seenStages].sort(), ['①', '②', '③'], '三个阶段都出现');
  t.check(/复习了 3 张/.test(await p.locator('.vf-body').innerText()), '完成页');
  t.eq(await p.evaluate(() => [scrollY, getComputedStyle(document.body).overflow]), [0, 'hidden'], '复习时页面不滚动');
  await p.locator('.rv-back').click(); await p.waitForTimeout(200);
  t.eq(await p.locator('.vf').count(), 0, '回到复习页后关闭全屏');
  t.check(/今天没有到期/.test(await p.locator('#app').innerText()), '复习完后没有到期卡片');

  // 自由加练：直接进入，不改变复习时间
  await t.go(p, '#review-free');
  t.check(await p.locator('.vf').isVisible(), '自由加练直接进入全屏');
  const before = await p.evaluate(() => JSON.stringify(window.__kss.state().srs));
  // 键盘：空格显示答案，1 = 忘了（忘了的卡会再出现一次）
  await p.keyboard.press('Space'); await p.keyboard.press('Digit3'); await p.waitForTimeout(150);
  t.check((await p.locator('.vf-count').innerText()).startsWith('2 /'), '键盘：空格显示答案、数字评分');
  t.eq(await p.evaluate(() => JSON.stringify(window.__kss.state().srs)), before, '自由加练不改变复习时间');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  t.check(/加练了 1 张/.test(await p.locator('.vf-body').innerText()), 'Esc 结束显示完成页');
  // 切到别的页面：全屏自动关闭
  await t.go(p, '#home');
  t.eq([await p.locator('.vf').count(), await p.evaluate(() => document.body.classList.contains('vf-open'))], [0, false], '切页面后全屏关闭');
};
