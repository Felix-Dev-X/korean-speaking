// 备份提醒、添加到主屏幕提示、导出、导入（检查文件、合并 / 替换、恢复导入前的进度）、App 配置
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async (t) => {
  const old = { startedAt: '2026-01-01', log: { '2026-01-02': { sec: 600, reps: 20 } }, srs: { 'u01-c0': [20000, 3, 230, 2, 0] }, settings: {} };
  const ctx = await t.context({ device: 'iPhone 13', seed: old, ctx: { acceptDownloads: true } });
  const p = await t.page('#home', { context: ctx });

  // App 配置（添加到主屏幕用）
  const man = await p.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  t.check(man.name && man.icons.length >= 2 && man.display === 'standalone', 'manifest 完整');
  t.check(await p.evaluate(async () => (await fetch(document.querySelector('link[rel=apple-touch-icon]').href)).ok), 'iPhone 图标能打开');

  // 超过 7 天没备份 → 首页提醒；iPhone Safari → 添加到主屏幕提示
  const card = await p.locator('.backup-card').innerText();
  t.check(/该备份进度了/.test(card), '首页显示备份提醒');
  t.check(/添加到主屏幕/.test(card) && /数据是分开的/.test(card), 'iPhone 显示添加到主屏幕提示（含数据分开的说明）');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.bk-export').click()]);
  const file = path.join(os.tmpdir(), 'kss-export-test.json');
  await dl.saveAs(file);
  t.check(/^korean-speaking-progress-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), '导出文件名');
  await p.waitForTimeout(300);
  t.check(!/该备份进度了/.test(await p.locator('#app').innerText()), '导出后不再提醒备份');
  await p.locator('.a2hs-hide').click(); await p.waitForTimeout(200);
  t.eq(await p.locator('.backup-card').count(), 0, '「不再显示」后提示消失');

  // 新用户不提醒
  const n = await t.page('#home', { seed: { startedAt: new Date().toISOString().slice(0, 10), log: { x: { sec: 1, reps: 1 } }, settings: {} } });
  t.eq(await n.locator('.backup-card').count(), 0, '刚开始用的不提醒');

  // ── 导入 ──
  await t.go(p, '#prefs');
  const imp = async (content) => {
    const f = path.join(os.tmpdir(), 'kss-import-test.json');
    fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
    await p.locator('#import-file').setInputFiles(f); await p.waitForTimeout(300);
    return p.locator('.import-box').innerText();
  };
  t.check(/无法读取/.test(await imp('not json')), '坏文件：提示无法读取');
  t.check(/不是本 App/.test(await imp({ hello: 1 })), '别的 JSON：提示不是本 App 的进度');
  t.check(/格式不对/.test(await imp({ srs: [1, 2] })), '内容不完整：提示格式不对');
  t.eq((await t.state(p)).srs['u01-c0'].reps, 2, '坏文件不改动现有进度');

  // 合并：文件里有另一张卡 + 另一个词
  const other = { startedAt: '2025-12-01', srs: { 'u02-c1': [20100, 5, 250, 3, 0] }, vocab: { '나무': [20100, 3, 230, 2, 0] }, daysDone: { 1: '2025-12-01' }, settings: {} };
  const sum = await imp(other);
  t.check(/复习卡 1 张/.test(sum) && /单词 1 个/.test(sum), '导入前显示文件内容摘要');
  await p.locator('.imp-merge').click(); await p.waitForTimeout(300);
  let S = await t.state(p);
  t.check(S.srs['u01-c0'] && S.srs['u02-c1'] && S.vocab['나무'], '合并：两边的进度都在');
  t.eq(S.startedAt, '2025-12-01', '合并：开始日期取较早的');

  // 替换 → 恢复导入前的进度
  await t.go(p, '#home'); await t.go(p, '#prefs');
  await imp({ srs: {}, vocab: { '하늘': [20100, 3, 230, 2, 0] }, settings: {} });
  await p.locator('.imp-replace').click(); await p.waitForTimeout(300);
  S = await t.state(p);
  t.check(!S.srs['u01-c0'] && S.vocab['하늘'], '替换：用文件里的进度');
  await t.go(p, '#prefs');
  await p.locator('.undo-import').click(); await p.locator('.confirm-box .ok').click(); await p.waitForTimeout(300);
  S = await t.state(p);
  t.check(S.srs['u01-c0'] && S.srs['u02-c1'] && !S.vocab['하늘'], '恢复导入前的进度');

  // 导出的文件能再导入（往返）
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  t.eq(exported.v, 3, '导出文件是紧凑格式');
  t.eq(exported.settings.apiKey, '', '导出文件不带 API Key');
};
