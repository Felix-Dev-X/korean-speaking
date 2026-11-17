// 进度存储：旧格式能读、保存成紧凑格式、API Key 只在本机、重新打开能还原、体积
export default async (t) => {
  const ctx = await t.context({ seed: {
    schedule: 2, updatedAt: 5, settings: { apiKey: 'sk-test' },
    srs: { 'u01-c0': { due: '2030-01-02', ivl: 7, ease: 2.45, reps: 3, lapses: 1 } },
    vocab: { '가게': { due: '2030-03-04', ivl: 21, ease: 2.6, reps: 4, lapses: 0 } },
  } });
  const p = await t.page('#home', { context: ctx });
  let S = await t.state(p);
  t.eq(S.srs['u01-c0'], { due: '2030-01-02', ivl: 7, ease: 2.45, reps: 3, lapses: 1 }, '旧格式复习卡读取');
  t.eq(S.vocab['가게'].due, '2030-03-04', '旧格式单词读取');

  // 学一个词 → 保存
  await t.go(p, '#vocab'); await p.waitForSelector('.v-item');
  await p.locator('.v-item:not([data-ko="가게"]) .v-main').first().click(); await p.locator('.v-detail .r2').click();
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('kss-v1')));
  t.eq(stored.v, 3, '存储格式版本');
  t.eq(stored.srs['u01-c0'], [21916, 7, 245, 3, 1], '复习卡存成紧凑数组');
  t.check(Array.isArray(stored.vocab['가게']), '单词存成紧凑数组');
  t.eq(stored.settings.apiKey, 'sk-test', 'API Key 留在本机');
  const learned = Object.keys(stored.vocab).find((k) => k !== '가게');
  t.check(learned && stored.vocab[learned].length === 6, '刚学的词带「上次复习日」');

  await p.reload(); await p.waitForSelector('#app > div');
  S = await t.state(p);
  t.eq(S.srs['u01-c0'], { due: '2030-01-02', ivl: 7, ease: 2.45, reps: 3, lapses: 1 }, '重新打开后复习卡还原');
  t.check(S.vocab[learned] && S.vocab[learned].last, '重新打开后单词还原');

  // 云端/导出的那份不带 API Key
  const packed = await p.evaluate(() => window.__kss.packState(window.__kss.state()));
  t.eq(packed.settings.apiKey, '', '导出和云同步不带 API Key');

  // 学得很多时的体积：6000 个词 + 2000 张卡 < 300 KB（旧格式约 530 KB）
  const kb = await p.evaluate(() => {
    const st = JSON.parse(JSON.stringify(window.__kss.state()));
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    for (let i = 0; i < 6000; i++) st.vocab['w' + i] = { due: d(i % 60), ivl: i % 40, ease: 2.3, reps: 3, lapses: i % 3, last: d(-1) };
    for (let i = 0; i < 2000; i++) st.srs['u' + String(i % 100 + 1).padStart(2, '0') + '-c' + i] = { due: d(i % 30), ivl: 5, ease: 2.3, reps: 2, lapses: 0, last: d(-2) };
    return Math.round(JSON.stringify(window.__kss.packState(st)).length / 1024);
  });
  t.check(kb < 300, `大量进度时体积 ${kb} KB，超过 300 KB`);
};
