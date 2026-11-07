// 数据完整性检查：node scripts/check-data.mjs
import { loadKSS } from './load-data.mjs';
const K = loadKSS();
let errors = 0;
const err = (m) => { errors++; console.error('✗ ' + m); };
const ids = new Set();
for (const u of K.units) {
  if (ids.has(u.id)) err('重复的 id ' + u.id); ids.add(u.id);
  if (!K.weeks.find((w) => w.week === u.week)) err(u.id + ' 的周不存在');
  if (u.chunks.length < 8) err(u.id + ' 句块太少');
  for (const c of u.chunks) if (!c[0] || !c[1]) err(u.id + ' 句块缺字段');
  for (const l of u.dialogue.lines) if (!u.dialogue.roles[l[0]] || !l[1] || !l[2]) err(u.id + ' 对话行有误');
  if (!u.dialogue.roles[u.dialogue.me]) err(u.id + ' me 角色不存在');
  for (const d of u.drill.items) if (!d[0] || !d[1]) err(u.id + ' 快反缺字段');
  if (!u.mission.prompt || !u.mission.seconds) err(u.id + ' 独白任务缺字段');
}
for (const w of K.weeks) {
  const n = K.units.filter((u) => u.week === w.week).length;
  if (n !== 5) err(`第${w.week}周有 ${n} 课（应为5）`);
  if (w.realMissions.length < 3 || w.test.length < 4) err(`第${w.week}周任务/周测不足`);
}
const ord = K.unitOrder || [];
if (ord.length !== K.units.length || new Set(ord).size !== ord.length) err('课程顺序表（order.js）和课程数量不一致或有重复');
for (const id of ord) { const u = K.units.find((x) => x.id === id); if (!u) err('顺序表里有不存在的课：' + id); else if (u.week !== Math.floor(ord.indexOf(id) / 5) + 1) err(id + ' 在顺序表里的位置和它的周数不一致'); }
const sids = new Set();
for (const s of K.scenes) {
  if (sids.has(s.id)) err('重复的情景 id ' + s.id); sids.add(s.id);
  if (!s.roles[s.me]) err(s.id + ' me 角色不存在');
  for (const l of s.lines) if (!s.roles[l[0]] || !l[1] || !l[2]) err(s.id + ' 对话行有误');
}
const pids = new Set();
for (const p of K.shadowing || []) {
  if (pids.has(p.id)) err('重复的短文 id ' + p.id); pids.add(p.id);
  if (!p.sentences || p.sentences.length < 5) err(p.id + ' 句子太少');
  for (const x of p.sentences) if (!x[0] || !x[1]) err(p.id + ' 句子缺字段');
}
for (const c of K.qa || []) for (const it of c.items) if (it.length < 4 || it.some((x) => !x)) err('百问百答缺字段：' + it[0]);
for (const r of K.pronunciation) if (!r.examples.length || !r.sentence || r.sentence.length < 3) err('发音规则缺字段：' + r.title);
for (const it of K.styles || []) if (it.length !== 4 || it.some((x) => !x)) err('语体转换缺字段：' + it[0]);
for (const g of K.pairs || []) { if (g.items.length < 2) err('听辨组太小：' + g.title); if (new Set(g.items.map((x) => x[0])).size !== g.items.length) err('听辨组有重复：' + g.title); }
const aids = new Set();
for (const a of K.aiScenarios) { if (aids.has(a.id)) err('重复的 AI 情景 id ' + a.id); aids.add(a.id); }
for (const a of K.aiScenarios) if (!['jon', 'ban', 'ai-ban'].includes(a.speech)) err(a.id + ' speech 无效');
const count = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
console.log({
  周: K.weeks.length, 课: K.units.length,
  句块: count(K.units, (u) => u.chunks.length),
  快反: count(K.units, (u) => u.drill.items.length),
  课程对话行: count(K.units, (u) => u.dialogue.lines.length),
  情景: K.scenes.length, 情景对话行: count(K.scenes, (s) => s.lines.length),
  功能句: count(K.phrasebank, (c) => c.items.length), 句库分类: K.phrasebank.length,
  短文: (K.shadowing || []).length, 短文句子: count(K.shadowing || [], (p) => p.sentences.length),
  百问百答: count(K.qa || [], (c) => c.items.length), 语体转换: (K.styles || []).length, 听辨组: (K.pairs || []).length,
  发音规则: K.pronunciation.length, AI情景: K.aiScenarios.length,
});
if (errors) { console.error(errors + ' 个问题'); process.exit(1); } else console.log('✓ 数据检查通过');
