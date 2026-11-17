// 给单词库找例句：node scripts/build-vocab.mjs
// 读 data/vocab-topik.js（TOPIK 词汇）和 data/vocab-daily.js（对话里的生活词汇），
// 在课程、对话、情景、句库、短文、百问、范文……里找每个词出现的句子，
// 生成 data/vocab-index.js：{ 词: [例句, 例句中文, 出处, 链接, 出现的课(逗号分隔)] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKSS } from './load-data.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = loadKSS();
const order = K.unitOrder || K.units.map((u) => u.id);
const lessonNo = (id) => order.indexOf(id) + 1;
const clean = (t) => String(t || '').replace(/（[^）]*）/g, '').replace(/\s+/g, ' ').trim();

/* ── 所有句子：[韩语, 中文, 出处, 链接, 优先级, 课号] ── */
const S = [];
const push = (ko, zh, src, link, pri, uid) => { ko = clean(ko); if (/[가-힣]/.test(ko)) S.push([ko, clean(zh), src, link, pri, uid || '']); };
for (const u of K.units) {
  const tag = `第 ${lessonNo(u.id)} 课 · ${u.title}`, link = '#unit-' + u.id;
  u.chunks.forEach((c) => push(c[0], c[1], tag, link, 0, u.id));
  u.dialogue.lines.forEach((l) => push(l[1], l[2], tag, link, 2, u.id));
  u.drill.items.forEach((d) => push(d[1], d[0], tag, link, 3, u.id));
  ((K.models || {})[u.id] || []).forEach((m) => push(m[0], m[1], tag + ' · 范文', link, 4, u.id));
}
(K.phrasebank || []).forEach((c) => c.items.forEach((it) => push(it[0], it[1], '句库 · ' + c.cat, '#phrases', 1)));
(K.spoken || []).forEach((c, ci) => c.items.forEach((it) => push(it[1], it[2], '真实口语', '#drills-spoken-' + ci, 2)));
(K.scenes || []).forEach((s) => s.lines.forEach((l) => push(l[1], l[2], '情景 · ' + s.title, '#scene-' + s.id, 5)));
(K.shadowing || []).forEach((p) => p.sentences.forEach((x) => push(x[0], x[1], '短文 · ' + p.title, '#shadow-' + p.id, 6)));
(K.qa || []).forEach((c, ci) => c.items.forEach((it) => push(it[2], it[3], '百问 · ' + c.cat, '#qa-' + ci, 6)));
(K.replies || []).forEach((c, ci) => c.items.forEach((it) => push(it[2][0][0], it[2][0][1], '接话选择', '#drills-replies-' + ci, 6)));
(K.listening || []).forEach((d) => d.lines.forEach((l) => push(l[1], l[2], '听力 · ' + d.title, '#drills-comp-' + d.id, 7)));
Object.entries(K.testModels || {}).forEach(([w, ms]) => ms.forEach((m) => m.forEach((x) => push(x[0], x[1], `第 ${w} 周周测范文`, '#day-' + w * 7, 7))));
(K.styles || []).forEach((it) => push(it[1], it[0], '语体转换', '#drills-styles', 7));

/* ── 韩文字母拆合 ── */
const SB = 0xac00;
const dec = (c) => { const n = c.charCodeAt(0) - SB; return n < 0 || n > 11171 ? null : [Math.floor(n / 588), Math.floor((n % 588) / 28), n % 28]; };
const com = (l, v, t) => String.fromCharCode(SB + l * 588 + v * 28 + t);
const T = { n: 4, l: 8, b: 17, ss: 20 };
const V = { a: 0, ae: 1, eo: 4, e: 5, yeo: 6, o: 8, wa: 9, wae: 10, oe: 11, u: 13, wo: 14, wi: 16, eu: 18, i: 20 };

