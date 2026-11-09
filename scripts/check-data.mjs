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
for (const s of K.scenes) if (!(K.sceneCatOrder || []).includes(s.cat)) err(s.id + ' 的分类不在 sceneCatOrder 里：' + s.cat);
{ const g = (K.phraseGroups || []).flatMap((x) => x.cats); for (const c of K.phrasebank) if (!g.includes(c.cat)) err('句库分类不在 phraseGroups 里：' + c.cat); for (const n of g) if (!K.phrasebank.some((c) => c.cat === n)) err('phraseGroups 里有不存在的分类：' + n); if (new Set(g).size !== g.length) err('phraseGroups 有重复分类'); }
for (const c of K.qa) if (!(K.qaCatOrder || []).includes(c.cat)) err('百问分类不在 qaCatOrder 里：' + c.cat);
{ let n = 0; for (const c of K.replies || []) for (const it of c.items) { n++; if (it.length !== 3 || !Array.isArray(it[2]) || it[2].length < 3 || it[2].some((o) => o.length !== 3 || o.some((s) => !String(s).trim()))) err('接话选择格式不对：' + it[0]); if (new Set(it[2].map((o) => o[0])).size !== it[2].length) err('接话选择选项重复：' + it[0]); } if (n < 50) err('接话选择题目太少：' + n); }
{ const ids = new Set(); for (const d of K.listening || []) { if (ids.has(d.id)) err('听力理解编号重复：' + d.id); ids.add(d.id); if (!(d.level >= 1 && d.level <= 4)) err(d.id + ' 难度不对'); if (d.lines.length < 3) err(d.id + ' 原文太短'); for (const l of d.lines) if (l.length !== 3 || !/^[ABCN]$/.test(l[0]) || !l[1].trim() || !l[2].trim()) err(d.id + ' 原文格式不对：' + l[1]); for (const q of d.qs) if (q.length !== 3 || q[1].length < 3 || !(q[2] >= 0 && q[2] < q[1].length) || new Set(q[1]).size !== q[1].length) err(d.id + ' 题目格式不对：' + q[0]); } }
{ const seen = new Set(); for (const c of K.spoken || []) { if (!c.tip) err('真实口语分类缺说明：' + c.cat); for (const it of c.items) { if (it.length !== 4 || it.some((x) => !String(x).trim())) err('真实口语格式不对：' + it[0]); if (it[0] === it[1]) err('真实口语两种说法一样：' + it[0]); if (seen.has(it[1])) err('真实口语重复：' + it[1]); seen.add(it[1]); } } }
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
