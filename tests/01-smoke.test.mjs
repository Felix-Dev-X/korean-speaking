// 全站巡检：每一课、每一天、每个情景/短文/百问/听力页面都打开一遍，
// 检查：没有脚本错误、页面不是空的、手机宽度下没有横向溢出。FAST=1 时每类只抽几个。
export default async (t) => {
  const p = await t.page('#home');
  const ids = await p.evaluate(() => ({
    units: window.__kss.UNITS.map((u) => u.id), scenes: window.__kss.SCENES.map((s) => s.id),
    passages: (window.KSS.shadowing || []).map((x) => x.id), qa: (window.KSS.qa || []).length, days: window.__kss.TOTAL_DAYS,
    listening: (window.KSS.listening || []).map((x) => x.id),
  }));
  const pick = (arr) => (t.fast ? arr.filter((_, i) => i % Math.ceil(arr.length / 6) === 0) : arr);
  const over = [], empty = [];
  const visit = async (hash, extra) => {
    await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(50);
    const r = await p.evaluate(() => ({ ow: document.documentElement.scrollWidth - window.innerWidth, txt: document.querySelector('#app').innerText }));
    if (r.ow > 0) over.push(`${hash} 宽出 ${r.ow}px`);
    if (r.txt.length < 40 || /找不到这个页面|这个页面出错了/.test(r.txt)) empty.push(hash);
    if (extra) await extra();
  };
  for (const id of pick(ids.units)) {
    await visit('#unit-' + id, async () => {
      for (const k of ['chunks', 'dialogue', 'drill', 'mission']) {
        await p.click(`.tab[data-k="${k}"]`); await p.waitForTimeout(20);
        const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (ow > 0) over.push(`${id}/${k} 宽出 ${ow}px`);
      }
    });
  }
  for (const d of pick([...Array(ids.days).keys()].map((i) => i + 1))) await visit('#day-' + d);
  for (const id of pick(ids.scenes)) await visit('#scene-' + id);
  for (const id of pick(ids.passages)) await visit('#shadow-' + id);
  for (const i of pick([...Array(ids.qa).keys()])) await visit('#qa-' + i);
  for (const id of pick(ids.listening)) await visit('#drills-comp-' + id);
  for (const id of pick(ids.units).slice(0, 20)) await visit('#recap-' + id);
  for (let i = 0; i < 12; i++) await visit('#scenes-' + i);
  for (let i = 0; i < 6; i++) await visit('#drills-spoken-' + i);
  for (const h of ['#home', '#units', '#practice', '#scenes', '#phrases', '#shadow', '#qa', '#review', '#review-free', '#review-fav', '#review-all', '#review-favgo',
    '#pron', '#ai', '#prefs', '#drills', '#drills-numbers', '#drills-listen', '#drills-styles', '#drills-replies', '#drills-spoken', '#drills-replies-0', '#drills-comp',
    '#search', '#vocab', '#vocab-u01', '#vocab-u50', '#vocab-u100']) await visit(h);
  t.check(!over.length, '手机宽度下横向溢出：' + over.slice(0, 10).join('，'));
  t.check(!empty.length, '页面空白或出错：' + empty.slice(0, 10).join('，'));
  t.check(ids.units.length === 100 && ids.days === 140, `课程数量不对：${ids.units.length} 课 / ${ids.days} 天`);
};
