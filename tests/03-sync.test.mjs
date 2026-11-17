// claude.ai 网页版的云同步：两台"设备"共用一个模拟的云端，进度合并、不互相覆盖
import { artifactFile } from './lib.mjs';

export default async (t) => {
  const url = artifactFile();
  let cloud = null, writes = 0;
  const td = new Date().toISOString().slice(0, 10);
  const device = async (seed) => {
    const ctx = await t.context({ seed, init: { fn: () => {
      window.claude = { use: async (n) => (n === 'db' ? { doc: () => ({ get: async () => { const j = await window.__cloudGet(); return { exists: !!j, data: () => j }; }, set: (v) => window.__cloudSet(v) }) }
        : n === 'user' ? { id: async () => 'u1' } : n === 'downloads' ? { save: async () => ({ status: 'saved' }) } : {}) };
    } } });
    await ctx.exposeFunction('__cloudGet', () => cloud);
    await ctx.exposeFunction('__cloudSet', (v) => { cloud = v; writes++; });
    const p = await t.page('#home', { context: ctx, url });
    await p.waitForTimeout(500);
    return p;
  };
  const vis = (p, v) => p.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  const st = (p) => p.evaluate(() => { const S = window.__kss.state(); return { vocab: Object.keys(S.vocab).sort(), custom: Object.keys(S.custom || {}).length, log: S.log, startedAt: S.startedAt }; });

  // 设备 A：学了 가게，今天练了 10 分钟；再学一个词、收藏一句
  const A = await device({ updatedAt: 1000, startedAt: '2026-11-01', log: { [td]: { sec: 600, reps: 30 } }, vocab: { '가게': [20000, 3, 230, 2, 0] }, settings: {} });
  t.check(writes >= 1, '第一次打开时把本机进度写到云端');
  await t.go(A, '#vocab'); await A.waitForSelector('.v-item');
  await A.locator('.v-item .v-main').nth(1).click(); await A.locator('.v-detail .r2').click();
  await t.go(A, '#phrases'); await A.waitForSelector('.star');
  await A.locator('.star').first().click();
  await vis(A, 'hidden'); await A.waitForTimeout(500);
  const a1 = await st(A);
  t.eq(a1.vocab.length, 2, 'A 学了 2 个词');

  // 设备 B：本机有自己的进度（另一个词，今天练了 20 分钟）→ 打开后两边合并
  const B = await device({ updatedAt: 500, startedAt: '2026-10-20', log: { [td]: { sec: 1200, reps: 10 } }, vocab: { '나무': [20000, 1, 230, 1, 0] }, settings: {} });
  const b1 = await st(B);
  t.eq(b1.vocab, [...a1.vocab, '나무'].sort(), 'B 合并后两边的词都在');
  t.eq(b1.log[td], { sec: 1200, reps: 30 }, '同一天的练习记录取较大值（不重复累加）');
  t.eq(b1.startedAt, '2026-10-20', '开始日期取较早的');
  t.eq(b1.custom, 1, 'A 收藏的句子同步到 B');

  // A 切回页面 → 拿到 B 的词
  await vis(A, 'visible'); await A.waitForTimeout(500);
  t.check((await st(A)).vocab.includes('나무'), 'A 切回来后拿到 B 学的词');

  // B 取消收藏 → A 那边也消失（不会被"复活"）
  await t.go(B, '#phrases'); await B.waitForSelector('.star');
  await B.locator('.star').first().click(); await vis(B, 'hidden'); await B.waitForTimeout(500);
  await vis(A, 'visible'); await A.waitForTimeout(500);
  t.eq((await st(A)).custom, 0, 'B 取消的收藏在 A 也消失');
  await vis(A, 'hidden'); await A.waitForTimeout(500);
  await vis(B, 'visible'); await B.waitForTimeout(500);
  t.eq((await st(B)).custom, 0, 'A 再写回云端后收藏不会复活');

  // A 把 가게 标成「不认识」→ B 拿到的是这次最新的记录
  await t.go(A, '#vocab'); await A.waitForSelector('.v-q');
  await A.fill('.v-q', '가게'); await A.waitForTimeout(400);
  await A.locator('.v-item[data-ko="가게"] .v-main').click(); await A.locator('.v-detail .r0').click();
  await vis(A, 'hidden'); await A.waitForTimeout(500);
  await vis(B, 'visible'); await B.waitForTimeout(500);
  const g = await B.evaluate(() => window.__kss.state().vocab['가게']);
  t.check(g && g.lapses === 1 && g.last === td, '同一个词取最近一次复习的记录：' + JSON.stringify(g));

  // 合并函数本身
  const m = await A.evaluate(() => window.__kss.mergeStates(
    { updatedAt: 2, settings: { rate: 1.2, apiKey: 'k' }, srs: { a: { due: '2026-01-05', reps: 1, lapses: 0, last: '2026-01-01' } }, daysDone: { 1: '2026-01-01' }, missions: { m: true } },
    { updatedAt: 1, settings: { rate: 0.8 }, srs: { a: { due: '2026-02-01', reps: 3, lapses: 0, last: '2026-01-02' } }, daysDone: { 2: '2026-01-02' }, missions: { m: false } }));
  t.eq(m.srs.a.last, '2026-01-02', '合并：卡片取上次复习更晚的');
  t.eq(Object.keys(m.daysDone), ['1', '2'], '合并：完成的天取并集');
  t.eq(m.settings.rate, 1.2, '合并：设置取更新时间较晚的');
  t.eq(m.settings.apiKey, 'k', '合并：API Key 保留本机的');
  t.eq(m.missions.m, true, '合并：打勾状态取较新的');
};