/* ── 一个词在句子里可能出现的形式 ── */
const ENDS = ['요', '서', '라', '고', '는', '지', '기', '면', '서', '자', '네', '니', '세', '시', '겠', '더', '던', '도', '려', '러', '다', '죠', '나', '게', '잖', '거'];
function forms(word, pos) {
  const w = word.trim();
  const isVerb = /다$/.test(w) && /[他自形动]/.test(pos || '') && w.length >= 2;
  if (!isVerb) return { stems: [w], noun: true };
  const stem = w.slice(0, -1);
  const out = new Set();
  if (/하$/.test(stem) && stem.length > 1) {
    const base = stem.slice(0, -1);
    ['하#H', '해', '했', '할', '한', '합', '함'].forEach((x) => out.add(base + x));
    if (base.replace(/\s/g, '').length >= 2) out.add(base + '#N'); // 名词用法：걱정이에요
    return { stems: [...out], verb: true };
  }
  const head = stem.slice(0, -1), last = stem.slice(-1), d = dec(last);
  ENDS.forEach((e) => out.add(stem + e));
  if (!d) return { stems: [...out], verb: true };
  const [l, v, t] = d;
  if (t === 0) {
    [T.n, T.l, T.b, T.ss].forEach((tt) => out.add(head + com(l, v, tt)));
    const cv = { [V.o]: V.wa, [V.u]: V.wo, [V.i]: V.yeo, [V.eu]: V.eo, [V.oe]: V.wae }[v];
    if (cv != null) { out.add(head + com(l, cv, 0)); out.add(head + com(l, cv, T.ss)); }
    if (v === V.eu && head) { // 르 不规则 / 으 脱落
      const hd = dec(head.slice(-1));
      if (hd && last === '르') { const h2 = head.slice(0, -1) + com(hd[0], hd[1], T.l); out.add(h2 + '라'); out.add(h2 + '러'); out.add(h2 + '랐'); out.add(h2 + '렀'); }
    }
  } else {
    ['은', '을', '어', '아', '었', '았', '으', '습'].forEach((e) => out.add(stem + e));
    if (t === T.b) { const nb = head + com(l, v, 0); ['워', '와', '운', '울', '우', '웠', '왔'].forEach((e) => out.add(nb + e)); }
    if (t === T.l) { const nl = head + com(l, v, 0); out.add(head + com(l, v, T.b) + '니'); /* 알다→압니다（不加 안/산 这类，容易撞词） */ ['세', '시', '니', '는'].forEach((e) => out.add(nl + e)); }
    if (t === 7) { const nd = head + com(l, v, T.l); ['어', '었', '으', '을', '은'].forEach((e) => out.add(nd + e)); } // ㄷ 不规则
    if (t === 19) { const ns = head + com(l, v, 0); ['아', '어', '았', '었', '으'].forEach((e) => out.add(ns + e)); } // ㅅ 不规则
  }
  return { stems: [...out], verb: true };
}
const PART = '(이|가|은|는|을|를|에|도|만|랑|이랑|하고|의|로|으로|에서|한테|께|까지|부터|처럼|보다|이에요|예요|이야|야|이요|요|이다|이네|이지|이라|라|인|과|와|씩|쯤|들|$|[^가-힣])';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(word, pos) {
  const f = forms(word, pos);
  const parts = f.stems.map((s) => {
    if (s.endsWith('#N')) return esc(s.slice(0, -2)) + PART;
    if (s.endsWith('#H')) return esc(s.slice(0, -2)) + '(?=[고는면지기세시니여자다겠러려던더게죠나잖며요]|[^가-힣]|$)';
    const syl = s.replace(/\s/g, '').length;
    if (f.noun) return esc(s) + (syl <= 1 ? PART : '');
    // 单音节的动词形式（본、할、간……）后面必须是空格/标点或常见词尾，避免匹配到 본인、하루
    return esc(s) + (syl <= 1 ? '(?=[^가-힣]|$|다|데|지|대|래|니|까|게|걸|건|요|죠)' : '');
  });
  return new RegExp('(^|[^가-힣])(' + parts.join('|') + ')');
}

/* ── 词表 ── */
const book = K.vocabBook || [], daily = K.vocabDaily || [];
const bookSet = new Set(book.map((r) => r[0].replace(/\s/g, '')));
const dupDaily = daily.filter((r) => bookSet.has(r[0].replace(/\s/g, '')));
const words = book.map((r) => [r[0], r[2]]).concat(daily.filter((r) => !bookSet.has(r[0].replace(/\s/g, ''))).map((r) => [r[0], r.length > 3 ? r[3] : (/다$/.test(r[0]) ? '他' : '名')]));

const ALL = new Set(words.map((r) => r[0].replace(/\s/g, '')));
const index = {};
let found = 0;
const t0 = Date.now();
for (const [w, pos] of words) {
  if (/^[A-Za-z]+$/.test(w)) { // MBTI、TMI 这类
    const hits = S.filter((x) => x[0].includes(w));
    if (hits.length) { const b = hits.sort((a, c) => a[4] - c[4] || Math.abs(a[0].length - 20) - Math.abs(c[0].length - 20))[0]; index[w] = [b[0], b[1], b[2], b[3], [...new Set(hits.map((h) => h[5]).filter(Boolean))].join(',')]; found++; }
    continue;
  }
  const re = matcher(w, pos);
  const self = w.replace(/\s/g, '');
  let best = null; const units = new Set();
  for (const x of S) {
    const m = re.exec(x[0]);
    if (!m) continue;
    // 匹配到的整个词如果是词表里的另一个词（감다 ↔ 감기、보다 ↔ 본인），就不算
    const tok = (x[0].slice(m.index + m[1].length).match(/^[가-힣]+/) || [''])[0];
    const bare = tok.replace(/(이랑|으로|에서|한테|까지|부터|처럼|이에요|예요|이야|이요|이|가|은|는|을|를|에|도|만|랑|와|과|의|로|요)$/, '');
    if ((ALL.has(tok) && tok !== self) || (ALL.has(bare) && bare !== self && bare.length >= 2 && !self.startsWith(bare))) continue;
    let other = false;
    for (let L = tok.length; L >= 2; L--) { const pre = tok.slice(0, L); if (ALL.has(pre)) { other = pre !== self && !self.startsWith(pre); break; } }
    if (other) continue;
    if (x[5]) units.add(x[5]);
    const score = x[4] * 10 + Math.min(9, Math.abs(x[0].length - 20) / 3);
    if (!best || score < best.score) best = { x, score };
  }
  if (best) { index[w] = [best.x[0], best.x[1], best.x[2], best.x[3], [...units].sort((a, b) => lessonNo(a) - lessonNo(b)).join(',')]; found++; }
}
const lines = ['/* 自动生成：node scripts/build-vocab.mjs（改了课程内容或词表后重新运行）',
  ' * 每个词在本项目内容里的例句：{ 词: [例句, 例句中文, 出处, 链接, 出现的课] } */',
  'window.KSS = window.KSS || {};', 'KSS.vocabIndex = {'];
for (const [k, v] of Object.entries(index)) lines.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',');
lines.push('};');
fs.writeFileSync(path.join(ROOT, 'app', 'data', 'vocab-index.js'), lines.join('\n') + '\n');
console.log(`✓ 单词 ${words.length} 个（TOPIK ${book.length} + 生活词汇 ${words.length - book.length}），找到例句 ${found} 个，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
if (dupDaily.length) console.log('  生活词汇里和 TOPIK 重复、已跳过：' + dupDaily.map((r) => r[0]).join('、'));
