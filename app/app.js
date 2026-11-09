/* 韩语口语特训 App
 * 纯前端，无需构建。数据在 data/*.js，进度保存在浏览器 localStorage。
 * 语音合成：Web Speech API (speechSynthesis, ko-KR)
 * 语音识别：Web Speech API (SpeechRecognition, ko-KR) —— Chrome / Edge / Safari
 * AI 陪练：Anthropic TypeScript SDK（浏览器 ESM），使用你自己的 API Key
 */
(function () {
  'use strict';

  const K = window.KSS;
  // 'artifact' = 发布在 claude.ai 的网页版：无麦克风；用手机键盘语音输入、用 Claude（sample）陪练、进度同步到账号（db）
  const ARTIFACT = window.KSS_ENV === 'artifact';
  const CLAUDE = ARTIFACT && window.claude && typeof window.claude.use === 'function' ? window.claude : null;
  // 课程按周排序；每周 5 课（第 5 课是后来加的 u81-u100，按周插入）
  const ORDER = K.unitOrder || [];
  const ordIdx = (u) => { const i = ORDER.indexOf(u.id); return i < 0 ? 1e6 + (+u.id.slice(1)) : i; };
  const UNITS = K.units.slice().sort((a, b) => a.week - b.week || ordIdx(a) - ordIdx(b));
  const UNITS_OF_WEEK = (w) => UNITS.filter((u) => u.week === w);
  const lessonNo = (u) => pad(UNITS.indexOf(u) + 1);
  const WEEKS = K.weeks.slice().sort((a, b) => a.week - b.week);
  // 情景：先按分类（order.js 的 sceneCatOrder），同类按编号数字排；显示编号 001–160
  const SCENE_CATS = (K.sceneCatOrder || []).concat([...new Set((K.scenes || []).map((s) => s.cat))].filter((c) => !(K.sceneCatOrder || []).includes(c)));
  const SCENES = (K.scenes || []).slice().sort((a, b) => SCENE_CATS.indexOf(a.cat) - SCENE_CATS.indexOf(b.cat) || (+a.id.slice(1)) - (+b.id.slice(1)));
  const sceneNo = (s) => String(SCENES.indexOf(s) + 1).padStart(3, '0');
  // 短文：按难度排，同难度按编号；显示编号 01–48
  const PASSAGES = (K.shadowing || []).slice().sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  const passageNo = (p) => String(PASSAGES.indexOf(p) + 1).padStart(2, '0');
  // 句库：按 order.js 的 phraseGroups 分组排序（没列进去的放最后）
  const PB_GROUPS = (() => {
    const pb = (K.phrasebank || []).map((c, ci) => Object.assign({}, c, { ci }));
    const used = new Set();
    const gs = (K.phraseGroups || []).map((g) => ({ name: g.name, cats: g.cats.map((n) => pb.find((c) => c.cat === n)).filter((c) => c && !used.has(c.ci) && used.add(c.ci)) })).filter((g) => g.cats.length);
    const rest = pb.filter((c) => !used.has(c.ci));
    if (rest.length) gs.push({ name: '其他', cats: rest });
    return gs;
  })();
  const QA = (K.qa || []).flatMap((c, ci) => c.items.map((it, i) => ({ id: 'q' + ci + '-' + i, cat: c.cat, ci, q: it[0], qzh: it[1], a: it[2], azh: it[3] })));
  const TOTAL_DAYS = WEEKS.length * 7;
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.0.0/+esm';
  const MODELS = [
    ['claude-opus-5-5', 'Claude Opus 5.5（默认，纠错质量最好）'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5（更快、更便宜）'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5（最快、最便宜）'],
  ];

  /* ═════════════ 工具函数 ═════════════ */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => dateStr(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dateStr(d); };
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtTime = (sec) => Math.floor(sec / 60) + ':' + pad(Math.floor(sec % 60));
  const unitById = (id) => UNITS.find((u) => u.id === id);

  function toast(msg, ms) {
    const el = h(`<div class="toast">${esc(msg)}</div>`);
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms || 2200);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
    catch (e) {
      const ta = h('<textarea style="position:fixed;left:-9999px"></textarea>');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e2) { toast('复制失败，请手动复制'); }
      ta.remove();
    }
  }

  /* 极简 Markdown 渲染（用于 AI 批改结果） */
  function md(text) {
    const lines = esc(text).split('\n');
    let out = '', inList = false;
    for (let line of lines) {
      line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>';
        continue;
      }
      if (inList) { out += '</ul>'; inList = false; }
      if (/^#{1,4}\s/.test(line)) out += '<h4>' + line.replace(/^#{1,4}\s/, '') + '</h4>';
      else if (line.trim()) out += '<p>' + line + '</p>';
    }
    if (inList) out += '</ul>';
    return out;
  }

  /* ═════════════ 进度存储 ═════════════ */
  const STORE_KEY = 'kss-v1';
  const defaults = () => ({
    v: 1,
    schedule: 2,       // 2 = 每周 5 课 + 复习 + 周测
    startedAt: today(),
    daysDone: {},      // { dayNumber: 'YYYY-MM-DD' }
    unitsDone: {},     // { unitId: 'YYYY-MM-DD' }
    unitSteps: {},     // { unitId: { chunks: true, dialogue: true, drill: true, mission: true } }
    missions: {},      // { 'w1-0': true }
    notes: {},         // { week: '复盘文字' }
    srs: {},           // { cardId: { due, ivl, ease, reps, lapses } }
    log: {},           // { 'YYYY-MM-DD': { sec, reps } }
    scenesDone: {},    // { sceneId: count }
    custom: {},        // 收藏的句子 { 'x…': { ko, zh, src } }
    shadowDone: {},    // { passageId: 'YYYY-MM-DD' }
    qaDone: {},        // { qaId: count }
    listenDone: {},    // 听力理解 { id: { date, best } }
    settings: { rate: 1, voiceURI: '', autoListen: true, apiKey: '', model: 'claude-opus-5-5', correction: true },
  });
  /* 旧进度迁移：旧版每周 = 4 课 + 复习(第5天) + 周测(第6天) + 自由对话(第7天)；
     新版每周 = 5 课 + 复习(第6天) + 周测(第7天)。课程完成记录（unitsDone）不变。 */
  function migrate(o) {
    if (!o || o.schedule === 2) return o;
    const old = o.daysDone || {}, nd = {};
    Object.keys(old).forEach((k) => {
      const n = +k, w = Math.ceil(n / 7), d = ((n - 1) % 7) + 1;
      if (d === 5) nd[(w - 1) * 7 + 6] = old[k];
      else if (d === 6) nd[(w - 1) * 7 + 7] = old[k];
    });
    Object.keys(o.unitsDone || {}).forEach((uid) => {
      const u = unitById(uid);
      if (u) nd[(u.week - 1) * 7 + UNITS_OF_WEEK(u.week).indexOf(u) + 1] = o.unitsDone[uid];
    });
    o.daysDone = nd; o.schedule = 2;
    return o;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const o = migrate(JSON.parse(raw)), d = defaults();
        return Object.assign(d, o, { settings: Object.assign(d.settings, o.settings || {}) });
      }
    } catch (e) { /* 隐私模式等情况下忽略 */ }
    return defaults();
  }
  let S = load();
  function saveLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  /* 网页版：进度同步到观看者自己的账户（db 里 data/users/<id>/progress，只有本人能读写） */
  const CLOUD = { state: CLAUDE ? 'pending' : 'off', ready: false, ref: null, timer: null, writing: false, again: false, dirty: false };
  function cloudPayload() { return { json: JSON.stringify(Object.assign({}, S, { settings: Object.assign({}, S.settings, { apiKey: '' }) })), updatedAt: S.updatedAt || 0 }; }
  async function cloudFlush() {
    if (!CLOUD.ready || !CLOUD.dirty) return;
    if (CLOUD.writing) { CLOUD.again = true; return; }
    CLOUD.writing = true; CLOUD.dirty = false;
    try { await CLOUD.ref.set(cloudPayload()); } catch (e) { CLOUD.dirty = true; }
    CLOUD.writing = false;
    if (CLOUD.again) { CLOUD.again = false; cloudFlush(); }
  }
  function cloudSoon() {
    CLOUD.dirty = true;
    if (!CLOUD.ready) return;
    clearTimeout(CLOUD.timer);
    CLOUD.timer = setTimeout(cloudFlush, 4000);
  }
  async function initCloud() {
    if (!CLAUDE) return;
    try {
      const [db, user] = await Promise.all([CLAUDE.use('db'), CLAUDE.use('user')]);
      const id = db && user ? await user.id() : null;
      if (!id) { CLOUD.state = 'off'; return; }
      const ref = db.doc('data/users/' + id + '/progress');
      const snap = await ref.get();
      CLOUD.ref = ref; CLOUD.ready = true; CLOUD.state = 'on';
      const body = snap.exists ? snap.data() : null;
      if (body && typeof body.json === 'string' && (body.updatedAt || 0) > (S.updatedAt || 0)) {
        const o = migrate(JSON.parse(body.json)), d = defaults();
        S = Object.assign(d, o, { settings: Object.assign(d.settings, o.settings || {}) });
        saveLocal(); toast('已从你的账户同步学习进度'); route();
      } else if (!body || (S.updatedAt || 0) > (body.updatedAt || 0)) {
        CLOUD.dirty = true; cloudFlush();
      }
    } catch (e) { CLOUD.state = 'off'; CLOUD.ready = false; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cloudFlush(); });
  function save() { S.updatedAt = Date.now(); saveLocal(); cloudSoon(); }

  /* 练习时间与次数统计 */
  let lastInteract = Date.now();
  ['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastInteract = Date.now(); }, { passive: true }));
  function todayLog() { const t = today(); if (!S.log[t]) S.log[t] = { sec: 0, reps: 0 }; return S.log[t]; }
  function logRep(n) { todayLog().reps += (n || 1); save(); updateHeaderStats(); }
  setInterval(() => {
    if (document.visibilityState === 'visible' && (Date.now() - lastInteract < 90000 || speaking || listening)) {
      todayLog().sec += 15; S.updatedAt = Date.now(); saveLocal(); CLOUD.dirty = true; updateHeaderStats();
    }
  }, 15000);
  function streak() {
    let n = 0, d = today();
    if (!(S.log[d] && S.log[d].reps > 0)) d = addDays(d, -1);
    while (S.log[d] && S.log[d].reps > 0) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ═════════════ 语音合成 TTS ═════════════ */
  let koVoices = [];
  let speaking = false;
  let allVoiceCount = 0;
  const isKoVoice = (v) => /^ko([-_]|$)/i.test(v.lang || '') || /ko[-_]KR/i.test(v.voiceURI || '');
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const all = speechSynthesis.getVoices();
    allVoiceCount = all.length;
    // 不再合并"看起来一样"的发音人，全部列出来（同名的加编号区分）
    koVoices = all.filter(isKoVoice);
  }
  function voiceLabel(v) {
    const u = (v.voiceURI || '') + ' ' + v.name;
    const q = /premium/i.test(u) ? '高级音质' : /enhanced/i.test(u) ? '增强音质' : /compact/i.test(u) ? '标准' : '';
    let lab = v.name + (q && !/[（(]/.test(v.name) ? `（${q}）` : '') + (v.localService === false ? '（在线）' : '');
    const same = koVoices.filter((x) => x.name === v.name);
    if (same.length > 1) lab += ' ' + '①②③④⑤⑥⑦⑧⑨'[same.indexOf(v)] ;
    return lab;
  }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function ttsText(t) {
    return String(t).replace(/（[^）]*）/g, '').replace(/\[.*?\]/g, '').replace(/[~～]/g, '').replace(/\s\/\s/g, ', ').replace(/—/g, ', ').replace(/↗|↘/g, '').replace(/…/g, '...');
  }
  function speak(text, rateMul, pitch) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(ttsText(text));
      u.lang = 'ko-KR';
      const v = koVoices.find((x) => x.voiceURI === S.settings.voiceURI) || koVoices.find((x) => /google|yuna|sora|heami|sunhi/i.test(x.name)) || koVoices[0];
      if (v) u.voice = v;
      u.rate = Math.max(0.4, Math.min(1.6, (rateMul || 1) * (S.settings.rate || 1)));
      if (pitch) u.pitch = Math.max(0.5, Math.min(1.8, pitch));
      let done = false;
      const finish = () => { if (done) return; done = true; speaking = false; clearTimeout(timer); resolve(); };
      u.onend = finish; u.onerror = finish;
      // Chrome 偶尔不触发 onend，按长度估一个兜底时间
      const timer = setTimeout(finish, 2500 + text.length * 260 / u.rate);
      speaking = true;
      speechSynthesis.speak(u);
    });
  }
  function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = false; }
  function speakBtn(text, label, rate) {
    const b = h(`<button class="btn icon" title="${rate && rate < 1 ? '慢速播放' : '播放'}">${label || '▶'}</button>`);
    b.onclick = (e) => { e.stopPropagation(); speak(text, rate); logRep(0); };
    return b;
  }

  /* ═════════════ 语音识别 ASR ═════════════ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSR = !!SR && !ARTIFACT;
  const hasMic = !ARTIFACT && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let listening = false, currentRec = null;
  function listenOnce(onInterim, maxMs) {
    return new Promise((resolve) => {
      if (!hasSR) { resolve({ ok: false, err: 'unsupported', text: '', alts: [] }); return; }
      stopSpeak();
      let rec;
      try { rec = new SR(); } catch (e) { resolve({ ok: false, err: 'init', text: '', alts: [] }); return; }
      rec.lang = 'ko-KR'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
      let finalText = '', alts = [], err = null, interimText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) { finalText += r[0].transcript; alts = alts.concat(Array.from(r).map((a) => a.transcript)); }
          else interim += r[0].transcript;
        }
        interimText = interim;
        onInterim && onInterim(finalText + interim);
      };
      rec.onerror = (e) => { err = e.error; };
      rec.onend = () => {
        listening = false; currentRec = null; clearTimeout(t);
        const text = finalText || interimText;
        resolve({ ok: !!text, text, alts: alts.length ? alts : (text ? [text] : []), err });
      };
      const t = setTimeout(() => { try { rec.stop(); } catch (e) { /* ignore */ } }, maxMs || 15000);
      listening = true; currentRec = rec;
      try { rec.start(); } catch (e) { listening = false; resolve({ ok: false, err: 'start', text: '', alts: [] }); }
    });
  }
  function stopListen() { if (currentRec) { try { currentRec.abort(); } catch (e) { /* ignore */ } } listening = false; }
  const srErrMsg = (err) => ({
    'not-allowed': '麦克风权限被拒绝。请在浏览器地址栏允许麦克风，并通过 http://localhost 或 https 打开本页面。',
    'service-not-allowed': '浏览器不允许语音识别服务。',
    'no-speech': '没听到声音，再大声一点试试。',
    'audio-capture': '找不到麦克风设备。',
    network: '语音识别需要联网（Chrome 的识别在云端完成）。',
  }[err] || '');

  /* ═════════════ 打分 ═════════════ */
  const norm = (s) => String(s).replace(/（[^）]*）/g, '').replace(/\[.*?\]/g, '').toLowerCase().replace(/[^가-힣ㄱ-ㆎa-z0-9]/g, '');
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const targetsOf = (target) => String(target).split(/\s\/\s/).map((s) => s.trim()).filter(Boolean);
  function scoreOne(target, said) {
    const a = norm(target), b = norm(said);
    if (!a.length || !b.length) return 0;
    return Math.max(0, Math.round((1 - lev(a, b) / Math.max(a.length, b.length)) * 100));
  }
  function bestScore(target, saidAlts) {
    let best = { score: 0, target: targetsOf(target)[0], said: saidAlts[0] || '' };
    for (const t of targetsOf(target)) for (const s of saidAlts) {
      const sc = scoreOne(t, s);
      if (sc > best.score) best = { score: sc, target: t, said: s };
    }
    return best;
  }
  /* 标出目标句中没说对的字（LCS 对齐） */
  function diffHtml(target, said) {
    const chars = Array.from(target);
    const idx = []; const tn = [];
    chars.forEach((c, i) => { const n = norm(c); if (n) { idx.push(i); tn.push(n); } });
    const sn = Array.from(norm(said));
    const m = tn.length, n = sn.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = tn[i] === sn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ok = new Set();
    let i = 0, j = 0;
    while (i < m && j < n) { if (tn[i] === sn[j]) { ok.add(idx[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    return chars.map((c, k) => (norm(c) && !ok.has(k) ? `<span class="miss">${esc(c)}</span>` : esc(c))).join('');
  }
  const verdict = (s) => (s >= 90 ? ['great', '完美！'] : s >= 75 ? ['good', '很好'] : s >= 55 ? ['ok', '接近了，再来一次'] : ['bad', '再听一遍，跟着说']);

  /* 通用"开口检查"组件：说出 target，识别并打分 */
  function speakCheck(target, opts) {
    opts = opts || {};
    const el = h(`<div class="check">
      <div class="check-row">
        ${hasSR ? '<button class="btn mic">🎤 说出来</button>' : ''}
        <button class="btn ghost self">${hasSR ? '不用识别，看答案' : '我说完了，看答案'}</button>
        <span class="live"></span>
      </div>
      <div class="result"></div>
      <details class="typed" ${hasSR ? '' : 'open'}><summary>${hasSR ? '打字检查' : '用键盘语音输入说出来（点键盘上的 🎤）'}</summary>
        <div class="check-row"><input type="text" lang="ko" autocomplete="off" placeholder="${hasSR ? '输入你说的韩语' : '点这里 → 键盘 🎤 → 用韩语说'}"><button class="btn small">打分</button></div>
      </details>
    </div>`);
    const live = $('.live', el), result = $('.result', el);
    const show = (alts) => {
      const best = bestScore(target, alts);
      const [cls, word] = verdict(best.score);
      result.innerHTML = `<div class="score ${cls}"><b>${best.score}</b> 分 · ${word}</div>
        <div class="heard">识别到：${esc(best.said)}</div>
        <div class="diffline">${diffHtml(best.target, best.said)}</div>`;
      logRep();
      opts.onScore && opts.onScore(best.score, best.said);
      return best.score;
    };
    const go = async () => {
      const mic = $('.mic', el);
      if (listening) { stopListen(); return; }
      mic.classList.add('rec'); mic.textContent = '● 正在听…（点击停止）';
      live.textContent = '';
      const r = await listenOnce((t) => { live.textContent = t; });
      mic.classList.remove('rec'); mic.textContent = '🎤 再说一次';
      if (r.ok) { live.textContent = ''; show(r.alts); }
      else if (r.err && r.err !== 'aborted') { live.textContent = srErrMsg(r.err) || ('识别失败：' + r.err); }
      else if (!r.ok) { live.textContent = '没听清，再试一次'; }
    };
    if (hasSR) $('.mic', el).onclick = go;
    $('.self', el).onclick = () => { logRep(); opts.onSelf && opts.onSelf(); };
    const input = $('.typed input', el);
    $('.typed button', el).onclick = () => { if (input.value.trim()) show([input.value]); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) show([input.value]); };
    el.start = () => {
      if (hasSR && S.settings.autoListen) go();
      else if (!hasSR && S.settings.autoListen && window.matchMedia('(pointer: coarse)').matches) { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };
    return el;
  }

  /* ═════════════ 录音组件（独白任务 / 周测） ═════════════ */
  function recorder(task, opts) {
    opts = opts || {};
    const seconds = opts.seconds || 60;
    const el = h(`<div class="recorder card">
      <div class="task">${esc(task)}</div>
      ${opts.hints && opts.hints.length ? `<div class="chips">${opts.hints.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="rec-row">
        <button class="btn primary rec-btn">${hasMic ? '⏺ 开始录音' : '⏱ 开始计时'}</button>
        <span class="timer">0:00 / ${fmtTime(seconds)}</span>
      </div>
      <div class="bar"><div class="fill"></div></div>
      <div class="rec-out ${hasMic ? 'hidden' : ''}">
        ${hasMic ? '<audio controls></audio>' : ''}
        <label class="lbl">${hasMic ? '识别出的文字（可以手动修改后再批改）' : '点下面的框 → 键盘上的 🎤 → 一口气用韩语说完（说的内容会变成文字）'}</label>
        <textarea class="transcript" lang="ko" rows="4" placeholder="${hasSR ? '录音时会自动识别……' : hasMic ? '你的浏览器不支持语音识别，可以手动输入你说的内容' : '用键盘语音输入说韩语……'}"></textarea>
        <div class="check-row">
          <button class="btn ai-grade ${aiReady() || !ARTIFACT ? '' : 'hidden'}">🤖 AI 批改</button>
          <button class="btn ghost copy-grade">复制批改提示词（粘贴到 Claude 网页/App）</button>
        </div>
        <div class="grade"></div>
      </div>
    </div>`);
    const btn = $('.rec-btn', el), timerEl = $('.timer', el), fill = $('.fill', el), out = $('.rec-out', el);
    const ta = $('.transcript', el), audio = $('audio', el) || {}, gradeBox = $('.grade', el);
    let mr = null, chunks = [], stream = null, t0 = 0, tick = null, srRec = null, running = false, finalText = '';

    async function start() {
      if (hasMic) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          toast('无法使用麦克风：' + (e.message || e.name) + '。请用 http://localhost 或 https 打开，并允许麦克风。', 5000);
          return;
        }
        chunks = []; finalText = ''; ta.value = '';
        try { mr = new MediaRecorder(stream); } catch (e) { mr = null; }
      } else { ta.value = ''; setTimeout(() => { try { ta.focus(); } catch (e) { /* ignore */ } }, 50); }
      if (mr) { mr.ondataavailable = (e) => e.data.size && chunks.push(e.data); mr.onstop = () => { const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); audio.src = URL.createObjectURL(blob); }; mr.start(); }
      running = true; t0 = Date.now();
      btn.textContent = hasMic ? '⏹ 停止' : '⏹ 说完了'; btn.classList.add('rec');
      out.classList.remove('hidden');
      tick = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        timerEl.textContent = fmtTime(s) + ' / ' + fmtTime(seconds);
        fill.style.width = Math.min(100, (s / seconds) * 100) + '%';
        fill.classList.toggle('over', s > seconds);
      }, 250);
      if (hasSR) startSR();
      stopSpeak();
    }
    function startSR() {
      try {
        srRec = new SR(); srRec.lang = 'ko-KR'; srRec.continuous = true; srRec.interimResults = true;
        srRec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
            else interim += e.results[i][0].transcript;
          }
          ta.value = (finalText + interim).trim();
        };
        srRec.onend = () => { if (running) { try { srRec.start(); } catch (e) { /* ignore */ } } };
        srRec.start(); listening = true;
      } catch (e) { /* ignore */ }
    }
    function stop() {
      running = false; listening = false;
      clearInterval(tick);
      if (mr && mr.state !== 'inactive') mr.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (srRec) { try { srRec.stop(); } catch (e) { /* ignore */ } srRec = null; }
      btn.textContent = hasMic ? '⏺ 重新录音' : '⏱ 重新计时'; btn.classList.remove('rec');
      logRep(3);
      opts.onDone && opts.onDone();
    }
    btn.onclick = () => (running ? stop() : start());
    el.cleanup = () => { if (running) stop(); };

    $('.ai-grade', el).onclick = async () => {
      const text = ta.value.trim();
      if (!text) { toast(hasMic ? '先录音或输入内容' : '先用键盘语音输入说一遍'); return; }
      if (!aiReady()) { toast(ARTIFACT ? '当前无法连接 Claude，请用"复制批改提示词"' : '请先在「设置」里填写 Anthropic API Key，或使用"复制批改提示词"'); return; }
      const gb = $('.ai-grade', el); gb.disabled = true;
      gradeBox.innerHTML = '<div class="muted">AI 正在批改……（可能要等十几秒）</div>';
      try {
        await aiGrade(task, text, (full) => { gradeBox.innerHTML = md(full); });
      } catch (e) { gradeBox.innerHTML = `<div class="err">${esc(aiErr(e))}</div>`; }
      gb.disabled = false;
    };
    $('.copy-grade', el).onclick = () => {
      const text = ta.value.trim() || '（在这里粘贴/输入你说的内容）';
      copyText(K.buildGradePrompt() + `\n\n【口语任务】\n${task}\n\n【我的口语转写】\n${text}`);
    };
    return el;
  }

  /* ═════════════ Claude API ═════════════ */
  let SDK = null;
  async function sdk() {
    if (!SDK) {
      const mod = await import(SDK_URL);
      SDK = mod.default || mod.Anthropic;
      SDK.__mod = mod;
    }
    return SDK;
  }
  async function claude({ system, messages, onText, effort, maxTokens }) {
    const Anthropic = await sdk();
    const client = new Anthropic({ apiKey: S.settings.apiKey, dangerouslyAllowBrowser: true });
    const model = S.settings.model || 'claude-opus-5-5';
    const params = { model, max_tokens: maxTokens || 8000, system, messages, output_config: { effort: effort || 'low' } };
    let stream;
    if (model === 'claude-haiku-5-5') {
      stream = client.messages.stream(params);
    } else {
      // 被安全分类器误拒时，由服务端自动切换到推荐的备用模型
      stream = client.beta.messages.stream(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
    }
    stream.on('text', (t) => onText && onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') { const e = new Error('REFUSAL'); e.refusal = true; throw e; }
    return msg;
  }
  function apiErr(e) {
    const m = SDK && SDK.__mod ? SDK.__mod : {};
    const A = SDK || {};
    const is = (name) => (A[name] && e instanceof A[name]) || (m[name] && e instanceof m[name]);
    if (e && e.refusal) return '这条消息被模型拒绝了，换个说法再试试。';
    if (is('AuthenticationError')) return 'API Key 无效，请到「设置」里检查。';
    if (is('PermissionDeniedError')) return '这个 API Key 没有使用该模型的权限，可以在设置里换一个模型。';
    if (is('RateLimitError')) return '请求太频繁或额度不足，稍后再试。';
    if (is('APIConnectionError')) return '网络连接失败（检查网络/代理，或浏览器是否拦截了跨域请求）。';
    if (is('BadRequestError')) return '请求参数错误：' + (e.message || '');
    if (is('APIError')) return 'API 错误：' + (e.message || '');
    if (e && /Failed to fetch|import/i.test(String(e.message))) return '无法加载 Anthropic SDK（需要联网访问 cdn.jsdelivr.net）。';
    return '出错了：' + (e && e.message ? e.message : e);
  }
  /* 网页版：Claude 通过 sample 能力调用（使用观看者自己的 Claude 账户） */
  let SAMPLE = null, SAMPLE_STATE = CLAUDE ? 'pending' : 'none';
  if (CLAUDE) {
    CLAUDE.use('sample').then((fn) => {
      SAMPLE = fn || null; SAMPLE_STATE = fn ? 'ok' : 'none';
      if (/^#(ai|unit|day)/.test(location.hash)) route();
    }).catch(() => { SAMPLE_STATE = 'none'; });
  }
  const aiReady = () => (ARTIFACT ? !!SAMPLE : !!S.settings.apiKey);
  function sampleErr(e) {
    const c = e && e.code;
    return ({
      not_granted: '你没有允许这个页面使用 Claude。刷新页面后可以重新允许。',
      sampling_disabled: '你的账户暂时不能在页面里使用 Claude。',
      not_declared: '这个页面暂时不能使用 Claude。',
      capability_disabled: '这个页面暂时不能使用 Claude。',
      rate_limited: '用得太频繁，或者达到了使用上限。过一会儿再试。',
      session_expired: '登录已过期，请重新登录 claude.ai 后刷新。',
      refused: '这条消息被拒绝了，换个说法再试试。',
      empty_completion: '没有得到回复，换个说法再试试。',
      prompt_too_large: '对话太长了。点"结束并总评"，然后重新开始一段新对话。',
      cancelled: '已停止。',
    })[c] || '连接出了问题，再发一次试试。';
  }
  const aiErr = (e) => (ARTIFACT ? sampleErr(e) : apiErr(e));
  async function aiGrade(task, text, onFull) {
    const body = `【口语任务】\n${task}\n\n【我的口语转写】\n${text}`;
    if (ARTIFACT) {
      const r = await SAMPLE(K.buildGradePrompt() + '\n\n' + body, { modelTier: 'default', effort: 'medium', cache: false, onText: ({ text: t }) => onFull(t) });
      onFull(r.text); return r.text;
    }
    let acc = '';
    await claude({ system: K.buildGradePrompt(), messages: [{ role: 'user', content: body }], effort: 'medium', onText: (t) => { acc += t; onFull(acc); } });
    return acc;
  }

  const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  function parseTutor(t) {
    // 流式输出时去掉还没收完整的标签（如 "</feed"）
    const clean = (x) => x.replace(/<\/?[a-z]*$/i, '').trim();
    const reply = (t.match(/<reply>([\s\S]*?)(<\/reply>|$)/) || [])[1] || '';
    const fb = (t.match(/<feedback>([\s\S]*?)(<\/feedback>|$)/) || [])[1] || '';
    if (!/<reply>/.test(t) && !/<feedback>/.test(t)) return { reply: clean(t), feedback: '' };
    return { reply: clean(reply), feedback: clean(fb) };
  }

  /* ═════════════ 间隔重复（SRS） ═════════════ */
  function cardsOfUnit(u) {
    const cards = u.chunks.map((c, i) => ({ id: `${u.id}-c${i}`, ko: c[0], zh: c[1], note: c[2] || '', src: u.title }));
    u.drill.items.forEach((d, i) => cards.push({ id: `${u.id}-d${i}`, ko: d[1], zh: d[0], note: '', src: u.title + ' · 快反' }));
    return cards;
  }
  function cardById(id) {
    if (id[0] === 'x') { const c = S.custom && S.custom[id]; return c ? { id, ko: c.ko, zh: c.zh, note: '', src: '⭐ ' + (c.src || '收藏') } : null; }
    const uid = id.split('-')[0];
    const u = unitById(uid); if (!u) return null;
    return cardsOfUnit(u).find((c) => c.id === id) || null;
  }
  function addUnitCards(u) {
    cardsOfUnit(u).forEach((c) => { if (!S.srs[c.id]) S.srs[c.id] = { due: addDays(today(), 1), ivl: 0, ease: 2.3, reps: 0, lapses: 0 }; });
  }
  function rateCard(id, grade) {
    const c = S.srs[id] || { due: today(), ivl: 0, ease: 2.3, reps: 0, lapses: 0 };
    if (grade === 0) { c.ivl = 0; c.ease = Math.max(1.3, c.ease - 0.2); c.lapses++; c.reps = 0; c.due = today(); }
    else if (grade === 1) { c.ivl = Math.max(1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); c.reps++; c.due = addDays(today(), c.ivl); }
    else { c.ivl = c.ivl < 1 ? 1 : c.ivl < 3 ? 3 : Math.round(c.ivl * c.ease); c.ease = Math.min(3, c.ease + 0.05); c.reps++; c.due = addDays(today(), c.ivl); }
    S.srs[id] = c; save();
  }
  const favId = (ko) => { let h = 0; const t = String(ko); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return 'x' + (h >>> 0).toString(36); };
  function toggleFav(ko, zh, src) {
    S.custom = S.custom || {};
    const id = favId(ko);
    if (S.custom[id]) { delete S.custom[id]; delete S.srs[id]; save(); return false; }
    S.custom[id] = { ko, zh, src: src || '' };
    S.srs[id] = { due: today(), ivl: 0, ease: 2.3, reps: 0, lapses: 0 };
    save(); return true;
  }
  function starBtn(ko, zh, src) {
    const on = () => !!(S.custom && S.custom[favId(ko)]);
    const b = h(`<button class="btn icon star" title="加入/移出复习库">${on() ? '⭐' : '☆'}</button>`);
    b.onclick = (e) => { e.stopPropagation(); const now = toggleFav(ko, zh, src); b.textContent = now ? '⭐' : '☆'; toast(now ? '已加入复习库（今天就会出现）' : '已移出复习库'); };
    return b;
  }
  const dueIds = () => Object.keys(S.srs).filter((id) => S.srs[id].due <= today() && cardById(id));

  /* ═════════════ 课程日程 ═════════════ */
  function dayInfo(n) {
    const w = Math.ceil(n / 7), d = ((n - 1) % 7) + 1;
    const week = WEEKS[w - 1];
    if (d <= 5) return { n, w, d, week, type: 'unit', unit: UNITS_OF_WEEK(w)[d - 1], label: '新课' };
    if (d === 6) return { n, w, d, week, type: 'review', label: '复习+实战' };
    return { n, w, d, week, type: 'test', label: '周测+复盘' };
  }
  const dayOfUnit = (u) => (u.week - 1) * 7 + UNITS_OF_WEEK(u.week).indexOf(u) + 1;
  function isDayDone(n) { const di = dayInfo(n); return di.type === 'unit' ? !!(di.unit && S.unitsDone[di.unit.id]) : !!S.daysDone[n]; }
  function currentDay() { for (let n = 1; n <= TOTAL_DAYS; n++) if (!isDayDone(n)) return n; return TOTAL_DAYS; }
  function completeDay(n) {
    if (!S.daysDone[n]) { S.daysDone[n] = today(); save(); toast(`第 ${n} 天完成！🔥`); }
  }

  /* ═════════════ 路由与布局 ═════════════ */
  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  const app = () => $('#app');
  function setView(html) {
    const root = app();
    root.innerHTML = '';
    const el = typeof html === 'string' ? h(`<div>${html}</div>`) : html;
    root.appendChild(el);
    window.scrollTo(0, 0);
    return el;
  }
  function updateHeaderStats() {
    const el = $('#hdr-stats'); if (!el) return;
    const l = S.log[today()] || { sec: 0, reps: 0 };
    el.innerHTML = `🔥 ${streak()} 天 · 今日 ${Math.round(l.sec / 60)} 分钟 · ${l.reps} 次开口`;
  }
  function markNav(name) {
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === name));
  }
  function route() {
    cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    cleanups = [];
    stopSpeak(); stopListen();
    let raw = location.hash.replace(/^#\/?/, '');
    try { raw = decodeURIComponent(raw); } catch (e) { /* ignore */ }
    const m = raw.match(/^([a-z]+)(?:-(.+))?$/) || [];
    const name = m[1] === 'home' ? '' : (m[1] || '');
    const arg = m[2];
    const R = {
      '': viewHome, units: viewUnits, unit: viewUnit, day: viewDay, review: viewReview,
      scenes: viewScenes, scene: viewScene, phrases: viewPhrases, pron: viewPron, shadow: viewShadow, qa: viewQA, drills: viewDrills, search: viewSearch,
      ai: viewAI, prefs: viewSettings,
    };
    markNav(name === 'unit' || name === 'day' ? 'units' : name === 'scene' ? 'scenes' : name);
    if (name && !R[name]) {
      setView('<div class="card"><h2>找不到这个页面</h2><p>可能是网页刚更新、浏览器还在用旧版本。请<b>刷新页面</b>（手机下拉刷新；电脑按 Ctrl+Shift+R）。</p><a class="btn primary" href="#home">回首页</a></div>');
      return;
    }
    (R[name] || viewHome).call(null, arg);
    updateHeaderStats();
  }

  /* ═════════════ 首页 ═════════════ */
  function chart30() {
    const days = []; for (let i = 29; i >= 0; i--) days.push(addDays(today(), -i));
    const mins = days.map((d) => Math.round(((S.log[d] && S.log[d].sec) || 0) / 60));
    const max = Math.max(30, ...mins);
    const total = mins.reduce((a, b) => a + b, 0), active = mins.filter((m) => m > 0).length;
    return `<div class="chart30" role="img" aria-label="最近30天每天练习分钟数">${days.map((d, i) => `<div class="c30" title="${d}：${mins[i]} 分钟"><div class="c30b ${mins[i] >= 30 ? 'ok' : ''}" style="height:${Math.round((mins[i] / max) * 100)}%"></div></div>`).join('')}<div class="c30line" style="bottom:${Math.round((30 / max) * 100)}%"><span>30 分钟</span></div></div>
      <p class="muted small">30 天里练了 ${active} 天，共 ${total} 分钟。绿色 = 达到每天 30 分钟。</p>`;
  }
  function viewHome() {
    const n = currentDay(), info = dayInfo(n);
    const due = dueIds().length;
    let doneCount = 0; for (let k = 1; k <= TOTAL_DAYS; k++) if (isDayDone(k)) doneCount++;
    const todayTitle = info.type === 'unit' ? `${info.unit.title}` : info.type === 'review' ? '复习 + 现实任务' : `第 ${info.w} 周周测 + 本周复盘`;
    let grid = '';
    for (let w = 1; w <= WEEKS.length; w++) {
      grid += `<div class="wk"><div class="wk-l">W${w}</div>`;
      for (let d = 1; d <= 7; d++) {
        const dn = (w - 1) * 7 + d, di = dayInfo(dn);
        const cls = isDayDone(dn) ? 'done' : dn === n ? 'now' : '';
        const icon = di.type === 'unit' ? d : di.type === 'review' ? '复' : '测';
        grid += `<a class="dcell ${cls}" href="#day-${dn}" title="第${dn}天 · ${di.type === 'unit' ? di.unit.title : di.label}">${icon}</a>`;
      }
      grid += '</div>';
    }
    setView(`
      <section class="hero card">
        <div class="eyebrow">第 ${n} 天 / 共 ${TOTAL_DAYS} 天 · 第 ${info.w} 周：${esc(info.week.title)}</div>
        <h1>今天：${esc(todayTitle)}</h1>
        <p class="muted">${esc(info.type === 'unit' ? info.unit.goal : info.week.goal)}</p>
        <div class="row">
          <a class="btn primary big" href="#day-${n}">开始今天的训练 →</a>
          ${due ? `<a class="btn big" href="#review">复习到期卡片（${due}）</a>` : ''}
        </div>
      </section>
      <section class="stats">
        <div class="stat"><b>${streak()}</b><span>连续天数</span></div>
        <div class="stat"><b>${doneCount}</b><span>已完成天数</span></div>
        <div class="stat"><b>${Object.keys(S.srs).length}</b><span>复习库句子</span></div>
        <div class="stat"><b>${Math.round(Object.values(S.log).reduce((a, l) => a + (l.sec || 0), 0) / 60)}</b><span>累计分钟</span></div>
      </section>
      <section class="card">
        <h2>最近 30 天练习时间</h2>
        ${chart30()}
      </section>
      <section class="card">
        <h2>${WEEKS.length} 周路线图</h2>
        <p class="muted small">每周 5 天新课（1–5），第 6 天复习 + 现实任务（复），第 7 天周测 + 复盘（测）。点任意一天都能进去练。</p>
        <div class="grid">${grid}</div>
      </section>
      <section class="card rules">
        <h2>训练铁律（每天读一遍）</h2>
        <ol>
          <li><b>所有练习必须出声。</b>默读 = 没练。在地铁上就小声说。</li>
          <li><b>3 秒原则。</b>看到中文提示 3 秒内必须开口，说错也比沉默强。</li>
          <li><b>不准先想中文再翻译。</b>直接整句"调用"句块，这就是为什么要背整句。</li>
          <li><b>每天开口 ≥ 30 分钟</b>（右上角会统计），每周至少一次真人实战。</li>
          <li><b>独白必须录音并回听。</b>听自己的录音很难受，但进步最快。</li>
          <li><b>卡住时用救场句</b>（뭐라고 해야 되지… / 그거 한국어로 뭐더라?），绝不沉默。</li>
        </ol>
      </section>
      <section class="card">
        <h2>每天的流程（60–90 分钟）</h2>
        <div class="flow">
          <div><b>① 复习</b><span>10 分钟 · 到期卡片，中→韩开口</span></div>
          <div><b>② 句块跟读</b><span>15 分钟 · 每句至少跟读 3 遍</span></div>
          <div><b>③ 情景对话</b><span>15 分钟 · 两个角色都演一遍</span></div>
          <div><b>④ 句型快反</b><span>15 分钟 · 3 秒内开口</span></div>
          <div><b>⑤ 独白录音</b><span>10 分钟 · 录音 + 回听 + 批改</span></div>
          <div><b>⑥ AI/真人对话</b><span>15 分钟 · 用上今天学的</span></div>
        </div>
      </section>
    `);
  }

  /* ═════════════ 课程列表 ═════════════ */
  function viewUnits() {
    const html = WEEKS.map((w) => {
      const us = UNITS.filter((u) => u.week === w.week);
      return `<section class="card">
        <div class="eyebrow">第 ${w.week} 周</div>
        <h2>${esc(w.title)}</h2>
        <p class="muted">${esc(w.goal)}</p>
        <div class="unit-list">
          ${us.map((u) => `<a class="unit-item ${S.unitsDone[u.id] ? 'done' : ''}" href="#unit-${u.id}">
            <span class="u-no">${lessonNo(u)}</span>
            <span class="u-t"><b>${esc(u.title)}</b><small>${esc(u.ko)}</small></span>
            <span class="u-s">${S.unitsDone[u.id] ? '✅' : '›'}</span></a>`).join('')}
          <a class="unit-item extra" href="#day-${(w.week - 1) * 7 + 6}"><span class="u-no">复</span><span class="u-t"><b>复习 + 现实任务</b></span><span class="u-s">${S.daysDone[(w.week - 1) * 7 + 6] ? '✅' : '›'}</span></a>
          <a class="unit-item extra" href="#day-${(w.week - 1) * 7 + 7}"><span class="u-no">测</span><span class="u-t"><b>周测 + 本周复盘</b></span><span class="u-s">${S.daysDone[(w.week - 1) * 7 + 7] ? '✅' : '›'}</span></a>
        </div>
      </section>`;
    }).join('');
    setView(`<h1 class="page-title">课程：${WEEKS.length} 周 · ${UNITS.length} 课</h1>${html}`);
  }

  /* ═════════════ 每日 ═════════════ */
  function viewDay(nStr) {
    const n = Math.max(1, Math.min(TOTAL_DAYS, parseInt(nStr, 10) || 1));
    const info = dayInfo(n);
    if (info.type === 'unit') return viewUnit(info.unit.id, n);
    const head = `<div class="eyebrow">第 ${n} 天 · 第 ${info.w} 周 · ${info.label}</div>`;
    const doneBtn = `<div class="sticky-done"><button class="btn primary big done-day">${S.daysDone[n] ? '✅ 已完成（再次标记）' : '✅ 完成今天'}</button></div>`;
    let el;
    if (info.type === 'review') {
      const due = dueIds().length;
      const picks = shuffle(SCENES).slice(0, 3);
      el = setView(`${head}<h1 class="page-title">复习 + 现实任务</h1>
        <section class="card"><h2>① 复习卡片</h2>
          <p>到期卡片：<b>${due}</b> 张。每张都要<b>出声</b>说出韩语再翻答案。</p>
          <a class="btn primary" href="#review">开始复习 →</a></section>
        <section class="card"><h2>② 本周现实任务（必须在真实世界完成）</h2>
          <p class="muted">这是整个课程最重要的部分：在真实的韩国人面前开口。完成一项勾一项。</p>
          <div class="missions">${info.week.realMissions.map((m, i) => `<label class="mission"><input type="checkbox" data-k="w${info.w}-${i}" ${S.missions['w' + info.w + '-' + i] ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('')}</div>
        </section>
        <section class="card"><h2>③ 加练：情景对话库（随机 3 个）</h2>
          <div class="unit-list">${picks.map((s) => `<a class="unit-item" href="#scene-${s.id}"><span class="u-no">${esc(s.cat.slice(0, 2))}</span><span class="u-t"><b>${esc(s.title)}</b></span><span class="u-s">›</span></a>`).join('')}</div>
          <a class="btn ghost" href="#scenes">查看全部 ${SCENES.length} 个情景 →</a>
        </section>${doneBtn}`);
      $$('.missions input', el).forEach((cb) => (cb.onchange = () => { S.missions[cb.dataset.k] = cb.checked; save(); }));
    } else if (info.type === 'test') {
      el = setView(`${head}<h1 class="page-title">第 ${info.w} 周周测 + 本周复盘</h1>
        <section class="card"><p>每道题都<b>录音</b>，不看任何提示，一口气说完。用 AI 批改，或者自己回听后按下面的标准打分。</p>
        <div class="rubric"><b>自评标准（每项 1–5 分）</b>：流利度（停顿是否超过 3 秒）· 准确度（语法、敬语）· 自然度（像不像韩国人说话）· 任务完成度</div></section>
        <div class="tests"></div>
        <section class="card"><h2>本周复盘</h2>
          <p class="muted">写下：这周最常卡壳的 3 句话、最想记住的 3 个表达、下周要改的 1 个坏习惯。</p>
          <textarea class="note" id="week-note" rows="5" placeholder="例：1. 点单时不会说“少冰” → 얼음 적게 주세요">${esc(S.notes[info.w] || '')}</textarea>
        </section>
        <section class="card"><h2>本周自评</h2>
          <div class="selfscore">${['流利度', '准确度', '自然度', '反应速度'].map((k, i) => `<label>${k} <input type="range" min="1" max="5" value="${(S.notes['score' + info.w] || [])[i] || 3}" data-i="${i}"><span>${(S.notes['score' + info.w] || [])[i] || 3}</span></label>`).join('')}</div>
        </section>${doneBtn}`);
      const box = $('.tests', el);
      info.week.test.forEach((t, i) => { const r = recorder(`第 ${i + 1} 题：${t}`, { seconds: 90 }); box.appendChild(r); onLeave(r.cleanup); });
      const ta = $('.note', el);
      ta.oninput = () => { S.notes[info.w] = ta.value; save(); };
      $$('.selfscore input', el).forEach((r) => (r.oninput = () => {
        const arr = S.notes['score' + info.w] || [3, 3, 3, 3]; arr[+r.dataset.i] = +r.value; S.notes['score' + info.w] = arr; save();
        r.nextElementSibling.textContent = r.value;
      }));
    }
    $('.done-day', el).onclick = () => { completeDay(n); location.hash = '#home'; };
  }

  /* ═════════════ 单课 ═════════════ */
  const STEPS = [['chunks', '① 句块跟读'], ['dialogue', '② 情景对话'], ['drill', '③ 句型快反'], ['mission', '④ 独白任务']];
  function viewUnit(id, dayN) {
    const u = unitById(id) || UNITS[0];
    const n = dayN || dayOfUnit(u);
    const steps = S.unitSteps[u.id] || (S.unitSteps[u.id] = {});
    const el = setView(`
      <div class="eyebrow">第 ${n} 天 · 第 ${u.week} 周 · 第 ${lessonNo(u)} 课</div>
      <h1 class="page-title">${esc(u.title)} <small lang="ko">${esc(u.ko)}</small></h1>
      <p class="goal">${esc(u.goal)}</p>
      <div class="tabs">${STEPS.map(([k, t]) => `<button class="tab" data-k="${k}">${t}${steps[k] ? ' ✓' : ''}</button>`).join('')}</div>
      <div class="tab-body"></div>
      <div class="unit-foot">
        <button class="btn primary big finish">${S.unitsDone[u.id] ? '✅ 已完成（再次标记）' : '✅ 完成本课，句子加入复习库'}</button>
        <div class="nav-units">
          ${UNITS.indexOf(u) > 0 ? `<a class="btn ghost" href="#unit-${UNITS[UNITS.indexOf(u) - 1].id}">‹ 上一课</a>` : ''}
          ${UNITS.indexOf(u) < UNITS.length - 1 ? `<a class="btn ghost" href="#unit-${UNITS[UNITS.indexOf(u) + 1].id}">下一课 ›</a>` : ''}
        </div>
      </div>`);
    const body = $('.tab-body', el);
    let tabCleanup = null;
    const markStep = (k) => {
      steps[k] = true; save();
      const tb = $(`.tab[data-k="${k}"]`, el); if (tb && !/✓/.test(tb.textContent)) tb.textContent += ' ✓';
    };
    const nextBtn = (k) => {
      const i = STEPS.findIndex((s) => s[0] === k);
      const b = h(`<button class="btn primary next-step">${i < STEPS.length - 1 ? '这一步完成 → ' + STEPS[i + 1][1] : '这一步完成 ✓'}</button>`);
      b.onclick = () => { markStep(k); if (i < STEPS.length - 1) show(STEPS[i + 1][0]); else $('.finish', el).scrollIntoView({ behavior: 'smooth' }); };
      return b;
    };
    function show(k) {
      if (tabCleanup) { tabCleanup(); tabCleanup = null; }
      stopSpeak(); stopListen();
      $$('.tab', el).forEach((t) => t.classList.toggle('active', t.dataset.k === k));
      body.innerHTML = '';
      const fn = { chunks: tabChunks, dialogue: tabDialogue, drill: tabDrill, mission: tabMission }[k];
      tabCleanup = fn(u, body) || null;
      body.appendChild(nextBtn(k));
      window.scrollTo({ top: $('.tabs', el).offsetTop - 70, behavior: 'smooth' });
    }
    onLeave(() => tabCleanup && tabCleanup());
    $$('.tab', el).forEach((t) => (t.onclick = () => show(t.dataset.k)));
    $('.finish', el).onclick = () => {
      const missing = STEPS.filter(([k]) => !steps[k]).map((s) => s[1]);
      const finish = () => { S.unitsDone[u.id] = today(); addUnitCards(u); save(); completeDay(n); location.hash = '#home'; };
      if (missing.length) confirmInline($('.finish', el), `还有没完成的步骤：${missing.join('、')}。确定要标记完成吗？`, '确定完成', finish);
      else finish();
    };
    show(STEPS.find(([k]) => !steps[k]) ? STEPS.find(([k]) => !steps[k])[0] : 'chunks');
  }

  /* ── ① 句块跟读 ── */
  function tabChunks(u, body) {
    const wrap = h(`<div>
      <div class="tip card">先<b>听 → 跟读 3 遍 → 开口打分</b>。熟了以后打开「遮住韩语」，看中文直接说韩语。「自动跟读」会依次播放并等你跟读。</div>
      <div class="toolbar">
        <button class="btn auto">🔁 自动跟读</button>
        <label class="switch"><input type="checkbox" class="hide-ko"> 遮住韩语（中→韩挑战）</label>
      </div>
      <div class="chunk-list"></div></div>`);
    body.appendChild(wrap);
    const list = $('.chunk-list', wrap);
    const cards = u.chunks.map((c, i) => {
      const card = h(`<div class="chunk card" data-i="${i}">
        <div class="ko" lang="ko">${esc(c[0])}</div>
        <div class="zh">${esc(c[1])}</div>
        ${c[2] ? `<div class="note">💡 ${esc(c[2])}</div>` : ''}
        <div class="acts"></div></div>`);
      const acts = $('.acts', card);
      acts.appendChild(speakBtn(c[0], '▶ 播放'));
      acts.appendChild(speakBtn(c[0], '🐢 慢速', 0.7));
      const chk = speakCheck(c[0], { onSelf: () => card.classList.add('reveal') , onScore: () => card.classList.add('reveal') });
      card.appendChild(chk); card.chk = chk;
      $('.ko', card).onclick = () => card.classList.add('reveal');
      list.appendChild(card);
      return card;
    });
    $('.hide-ko', wrap).onchange = (e) => { list.classList.toggle('hidden-ko', e.target.checked); cards.forEach((c) => c.classList.remove('reveal')); };
    let autoRun = false;
    const autoBtn = $('.auto', wrap);
    autoBtn.onclick = async () => {
      if (autoRun) { autoRun = false; stopSpeak(); stopListen(); autoBtn.textContent = '🔁 自动跟读'; return; }
      autoRun = true; autoBtn.textContent = '⏹ 停止自动跟读';
      for (let i = 0; i < cards.length && autoRun; i++) {
        const c = cards[i], text = u.chunks[i][0];
        cards.forEach((x) => x.classList.remove('focus')); c.classList.add('focus');
        c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await speak(text); if (!autoRun) break;
        await sleep(500);
        await speak(text, 0.85); if (!autoRun) break;
        if (hasSR) {
          const r = await listenOnce((t) => { $('.live', c.chk).textContent = t; });
          if (!autoRun) break;
          if (r.ok) { const best = bestScore(text, r.alts); const [cls, w] = verdict(best.score); $('.result', c.chk).innerHTML = `<div class="score ${cls}"><b>${best.score}</b> 分 · ${w}</div><div class="heard">识别到：${esc(best.said)}</div><div class="diffline">${diffHtml(best.target, best.said)}</div>`; $('.live', c.chk).textContent = ''; logRep(); }
          c.classList.add('reveal');
          await sleep(900);
        } else {
          await sleep(1500 + text.length * 200);
          logRep();
        }
      }
      autoRun = false; autoBtn.textContent = '🔁 自动跟读';
      cards.forEach((x) => x.classList.remove('focus'));
    };
    return () => { autoRun = false; };
  }

  /* ── ② 情景对话（角色扮演，课程与情景库共用） ── */
  function rolePlay(container, dlg, onFinish) {
    let me = dlg.me;
    const other = () => Object.keys(dlg.roles).find((r) => r !== me);
    const el = h(`<div class="roleplay">
      ${dlg.scene ? `<div class="scene-desc">🎬 ${esc(dlg.scene)}</div>` : ''}
      <div class="toolbar">
        <button class="btn listen-all">▶ 先听一遍全文</button>
        <button class="btn primary start">🎭 开始角色扮演</button>
        <button class="btn ghost swap">🔄 换角色</button>
        <label class="switch"><input type="checkbox" class="show-script"> 显示全文</label>
      </div>
      <div class="role-info"></div>
      <div class="script hidden"></div>
      <div class="chat"></div>
    </div>`);
    container.appendChild(el);
    const chat = $('.chat', el), script = $('.script', el);
    const roleInfo = () => { $('.role-info', el).innerHTML = `你扮演：<b>${esc(dlg.roles[me])}</b>　对方：${esc(dlg.roles[other()])}`; };
    roleInfo();
    script.innerHTML = dlg.lines.map(([r, ko, zh]) => `<div class="sline"><b>${esc(dlg.roles[r])}</b><span lang="ko">${esc(ko)}</span><small>${esc(zh)}</small></div>`).join('');
    $$('.sline', script).forEach((s, i) => { s.onclick = () => speak(dlg.lines[i][1]); s.appendChild(starBtn(dlg.lines[i][1], dlg.lines[i][2], '对话')); });
    $('.show-script', el).onchange = (e) => script.classList.toggle('hidden', !e.target.checked);
    let run = 0;
    $('.listen-all', el).onclick = async () => {
      const my = ++run;
      for (const [, ko] of dlg.lines) { if (my !== run) return; await speak(ko); await sleep(350); }
    };
    $('.swap', el).onclick = () => { me = other(); roleInfo(); chat.innerHTML = ''; run++; stopSpeak(); stopListen(); };
    $('.start', el).onclick = async () => {
      const my = ++run; chat.innerHTML = ''; stopSpeak(); stopListen();
      const scores = [];
      for (let i = 0; i < dlg.lines.length; i++) {
        if (my !== run) return;
        const [r, ko, zh] = dlg.lines[i];
        if (r !== me) {
          const b = h(`<div class="bubble them"><div class="who">${esc(dlg.roles[r])}</div><div class="ko" lang="ko">${esc(ko)}</div><div class="zh">${esc(zh)}</div></div>`);
          b.appendChild(speakBtn(ko, '▶'));
          chat.appendChild(b); b.scrollIntoView({ behavior: 'smooth', block: 'end' });
          await speak(ko); await sleep(300);
        } else {
          const b = h(`<div class="bubble me"><div class="who">你（${esc(dlg.roles[r])}）</div><div class="zh prompt">${esc(zh)}</div>
            <div class="ko hint" lang="ko">${esc(ko)}</div><button class="btn small ghost show-hint">显示韩语提示</button></div>`);
          chat.appendChild(b); b.scrollIntoView({ behavior: 'smooth', block: 'end' });
          $('.show-hint', b).onclick = () => b.classList.add('reveal');
          await new Promise((resolve) => {
            const next = h('<button class="btn small primary nxt">下一句 ▶</button>');
            let settled = false;
            const settle = (v) => { if (settled) return; settled = true; resolve(v); };
            const chk = speakCheck(ko, {
              onScore: (s) => { b.classList.add('reveal'); scores.push(s); if (s < 80) speak(ko); if (s >= 75) setTimeout(() => settle(s), 1400); },
              onSelf: () => { b.classList.add('reveal'); speak(ko); },
            });
            next.onclick = () => settle(null);
            b.appendChild(chk); b.appendChild(next);
            chk.start();
          });
          if (my !== run) return;
        }
      }
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const end = h(`<div class="card end">🎉 对话结束！${avg != null ? `平均分 <b>${avg}</b>。` : ''}<br>换个角色再演一遍，或者关掉提示挑战"脱稿"。</div>`);
      chat.appendChild(end); end.scrollIntoView({ behavior: 'smooth', block: 'end' });
      onFinish && onFinish(avg);
    };
    return () => { run++; };
  }
  function tabDialogue(u, body) {
    body.appendChild(h('<div class="tip card">角色扮演：对方的台词会自动播放；轮到你时只显示中文，<b>直接说韩语</b>，说完自动打分。两个角色都要演一遍！</div>'));
    return rolePlay(body, u.dialogue);
  }

  /* ── ③ 句型快反 ── */
  function tabDrill(u, body) {
    const items = u.drill.items.map((d) => ({ cue: d[0], ko: d[1] }))
      .concat(shuffle(u.chunks).map((c) => ({ cue: c[1], ko: c[0], fromChunk: true })));
    const wrap = h(`<div>
      <div class="card pattern"><div class="eyebrow">句型</div><h3>${esc(u.drill.pattern)}</h3><p>${esc(u.drill.tip)}</p></div>
      <div class="tip card">看到提示后 <b>5 秒内</b>开口（进度条走完前）。前 ${u.drill.items.length} 题是句型操练，后面是本课句块的中→韩挑战。</div>
      <div class="drill-box card"></div></div>`);
    body.appendChild(wrap);
    const box = $('.drill-box', wrap);
    let i = 0; const results = [];
    let alive = true;
    function render() {
      if (!alive) return;
      if (i >= items.length) {
        const weak = results.filter((r) => r.score != null && r.score < 70);
        const avg = results.filter((r) => r.score != null);
        box.innerHTML = `<h3>🎯 完成 ${items.length} 题</h3>
          <p>${avg.length ? `平均 <b>${Math.round(avg.reduce((a, r) => a + r.score, 0) / avg.length)}</b> 分。` : ''}${weak.length ? `需要加强的 ${weak.length} 句：` : '全部过关！'}</p>
          ${weak.map((r) => `<div class="weak"><span lang="ko">${esc(r.ko)}</span><small>${esc(r.cue)}</small></div>`).join('')}
          <button class="btn again">再来一轮</button>`;
        $$('.weak', box).forEach((w, k) => (w.onclick = () => speak(weak[k].ko)));
        $('.again', box).onclick = () => { i = 0; results.length = 0; render(); };
        return;
      }
      const it = items[i];
      box.innerHTML = `<div class="prog">${i + 1} / ${items.length}${it.fromChunk ? ' · 句块挑战' : ' · 句型操练'}</div>
        <div class="cue">${esc(it.cue)}</div>
        <div class="countdown"><div></div></div>
        <div class="answer hidden"><div class="ko" lang="ko">${esc(it.ko)}</div></div>
        <div class="slot"></div>
        <div class="check-row"><button class="btn ghost reveal-ans">显示答案</button><button class="btn primary nxt">下一题 ›</button></div>`;
      const ans = $('.answer', box);
      ans.appendChild(speakBtn(it.ko, '▶'));
      const rec = { cue: it.cue, ko: it.ko, score: null };
      results.push(rec);
      const reveal = () => { if (ans.classList.contains('hidden')) { ans.classList.remove('hidden'); speak(it.ko); } };
      const chk = speakCheck(it.ko, { onScore: (s) => { rec.score = s; reveal(); }, onSelf: reveal });
      $('.slot', box).appendChild(chk);
      $('.reveal-ans', box).onclick = reveal;
      $('.nxt', box).onclick = () => { stopListen(); i++; render(); };
      requestAnimationFrame(() => { const bar = $('.countdown div', box); if (bar) bar.classList.add('go'); });
      chk.start();
    }
    render();
    return () => { alive = false; };
  }

  /* ── ④ 独白任务 ── */
  function tabMission(u, body) {
    body.appendChild(h(`<div class="tip card">按"开始录音"后一口气说完，<b>不许停顿超过 3 秒</b>。说完回听自己的录音，再用 AI 批改（或复制提示词到 Claude 网页/App 批改）。</div>`));
    const r = recorder(u.mission.prompt, { hints: u.mission.hints, seconds: u.mission.seconds });
    body.appendChild(r);
    body.appendChild(h(`<div class="card"><h3>自查清单</h3><ul class="checklist">
      <li>有没有超过 3 秒的沉默？</li><li>本课的句型/句块至少用了 3 个吗？</li>
      <li>句尾是不是只会用 -요 / -습니다？（试着加 -거든요、-더라고요、-잖아요）</li>
      <li>回听了自己的录音吗？最不满意的一句，重新说 3 遍。</li></ul></div>`));
    return r.cleanup;
  }

  /* ═════════════ 复习（SRS） ═════════════ */
  function viewReview(mode) {
    let queue = mode === 'free'
      ? shuffle(Object.keys(S.srs).length ? Object.keys(S.srs) : UNITS.slice(0, 2).flatMap((u) => cardsOfUnit(u).map((c) => c.id))).slice(0, 15)
      : shuffle(dueIds());
    const total = Object.keys(S.srs).length;
    const el = setView(`<h1 class="page-title">复习 <small>${mode === 'free' ? '自由加练' : '到期卡片'}</small></h1>
      <div class="tip card">看中文 → <b>出声</b>说韩语 → 看答案 → 诚实评价。"忘了"的卡片今天会再出现。复习库共 ${total} 句（完成一课自动加入）。</div>
      <div class="review-box card"></div>`);
    const box = $('.review-box', el);
    let done = 0;
    function render() {
      if (!queue.length) {
        box.innerHTML = `<h3>${done ? `🎉 今天复习了 ${done} 张！` : '今天没有到期的卡片 🎉'}</h3>
          <p class="muted">${total ? '明天再来。想多练的话：' : '先去完成第一课，句子会自动加入复习库。也可以直接加练：'}</p>
          <a class="btn" href="#review-free">自由加练 15 张</a> <a class="btn ghost" href="#home">回首页</a>`;
        return;
      }
      const id = queue[0], c = cardById(id);
      if (!c) { queue.shift(); render(); return; }
      box.innerHTML = `<div class="prog">剩余 ${queue.length} 张 · ${esc(c.src)}</div>
        <div class="cue">${esc(c.zh)}</div>
        <div class="slot"></div>
        <div class="answer hidden"><div class="ko" lang="ko">${esc(c.ko)}</div>${c.note ? `<div class="note">💡 ${esc(c.note)}</div>` : ''}</div>
        <div class="rate hidden">
          <button class="btn r0">😵 忘了</button><button class="btn r1">🤔 卡了</button><button class="btn r2">⚡ 秒出</button>
        </div>
        <button class="btn ghost show">显示答案</button>`;
      const ans = $('.answer', box), rate = $('.rate', box);
      ans.appendChild(speakBtn(c.ko, '▶'));
      const reveal = (score) => {
        ans.classList.remove('hidden'); rate.classList.remove('hidden'); $('.show', box).classList.add('hidden');
        speak(c.ko);
        $$('.rate .btn', box).forEach((b) => b.classList.remove('suggest'));
        if (score != null) $(score >= 85 ? '.r2' : score >= 60 ? '.r1' : '.r0', box).classList.add('suggest');
      };
      const chk = speakCheck(c.ko, { onScore: (s) => reveal(s), onSelf: () => reveal(null) });
      $('.slot', box).appendChild(chk);
      $('.show', box).onclick = () => reveal(null);
      const grade = (g) => {
        stopListen();
        if (mode !== 'free') rateCard(id, g);
        queue.shift(); done++;
        if (g === 0) queue.push(id);
        render();
      };
      $('.r0', box).onclick = () => grade(0); $('.r1', box).onclick = () => grade(1); $('.r2', box).onclick = () => grade(2);
      chk.start();
    }
    render();
  }

  /* ═════════════ 情景库 ═════════════ */
  function viewScenes(cat) {
    const cats = SCENE_CATS.filter((c) => SCENES.some((s) => s.cat === c));
    const sel = cat != null && cats[+cat] ? cats[+cat] : '';
    const item = (s) => `<a class="unit-item ${S.scenesDone[s.id] ? 'done' : ''}" href="#scene-${s.id}">
        <span class="u-no">${sceneNo(s)}</span><span class="u-t"><b>${esc(s.title)}</b><small>你扮演 ${esc(s.roles[s.me])}</small></span>
        <span class="u-s">${S.scenesDone[s.id] ? '✅' : '›'}</span></a>`;
    const groups = (sel ? [sel] : cats).map((c) => {
      const ss = SCENES.filter((s) => s.cat === c);
      const done = ss.filter((s) => S.scenesDone[s.id]).length;
      return `<section class="scene-group"><h2 class="sec-title">${esc(c)} <small class="muted">${sceneNo(ss[0])}–${sceneNo(ss[ss.length - 1])} · ${ss.length} 个${done ? ` · 已练 ${done}` : ''}</small></h2>
        <div class="unit-list">${ss.map(item).join('')}</div></section>`;
    }).join('');
    setView(`<h1 class="page-title">情景对话库 <small>${SCENES.length} 个日常场景</small></h1>
      <div class="tip card">课程之外的日常生活全场景：健身房、洗衣店、搬家、外卖、市场砍价、入境、失物、面试、开会、请假、KTV、汗蒸房、牙科、119……每个都能角色扮演。</div>
      <div class="chips filter"><a class="chip ${!sel ? 'on' : ''}" href="#scenes">全部</a>${cats.map((c, ci) => `<a class="chip ${sel === c ? 'on' : ''}" href="#scenes-${ci}">${esc(c)}</a>`).join('')}</div>
      ${groups}`);
  }
  function viewScene(id) {
    const s = SCENES.find((x) => x.id === id) || SCENES[0];
    const i = SCENES.indexOf(s);
    const el = setView(`<div class="eyebrow">情景库 · ${esc(s.cat)} · 第 ${sceneNo(s)} 个</div><h1 class="page-title">${esc(s.title)}</h1><div class="rp"></div>
      <div class="unit-foot"><div class="nav-units">
        ${i > 0 ? `<a class="btn ghost" href="#scene-${SCENES[i - 1].id}">‹ 上一个</a>` : ''}
        <a class="btn ghost" href="#scenes-${SCENE_CATS.filter((c) => SCENES.some((x) => x.cat === c)).indexOf(s.cat)}">本类情景</a>
        ${i < SCENES.length - 1 ? `<a class="btn ghost" href="#scene-${SCENES[i + 1].id}">下一个 ›</a>` : ''}
      </div></div>`);
    onLeave(rolePlay($('.rp', el), { roles: s.roles, me: s.me, lines: s.lines, scene: '' }, () => { S.scenesDone[s.id] = (S.scenesDone[s.id] || 0) + 1; save(); }));
  }

  /* ═════════════ 短文跟读 ═════════════ */
  function viewShadow(pid) {
    if (pid) return viewPassage(pid);
    const levels = { 1: '入门', 2: '基础', 3: '进阶', 4: '挑战', 5: '高阶' };
    setView(`<h1 class="page-title">短文跟读 <small>${PASSAGES.length} 篇 1 分钟独白</small></h1>
      <div class="tip card">影子跟读（Shadowing）四步：① 先听全文 ② 逐句跟读，模仿语调和停顿 ③ 遮住韩语只看中文说 ④ 什么都不看，用自己的话复述全文。每篇练到能流利复述为止。</div>
      ${[...new Set(PASSAGES.map((p) => p.level))].map((lv) => { const ps = PASSAGES.filter((p) => p.level === lv); const done = ps.filter((p) => S.shadowDone[p.id]).length;
        return `<section class="scene-group"><h2 class="sec-title">难度 ${lv} · ${levels[lv] || ''} <small class="muted">${passageNo(ps[0])}–${passageNo(ps[ps.length - 1])} · ${ps.length} 篇${done ? ` · 已练 ${done}` : ''}</small></h2>
        <div class="unit-list">${ps.map((p) => `<a class="unit-item ${S.shadowDone[p.id] ? 'done' : ''}" href="#shadow-${p.id}">
        <span class="u-no">${passageNo(p)}</span><span class="u-t"><b>${esc(p.title)}</b><small lang="ko">${esc(p.ko)} · ${p.sentences.length} 句</small></span>
        <span class="u-s">${S.shadowDone[p.id] ? '✅' : '›'}</span></a>`).join('')}</div></section>`; }).join('')}`);
  }
  function viewPassage(pid) {
    const p = PASSAGES.find((x) => x.id === pid) || PASSAGES[0];
    const i = PASSAGES.indexOf(p);
    const el = setView(`<div class="eyebrow">短文跟读 · 第 ${passageNo(p)} 篇 · 难度 ${p.level}</div>
      <h1 class="page-title">${esc(p.title)} <small lang="ko">${esc(p.ko)}</small></h1>
      <div class="toolbar">
        <button class="btn play-all">▶ 听全文</button>
        <button class="btn slow-all">🐢 慢速全文</button>
        <button class="btn primary shadow-run">🔁 逐句跟读</button>
        <label class="switch"><input type="checkbox" class="hide-ko" id="sh-hide-ko"> 遮住韩语</label>
        <label class="switch"><input type="checkbox" class="hide-zh" id="sh-hide-zh"> 隐藏中文</label>
      </div>
      <div class="card passage"></div>
      <div class="retell"></div>
      <div class="unit-foot">
        <button class="btn primary big done-p">${S.shadowDone[p.id] ? '✅ 已完成（再次标记）' : '✅ 这篇练完了'}</button>
        <div class="nav-units">
          ${i > 0 ? `<a class="btn ghost" href="#shadow-${PASSAGES[i - 1].id}">‹ 上一篇</a>` : ''}
          <a class="btn ghost" href="#shadow">全部短文</a>
          ${i < PASSAGES.length - 1 ? `<a class="btn ghost" href="#shadow-${PASSAGES[i + 1].id}">下一篇 ›</a>` : ''}
        </div>
      </div>`);
    const box = $('.passage', el);
    const rows = p.sentences.map(([ko, zh]) => {
      const row = h(`<div class="pb-row sh-row"><div class="pb-main"><span class="ko" lang="ko">${esc(ko)}</span><span class="zh">${esc(zh)}</span></div><div class="pb-acts"></div></div>`);
      $('.pb-acts', row).appendChild(speakBtn(ko, '▶'));
      const mic = h('<button class="btn icon" title="开口打分">🎤</button>');
      mic.onclick = () => {
        let chk = $('.check', row);
        if (!chk) { chk = speakCheck(ko, { onScore: () => row.classList.add('reveal'), onSelf: () => row.classList.add('reveal') }); row.appendChild(chk); }
        chk.start();
      };
      $('.pb-acts', row).appendChild(mic);
      $('.pb-acts', row).appendChild(starBtn(ko, zh, '短文 · ' + p.title));
      $('.ko', row).onclick = () => { row.classList.add('reveal'); speak(ko); };
      box.appendChild(row);
      return row;
    });
    let run = 0;
    const playAll = async (rate) => {
      const my = ++run;
      for (let k = 0; k < rows.length; k++) {
        if (my !== run) return;
        rows.forEach((r) => r.classList.remove('focus')); rows[k].classList.add('focus');
        await speak(p.sentences[k][0], rate); await sleep(300);
      }
      rows.forEach((r) => r.classList.remove('focus'));
    };
    $('.play-all', el).onclick = () => playAll(1);
    $('.slow-all', el).onclick = () => playAll(0.75);
    const runBtn = $('.shadow-run', el);
    runBtn.onclick = async () => {
      if (runBtn.dataset.on) { run++; stopSpeak(); stopListen(); runBtn.textContent = '🔁 逐句跟读'; delete runBtn.dataset.on; return; }
      const my = ++run; runBtn.dataset.on = '1'; runBtn.textContent = '⏹ 停止';
      for (let k = 0; k < rows.length && my === run; k++) {
        const ko = p.sentences[k][0];
        rows.forEach((r) => r.classList.remove('focus')); rows[k].classList.add('focus');
        rows[k].scrollIntoView({ behavior: 'smooth', block: 'center' });
        await speak(ko); if (my !== run) break;
        if (hasSR) {
          const r = await listenOnce(null, 15000);
          if (my !== run) break;
          if (r.ok) {
            const best = bestScore(ko, r.alts); const [cls, w] = verdict(best.score);
            let res = $('.sh-res', rows[k]); if (!res) { res = h('<div class="sh-res"></div>'); rows[k].appendChild(res); }
            res.innerHTML = `<div class="score ${cls}"><b>${best.score}</b> 分 · ${w}</div><div class="diffline">${diffHtml(best.target, best.said)}</div>`;
            logRep();
          }
          await sleep(500);
        } else {
          await sleep(1200 + ko.length * 170); logRep();
        }
      }
      rows.forEach((r) => r.classList.remove('focus'));
      runBtn.textContent = '🔁 逐句跟读'; delete runBtn.dataset.on;
    };
    $('.hide-ko', el).onchange = (e) => { box.classList.toggle('hidden-ko', e.target.checked); rows.forEach((r) => r.classList.remove('reveal')); };
    $('.hide-zh', el).onchange = (e) => box.classList.toggle('hidden-zh', e.target.checked);
    const rec = recorder(`复述挑战：不看原文，用自己的话把《${p.title}》讲一遍（可以加上你自己的经历）。原文要点：${p.sentences.map((x) => x[1]).join('')}`, { seconds: 90, hints: ['처음에는', '그런데', '그래서', '결국', '지금은'] });
    $('.retell', el).appendChild(h('<h2 class="sec-title">④ 复述挑战</h2>'));
    $('.retell', el).appendChild(rec);
    onLeave(() => { run++; rec.cleanup(); });
    $('.done-p', el).onclick = () => { S.shadowDone[p.id] = today(); save(); toast('这篇完成了！'); location.hash = '#shadow'; };
  }

  /* ═════════════ 百问百答 ═════════════ */
  function viewQA(cat) {
    const cats = (K.qa || []).map((c) => c.cat);
    const ci = cat != null && cats[+cat] ? +cat : -1;
    const qaOrd = (K.qaCatOrder || []);
    const catIdx = cats.map((c, i) => i).sort((a, b) => { const x = qaOrd.indexOf(cats[a]), y = qaOrd.indexOf(cats[b]); return (x < 0 ? 1e3 + a : x) - (y < 0 ? 1e3 + b : y); });
    const pool = QA.filter((x) => ci < 0 || x.ci === ci);
    const doneN = QA.filter((x) => S.qaDone[x.id]).length;
    const el = setView(`<h1 class="page-title">百问百答 <small>韩国人最常问你的 ${QA.length} 个问题</small></h1>
      <div class="tip card">听问题 → <b>5 秒内用你自己的情况回答</b>（说出来！）→ 看参考答案 → 跟读参考答案 → 把参考答案改成你自己的版本再说一遍。已练过 ${doneN} / ${QA.length} 题。</div>
      <div class="chips filter"><a class="chip ${ci < 0 ? 'on' : ''}" href="#qa">全部</a>${catIdx.map((i) => `<a class="chip ${ci === i ? 'on' : ''}" href="#qa-${i}">${esc(cats[i])}</a>`).join('')}</div>
      <div class="toolbar">
        <button class="btn primary big qa-start">▶ 开始随机问答（${pool.length} 题）</button>
        <label class="switch"><input type="checkbox" class="qa-zh" id="qa-show-zh"> 显示问题的中文</label>
      </div>
      <div class="qa-box card hidden"></div>
      <h2 class="sec-title">全部问题</h2>
      <div class="qa-list"></div>`);
    const box = $('.qa-box', el), list = $('.qa-list', el);
    pool.slice().sort((a, b) => catIdx.indexOf(a.ci) - catIdx.indexOf(b.ci)).forEach((x) => {
      const row = h(`<details class="card qa-item"><summary><span class="ko" lang="ko">${esc(x.q)}</span><span class="zh">${esc(x.qzh)}</span>${S.qaDone[x.id] ? ' <em>✓</em>' : ''}</summary>
        <div class="qa-ans"><div class="ko" lang="ko">${esc(x.a)}</div><div class="zh">${esc(x.azh)}</div><div class="acts"></div></div></details>`);
      $('.acts', row).appendChild(speakBtn(x.q, '▶ 问题'));
      $('.acts', row).appendChild(speakBtn(x.a, '▶ 参考回答'));
      $('.acts', row).appendChild(starBtn(x.a, x.azh, '百问 · ' + x.q));
      row.addEventListener('toggle', () => { if (row.open && !$('.check', row)) $('.qa-ans', row).appendChild(speakCheck(x.a)); });
      list.appendChild(row);
    });
    let queue = [], idx = 0, alive = true;
    onLeave(() => { alive = false; });
    function render() {
      if (!alive) return;
      if (idx >= queue.length) {
        box.innerHTML = `<h3>🎉 完成 ${queue.length} 题！</h3><p class="muted">把你答得最卡的 3 题，参考答案改成自己的版本，明天再练一遍。</p><button class="btn again">再来一轮</button>`;
        $('.again', box).onclick = start;
        return;
      }
      const x = queue[idx];
      const showZh = $('.qa-zh', el).checked;
      box.innerHTML = `<div class="prog">${idx + 1} / ${queue.length} · ${esc(x.cat)}</div>
        <div class="cue" lang="ko">${esc(x.q)}</div>
        <div class="zh qzh ${showZh ? '' : 'hidden'}">${esc(x.qzh)}</div>
        <div class="countdown"><div></div></div>
        <div class="check-row center-row">
          <button class="btn replay">🔁 再听一遍</button>
          <button class="btn ghost show-zh">看中文</button>
          <button class="btn primary answered">我回答完了 → 看参考答案</button>
        </div>
        <details class="typed my-ans"><summary>（可选）用键盘语音输入/打字记下你的回答</summary><textarea rows="2" lang="ko" placeholder="${hasSR ? '说完后可以在这里记一下' : '点这里 → 键盘 🎤 → 用韩语回答'}"></textarea></details>
        <div class="answer hidden"><div class="eyebrow">参考回答</div><div class="ko" lang="ko">${esc(x.a)}</div><div class="zh">${esc(x.azh)}</div><div class="acts"></div><div class="slot"></div></div>
        <div class="check-row center-row"><button class="btn primary nxt hidden">下一题 ›</button></div>`;
      $('.replay', box).onclick = () => speak(x.q);
      $('.show-zh', box).onclick = () => $('.qzh', box).classList.remove('hidden');
      $('.answered', box).onclick = () => {
        const ans = $('.answer', box);
        ans.classList.remove('hidden');
        $('.answered', box).classList.add('hidden');
        $('.nxt', box).classList.remove('hidden');
        $('.acts', ans).appendChild(speakBtn(x.a, '▶ 参考回答'));
        $('.acts', ans).appendChild(speakBtn(x.a, '🐢 慢速', 0.75));
        $('.slot', ans).appendChild(h('<p class="muted small">跟读参考回答：</p>'));
        $('.slot', ans).appendChild(speakCheck(x.a));
        S.qaDone[x.id] = (S.qaDone[x.id] || 0) + 1; save(); logRep();
        speak(x.a);
      };
      $('.nxt', box).onclick = () => { stopSpeak(); stopListen(); idx++; render(); };
      requestAnimationFrame(() => { const bar = $('.countdown div', box); if (bar) bar.classList.add('go'); });
      speak(x.q);
    }
    function start() { queue = shuffle(pool); idx = 0; box.classList.remove('hidden'); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); render(); }
    $('.qa-start', el).onclick = start;
  }

  /* ═════════════ 数字转韩语 ═════════════ */
  const SINO_D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  function sino4(n) { // 0-9999
    let out = '';
    [[1000, '천'], [100, '백'], [10, '십']].forEach(([v, u]) => { const d = Math.floor(n / v) % 10; if (d) out += (d === 1 ? '' : SINO_D[d]) + u; });
    const d = n % 10; if (d) out += SINO_D[d];
    return out;
  }
  function sino(n) {
    if (n === 0) return '영';
    const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4;
    let out = '';
    if (eok) out += sino4(eok) + '억 ';
    if (man) out += (man === 1 ? '' : sino4(man)) + '만 ';
    if (rest) out += sino4(rest);
    return out.trim();
  }
  const NAT1 = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
  const NAT1C = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
  const NAT10 = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
  function native(n, counter) { // 1-99；counter=true 时用量词前形式（한/두/세/네/스무）
    const t = Math.floor(n / 10), o = n % 10;
    if (counter && n === 20) return '스무';
    return NAT10[t] + (counter ? NAT1C[o] : NAT1[o]);
  }
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmtNum = (n) => n.toLocaleString('en-US');
  const NUM_TYPES = {
    price: { label: '价格', gen() {
      const n = pick([rnd(1, 9) * 100, rnd(10, 99) * 100, rnd(1, 50) * 1000 + pick([0, 500]), rnd(10, 300) * 1000, rnd(1, 9) * 10000 + rnd(0, 9) * 1000]);
      return { show: fmtNum(n) + '원', hint: '说出价格', ans: [sino(n) + ' 원'], dig: [n + '원'] };
    } },
    time: { label: '时间', gen() {
      const hh = rnd(1, 12), mm = pick([0, 5, 10, 15, 20, 25, 30, 40, 45, 50, 55]);
      const base = native(hh, true) + ' 시';
      const ans = mm === 0 ? [base] : mm === 30 ? [base + ' 삼십 분', base + ' 반'] : [base + ' ' + sino(mm) + ' 분'];
      const dig = mm === 0 ? [hh + '시'] : mm === 30 ? [hh + '시30분', hh + '시반'] : [hh + '시' + mm + '분'];
      return { show: hh + ':' + pad(mm), hint: '说出时间（时用固有词，分用汉字词）', ans, dig };
    } },
    date: { label: '日期', gen() {
      const m = rnd(1, 12), d = rnd(1, 31);
      const mon = m === 6 ? '유월' : m === 10 ? '시월' : sino(m) + '월';
      return { show: m + '月' + d + '日', hint: '说出日期（注意 6월=유월、10월=시월）', ans: [mon + ' ' + sino(d) + ' 일'], dig: [m + '월' + d + '일'] };
    } },
    phone: { label: '电话', gen() {
      const a = String(rnd(1000, 9999)), b = String(rnd(1000, 9999));
      const say = (str) => str.split('').map((c) => (c === '0' ? '공' : SINO_D[+c])).join('');
      return { show: '010-' + a + '-' + b, hint: '说出电话号码（0 读"공"，"-" 读"에"）', ans: ['공일공 에 ' + say(a) + ' 에 ' + say(b), '공일공 ' + say(a) + ' ' + say(b)], dig: ['010' + a + b] };
    } },
    age: { label: '年龄', gen() {
      const n = rnd(1, 69);
      return { show: n + ' 岁', hint: '说出年龄（固有词 + 살）', ans: [native(n, true) + ' 살'], dig: [n + '살'] };
    } },
    count: { label: '个数', gen() {
      const [noun, zh, ctr] = pick([['사과', '苹果', '개'], ['커피', '咖啡', '잔'], ['맥주', '啤酒', '병'], ['사람', '人', '명'], ['책', '书', '권'], ['고양이', '猫', '마리'], ['티셔츠', 'T恤', '장'], ['연필', '铅笔', '자루']]);
      const n = rnd(1, 20);
      return { show: zh + ' ' + n + ' ' + ({ '개': '个', '잔': '杯', '병': '瓶', '명': '个', '권': '本', '마리': '只', '장': '件', '자루': '支' })[ctr], hint: '说出数量（固有词 + 量词）', ans: [noun + ' ' + native(n, true) + ' ' + ctr], dig: [noun + n + ctr] };
    } },
    room: { label: '楼层房号', gen() {
      const f = rnd(1, 25), r = f * 100 + rnd(1, 12);
      return { show: f + '层 ' + r + '号', hint: '说出楼层和房号（汉字词）', ans: [sino(f) + ' 층 ' + sino(r) + ' 호'], dig: [f + '층' + r + '호'] };
    } },
    year: { label: '年份', gen() {
      const y = pick([rnd(1980, 2009), rnd(2010, 2030)]);
      return { show: y + '年', hint: '说出年份', ans: [sino(y) + ' 년'], dig: [y + '년'] };
    } },
  };

  /* ═════════════ 专项练习（数字 / 听辨 / 语体） ═════════════ */
  function viewDrills(which) {
    if (which === 'numbers') return viewNumbers();
    if (which === 'listen') return viewListen();
    if (which === 'styles') return viewStyles();
    if (which && /^replies/.test(which)) return viewReplies(which.split('-')[1]);
    if (which && /^comp/.test(which)) return viewComprehension(which.slice(5) || null);
    setView(`<h1 class="page-title">专项练习 <small>不用 AI，随时练</small></h1>
      <div class="unit-list">
        <a class="unit-item" href="#drills-numbers"><span class="u-no">数</span><span class="u-t"><b>数字快练</b><small>价格、时间、日期、电话、年龄、个数、房号、年份——随机生成，看数字说韩语，自动判对错</small></span><span class="u-s">›</span></a>
        <a class="unit-item" href="#drills-listen"><span class="u-no">听</span><span class="u-t"><b>听辨练习</b><small>${(K.pairs || []).length} 组易混音（가/까/카、반/방、어/오……），听音选字</small></span><span class="u-s">›</span></a>
        <a class="unit-item" href="#drills-replies"><span class="u-no">接</span><span class="u-t"><b>接话选择</b><small>${REPLIES.length} 句对方的话，听完选最自然的回答，看每个错误选项错在哪</small></span><span class="u-s">›</span></a>
        <a class="unit-item" href="#drills-comp"><span class="u-no">理</span><span class="u-t"><b>听力理解</b><small>${LISTENING.length} 段对话和广播，不看文字听，答中文选择题，再看原文跟读</small></span><span class="u-s">›</span></a>
        <a class="unit-item" href="#drills-styles"><span class="u-no">语</span><span class="u-t"><b>语体转换</b><small>${(K.styles || []).length} 句话 × 3 种语体（해요体 / 반말 / 합니다体），练到秒切</small></span><span class="u-s">›</span></a>
        <a class="unit-item" href="#search"><span class="u-no">搜</span><span class="u-t"><b>全站搜索</b><small>在所有课程、情景、句库、短文、百问里搜韩语或中文</small></span><span class="u-s">›</span></a>
      </div>`);
  }

  /* ═════════════ 接话选择 ═════════════ */
  const REPLIES = (K.replies || []).flatMap((c, ci) => c.items.map((it, i) => ({ id: 'r' + ci + '-' + i, cat: c.cat, ci, cue: it[0], cueZh: it[1], opts: it[2] })));
  function viewReplies(cat) {
    const cats = (K.replies || []).map((c) => c.cat);
    const ci = cat != null && cats[+cat] ? +cat : -1;
    const pool = REPLIES.filter((x) => ci < 0 || x.ci === ci);
    let queue = shuffle(pool), idx = 0, right = 0, total = 0;
    const el = setView(`<div class="eyebrow">专项练习</div><h1 class="page-title">接话选择 <small>${REPLIES.length} 题</small></h1>
      <div class="tip card">先<b>只听</b>对方说的话（听不懂可以点"显示原句"），从 3 个回答里选最自然的。答完看每个选项错在哪里，再<b>跟读正确回答</b>。错的选项都是中国学习者最常犯的：照抄对方的话、敬语用在自己身上、"네/아니요"答反、中文直译……</div>
      <div class="chips filter"><a class="chip ${ci < 0 ? 'on' : ''}" href="#drills-replies">全部</a>${cats.map((c, i) => `<a class="chip ${ci === i ? 'on' : ''}" href="#drills-replies-${i}">${esc(c)}</a>`).join('')}</div>
      <div class="card rep-box"></div>`);
    const box = $('.rep-box', el);
    function render() {
      if (idx >= queue.length) { queue = shuffle(pool); idx = 0; }
      const x = queue[idx];
      const opts = shuffle(x.opts.map((o, k) => ({ ko: o[0], zh: o[1], why: o[2], ok: k === 0 })));
      box.innerHTML = `<div class="prog">${idx + 1} / ${queue.length} · ${esc(x.cat)} · 答对 ${right} / ${total}</div>
        <div class="check-row center-row"><button class="btn primary big play">🔊 再听一遍</button><button class="btn slow">🐢 慢速</button><button class="btn ghost show-cue">显示原句</button></div>
        <div class="cue-wrap hidden"><div class="cue" lang="ko">${esc(x.cue)}</div><div class="zh">${esc(x.cueZh)}</div></div>
        <div class="muted small rep-ctx">${/（/.test(x.cueZh) ? '情境：' + esc((x.cueZh.match(/（([^）]*)）/) || [])[1] || '') : ''}</div>
        <div class="rep-opts">${opts.map((o, k) => `<button class="rep-opt" data-k="${k}"><b lang="ko">${esc(o.ko)}</b><span class="rep-zh">${esc(o.zh)}</span><span class="rep-why">${o.ok ? '✓ ' : '✗ '}${esc(o.why)}</span></button>`).join('')}</div>
        <div class="rep-after hidden"><div class="muted small">跟读正确回答：</div></div>
        <div class="check-row center-row"><button class="btn primary nxt hidden">下一题 ›</button></div>`;
      $('.play', box).onclick = () => speak(x.cue, 0.95);
      $('.slow', box).onclick = () => speak(x.cue, 0.65);
      $('.show-cue', box).onclick = () => $('.cue-wrap', box).classList.remove('hidden');
      let answered = false;
      $$('.rep-opt', box).forEach((b) => (b.onclick = () => {
        const o = opts[+b.dataset.k];
        if (answered) { speak(o.ko); return; }
        answered = true; total++; if (o.ok) right++;
        box.classList.add('answered');
        $$('.rep-opt', box).forEach((bb) => bb.classList.add(opts[+bb.dataset.k].ok ? 'right' : 'dim'));
        if (!o.ok) b.classList.add('wrong');
        $('.cue-wrap', box).classList.remove('hidden');
        $('.prog', box).textContent = `${idx + 1} / ${queue.length} · ${x.cat} · 答对 ${right} / ${total}`;
        const good = opts.find((z) => z.ok);
        const after = $('.rep-after', box);
        after.classList.remove('hidden');
        const acts = h('<div class="acts"></div>');
        acts.appendChild(speakBtn(good.ko, '▶ 正确回答'));
        acts.appendChild(starBtn(good.ko, good.zh, '接话选择 · ' + x.cue));
        after.appendChild(acts);
        after.appendChild(speakCheck(good.ko));
        $('.nxt', box).classList.remove('hidden');
        speak(good.ko);
        logRep();
      }));
      $('.nxt', box).onclick = () => { stopListen(); stopSpeak(); box.classList.remove('answered'); idx++; render(); };
      speak(x.cue, 0.95);
    }
    render();
  }

  /* ═════════════ 听力理解 ═════════════ */
  const LISTENING = (K.listening || []).slice().sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  const listenNo = (d) => String(LISTENING.indexOf(d) + 1).padStart(2, '0');
  function speakAs(text, who, rate) { return speak(text, (rate || 1) * (who === 'N' ? 0.95 : 1), who === 'B' ? 1.35 : who === 'C' ? 0.8 : 1); }
  function viewComprehension(id) {
    if (!S.listenDone) S.listenDone = {};
    if (id) return viewCompItem(id);
    const lv = { 1: '入门', 2: '基础', 3: '进阶' };
    setView(`<div class="eyebrow">专项练习</div><h1 class="page-title">听力理解 <small>${LISTENING.length} 段</small></h1>
      <div class="tip card">先<b>不看文字</b>听整段对话或广播（可以听两遍），回答中文选择题；全部答完再看原文、逐句跟读。练的是"抓重点"：时间、地点、数字、原因、最后的决定。<br><span class="small muted">两个人说话时，B 的声音会调高一点，方便区分。</span></div>
      ${[...new Set(LISTENING.map((d) => d.level))].map((l) => { const ds = LISTENING.filter((d) => d.level === l); const done = ds.filter((d) => S.listenDone[d.id]).length;
        return `<section class="scene-group"><h2 class="sec-title">难度 ${l} · ${lv[l] || ''} <small class="muted">${ds.length} 段${done ? ` · 已练 ${done}` : ''}</small></h2>
        <div class="unit-list">${ds.map((d) => `<a class="unit-item ${S.listenDone[d.id] ? 'done' : ''}" href="#drills-comp-${d.id}">
          <span class="u-no">${listenNo(d)}</span><span class="u-t"><b>${esc(d.title)}</b><small>${d.lines.some((x) => x[0] === 'N') ? '广播 / 留言' : '对话'} · ${d.qs.length} 题${S.listenDone[d.id] ? ' · 最好 ' + S.listenDone[d.id].best + '/' + d.qs.length : ''}</small></span>
          <span class="u-s">${S.listenDone[d.id] ? '✅' : '›'}</span></a>`).join('')}</div></section>`; }).join('')}`);
  }
  function viewCompItem(id) {
    const d = LISTENING.find((x) => x.id === id) || LISTENING[0];
    const i = LISTENING.indexOf(d);
    const el = setView(`<div class="eyebrow">听力理解 · 第 ${listenNo(d)} 段 · 难度 ${d.level}</div><h1 class="page-title">${esc(d.title)}</h1>
      <div class="toolbar"><button class="btn primary play-all">▶ 听全文</button><button class="btn slow-all">🐢 慢速</button><button class="btn ghost stop">■ 停止</button></div>
      <div class="card comp-qs"></div>
      <div class="comp-res"></div>
      <div class="card comp-script hidden"><h2>原文</h2><div class="comp-lines"></div></div>
      <div class="unit-foot"><div class="nav-units">
        ${i > 0 ? `<a class="btn ghost" href="#drills-comp-${LISTENING[i - 1].id}">‹ 上一段</a>` : ''}
        <a class="btn ghost" href="#drills-comp">全部</a>
        ${i < LISTENING.length - 1 ? `<a class="btn ghost" href="#drills-comp-${LISTENING[i + 1].id}">下一段 ›</a>` : ''}
      </div></div>`);
    let run = 0;
    onLeave(() => { run++; });
    const rows = [];
    const playAll = async (rate) => {
      const my = ++run;
      for (let k = 0; k < d.lines.length; k++) {
        if (my !== run) return;
        rows.forEach((r) => r.classList.remove('focus')); if (rows[k]) rows[k].classList.add('focus');
        await speakAs(d.lines[k][1], d.lines[k][0], rate); await sleep(450);
      }
      rows.forEach((r) => r.classList.remove('focus'));
    };
    $('.play-all', el).onclick = () => { playAll(1); logRep(0); };
    $('.slow-all', el).onclick = () => playAll(0.75);
    $('.stop', el).onclick = () => { run++; stopSpeak(); };
    const qbox = $('.comp-qs', el);
    const answers = new Array(d.qs.length).fill(null);
    d.qs.forEach((q, qi) => {
      const sec = h(`<div class="comp-q"><div class="comp-qt"><b>${qi + 1}.</b> ${esc(q[0])}</div><div class="comp-opts">${q[1].map((o, k) => `<button class="btn opt" data-k="${k}">${esc(o)}</button>`).join('')}</div></div>`);
      $$('.opt', sec).forEach((b) => (b.onclick = () => {
        if (answers[qi] != null) return;
        answers[qi] = +b.dataset.k;
        const ok = answers[qi] === q[2];
        b.classList.add(ok ? 'right' : 'wrong');
        $$('.opt', sec).forEach((x) => { if (+x.dataset.k === q[2]) x.classList.add('right'); });
        if (answers.every((a) => a != null)) finish();
      }));
      qbox.appendChild(sec);
    });
    function finish() {
      const score = answers.filter((a, k) => a === d.qs[k][2]).length;
      const prev = S.listenDone[d.id];
      S.listenDone[d.id] = { date: today(), best: Math.max(score, prev ? prev.best : 0) };
      save(); logRep();
      $('.comp-res', el).innerHTML = `<div class="card center-row"><span class="score ${score === d.qs.length ? 'great' : score >= d.qs.length - 1 ? 'good' : 'bad'}">${score} / ${d.qs.length}</span>
        <span class="muted small">${score === d.qs.length ? '全对！下面看原文，逐句跟读。' : '对照原文，找到你没听出来的那句，多听几遍再跟读。'}</span></div>`;
      $('.comp-script', el).classList.remove('hidden');
      const pk = $('.peek', el); if (pk) pk.parentNode.remove();
    }
    const lines = $('.comp-lines', el);
    d.lines.forEach(([who, ko, zh]) => {
      const row = h(`<div class="pb-row comp-line"><div class="pb-main"><span class="ko" lang="ko">${who !== 'N' ? `<b class="who">${esc(who)}</b> ` : ''}${esc(ko)}</span><span class="zh">${esc(zh)}</span></div><div class="pb-acts"></div></div>`);
      const play = h('<button class="btn icon" title="播放">▶</button>');
      play.onclick = () => speakAs(ko, who);
      $('.pb-acts', row).appendChild(play);
      const mic = h('<button class="btn icon" title="跟读打分">🎤</button>');
      mic.onclick = () => { let chk = $('.check', row); if (!chk) { chk = speakCheck(ko); row.appendChild(chk); } chk.start(); };
      $('.pb-acts', row).appendChild(mic);
      $('.pb-acts', row).appendChild(starBtn(ko, zh, '听力理解 · ' + d.title));
      lines.appendChild(row); rows.push(row);
    });
    const peek = h('<div class="center-row"><button class="btn ghost small peek">先看原文（不答题）</button></div>');
    $('.peek', peek).onclick = () => { $('.comp-script', el).classList.remove('hidden'); peek.remove(); };
    qbox.after(peek);
  }

  function viewNumbers() {
    let type = 'all', cur = null, right = 0, total = 0;
    const el = setView(`<div class="eyebrow">专项练习</div><h1 class="page-title">数字快练</h1>
      <div class="tip card">数字是口语里最容易卡壳的地方。看到数字后<b>马上读出来</b>（语音识别或键盘语音输入都可以），系统自动判断对错。规则：钱/日期/分钟/电话/楼层用<b>汉字词</b>（일 이 삼），时/个数/年龄用<b>固有词</b>（한 두 세）。</div>
      <div class="chips filter num-types"><a class="chip on" href="javascript:void 0" data-t="all">全部</a>${Object.entries(NUM_TYPES).map(([k, v]) => `<a class="chip" href="javascript:void 0" data-t="${k}">${v.label}</a>`).join('')}</div>
      <div class="card num-box"></div>`);
    const box = $('.num-box', el);
    function next() {
      const keys = Object.keys(NUM_TYPES);
      const t = type === 'all' ? pick(keys) : type;
      cur = NUM_TYPES[t].gen(); cur.t = t;
      box.innerHTML = `<div class="prog">${NUM_TYPES[t].label} · 已答对 ${right} / ${total}</div>
        <div class="num-show">${esc(cur.show)}</div>
        <div class="muted small">${esc(cur.hint)}</div>
        <div class="slot"></div>
        <div class="answer hidden"><div class="ko" lang="ko">${esc(cur.ans[0])}</div>${cur.ans.length > 1 ? `<div class="muted small">也可以说：${esc(cur.ans.slice(1).join(' / '))}</div>` : ''}</div>
        <div class="check-row center-row"><button class="btn ghost show">看答案</button><button class="btn primary nxt">下一个 ›</button></div>`;
      const ans = $('.answer', box);
      ans.appendChild(speakBtn(cur.ans[0], '▶'));
      let counted = false;
      const reveal = () => { if (ans.classList.contains('hidden')) { ans.classList.remove('hidden'); speak(cur.ans[0]); } };
      const chk = speakCheck(cur.ans.concat(cur.dig).join(' / '), {
        onScore: (sc) => { if (!counted) { counted = true; total++; if (sc >= 85) right++; } reveal(); $('.prog', box).textContent = NUM_TYPES[t].label + ' · 已答对 ' + right + ' / ' + total; },
        onSelf: reveal,
      });
      $('.slot', box).appendChild(chk);
      $('.show', box).onclick = reveal;
      $('.nxt', box).onclick = () => { stopListen(); stopSpeak(); next(); };
      chk.start();
    }
    $$('.num-types .chip', el).forEach((c) => (c.onclick = () => { $$('.num-types .chip', el).forEach((x) => x.classList.remove('on')); c.classList.add('on'); type = c.dataset.t; next(); }));
    next();
  }

  function viewListen() {
    const groups = K.pairs || [];
    let right = 0, total = 0, cur = null;
    const el = setView(`<div class="eyebrow">专项练习</div><h1 class="page-title">听辨练习</h1>
      <div class="tip card">听一个词，选出你听到的是哪一个。听不出来就多点几次"再听一遍"，然后用"慢速"。听得出来，才说得出来。<br><span class="small muted">提示：机器语音和真人有差别，这里练的是"耳朵对这几组音的敏感度"。</span></div>
      <div class="card listen-box"></div>`);
    const box = $('.listen-box', el);
    function next() {
      const g = pick(groups);
      const target = pick(g.items);
      cur = { g, target };
      box.innerHTML = `<div class="prog">${esc(g.title)} · 正确 ${right} / ${total}</div>
        <div class="check-row center-row"><button class="btn primary big play">🔊 再听一遍</button><button class="btn slow">🐢 慢速</button></div>
        <div class="opts">${shuffle(g.items).map((it) => `<button class="btn opt" data-w="${esc(it[0])}"><b lang="ko">${esc(it[0])}</b><small>${esc(it[1])}</small></button>`).join('')}</div>
        <div class="fb-line"></div>
        <div class="check-row center-row"><button class="btn ghost nxt hidden">下一个 ›</button></div>`;
      $('.play', box).onclick = () => speak(target[0], 0.9);
      $('.slow', box).onclick = () => speak(target[0], 0.6);
      let answered = false;
      $$('.opt', box).forEach((b) => (b.onclick = () => {
        if (answered) { speak(b.dataset.w, 0.85); return; }
        answered = true; total++;
        const ok = b.dataset.w === target[0];
        if (ok) right++;
        b.classList.add(ok ? 'right' : 'wrong');
        $$('.opt', box).forEach((x) => { if (x.dataset.w === target[0]) x.classList.add('right'); });
        $('.fb-line', box).innerHTML = ok ? '<span class="score great">✓ 听对了</span>' : `<span class="score bad">✗ 刚才播放的是「${esc(target[0])}」</span> <span class="muted small">点每个选项可以对比听</span>`;
        $('.prog', box).textContent = g.title + ' · 正确 ' + right + ' / ' + total;
        $('.nxt', box).classList.remove('hidden');
        logRep();
      }));
      $('.nxt', box).onclick = next;
      speak(target[0], 0.9);
    }
    next();
  }

  function viewStyles() {
    const items = K.styles || [];
    let order = shuffle(items.map((_, i) => i)), idx = 0;
    const el = setView(`<div class="eyebrow">专项练习</div><h1 class="page-title">语体转换</h1>
      <div class="tip card">同一句话，对朋友（반말）、对一般人（해요体）、在正式场合（합니다体）说法不同。看中文，<b>三种语体依次说出来</b>，每种都会打分。熟练以后挑战一口气连说三种。</div>
      <div class="card style-box"></div>`);
    const box = $('.style-box', el);
    const LABELS = [['해요体', '礼貌（一般人、店员、同事）'], ['반말', '半语（朋友、晚辈）'], ['합니다体', '正式（会议、面试、长辈、广播）']];
    function render() {
      if (idx >= order.length) { order = shuffle(order); idx = 0; }
      const it = items[order[idx]];
      box.innerHTML = `<div class="prog">${idx + 1} / ${items.length}</div><div class="cue">${esc(it[0])}</div><div class="style-rows"></div>
        <div class="check-row center-row"><button class="btn ghost show-all">全部显示</button><button class="btn primary nxt">下一句 ›</button></div>`;
      const rows = $('.style-rows', box);
      LABELS.forEach(([lab, desc], k) => {
        const ko = it[k + 1];
        const row = h(`<div class="style-row"><div class="style-lab"><b>${lab}</b><small>${desc}</small></div><div class="ko hint" lang="ko">${esc(ko)}</div><div class="acts"></div></div>`);
        $('.acts', row).appendChild(speakBtn(ko, '▶'));
        $('.acts', row).appendChild(starBtn(ko, it[0] + '（' + lab + '）', '语体转换'));
        row.appendChild(speakCheck(ko, { onScore: () => row.classList.add('reveal'), onSelf: () => row.classList.add('reveal') }));
        rows.appendChild(row);
      });
      $('.show-all', box).onclick = () => $$('.style-row', box).forEach((r) => r.classList.add('reveal'));
      $('.nxt', box).onclick = () => { stopListen(); stopSpeak(); idx++; render(); };
    }
    render();
  }

  /* ═════════════ 全站搜索 ═════════════ */
  let SEARCH_INDEX = null;
  function buildIndex() {
    const idx = [];
    const add = (ko, zh, src, href) => idx.push({ ko, zh: zh || '', src, href, k: String(ko).toLowerCase(), z: String(zh || '').toLowerCase() });
    UNITS.forEach((u) => {
      const tag = `第${lessonNo(u)}课 ${u.title}`;
      u.chunks.forEach((c) => add(c[0], c[1], tag + ' · 句块', '#unit-' + u.id));
      u.dialogue.lines.forEach((l) => add(l[1], l[2], tag + ' · 对话', '#unit-' + u.id));
      u.drill.items.forEach((d) => add(d[1], d[0], tag + ' · 快反', '#unit-' + u.id));
    });
    SCENES.forEach((sc) => sc.lines.forEach((l) => add(l[1], l[2], '情景 · ' + sc.title, '#scene-' + sc.id)));
    (K.phrasebank || []).forEach((c, ci) => c.items.forEach((it) => add(it[0], it[1] + (it[2] ? '（' + it[2] + '）' : ''), '句库 · ' + c.cat, '#phrases')));
    PASSAGES.forEach((p) => p.sentences.forEach((x) => add(x[0], x[1], '短文 · ' + p.title, '#shadow-' + p.id)));
    QA.forEach((x) => { add(x.q, x.qzh, '百问 · ' + x.cat, '#qa-' + x.ci); add(x.a, x.azh, '百问 · 参考回答', '#qa-' + x.ci); });
    (K.styles || []).forEach((it) => [1, 2, 3].forEach((k) => add(it[k], it[0], '语体转换', '#drills-styles')));
    REPLIES.forEach((x) => { add(x.cue, x.cueZh, '接话选择', '#drills-replies-' + x.ci); add(x.opts[0][0], x.opts[0][1], '接话选择 · 正确回答', '#drills-replies-' + x.ci); });
    LISTENING.forEach((d) => d.lines.forEach((l) => add(l[1], l[2], '听力理解 · ' + d.title, '#drills-comp-' + d.id)));
    (K.pronunciation || []).forEach((r) => add(r.sentence[0], r.sentence[2], '发音 · ' + r.title, '#pron'));
    return idx;
  }
  let lastQuery = '';
  function viewSearch() {
    if (!SEARCH_INDEX) SEARCH_INDEX = buildIndex();
    const el = setView(`<h1 class="page-title">搜索 <small>${SEARCH_INDEX.length} 句</small></h1>
      <div class="card"><label class="lbl" for="search-q">输入韩语或中文（例：거든요、点餐、医院、칭찬）</label>
        <input type="text" id="search-q" class="sq" autocomplete="off" placeholder="搜索……"></div>
      <div class="search-meta muted small"></div>
      <div class="search-res"></div>`);
    const input = $('.sq', el), res = $('.search-res', el), meta = $('.search-meta', el);
    let timer = null;
    const run = () => {
      const q = input.value.trim().toLowerCase(); lastQuery = input.value;
      res.innerHTML = '';
      if (!q) { meta.textContent = ''; return; }
      const hits = SEARCH_INDEX.filter((x) => x.k.includes(q) || x.z.includes(q));
      meta.textContent = `找到 ${hits.length} 句${hits.length > 100 ? '，显示前 100 句' : ''}`;
      hits.slice(0, 100).forEach((x) => {
        const row = h(`<div class="pb-row card s-row"><div class="pb-main"><span class="ko" lang="ko">${esc(x.ko)}</span><span class="zh">${esc(x.zh)}</span><a class="s-src" href="${x.href}">${esc(x.src)} ›</a></div><div class="pb-acts"></div></div>`);
        $('.pb-acts', row).appendChild(speakBtn(x.ko, '▶'));
        $('.pb-acts', row).appendChild(starBtn(x.ko, x.zh, x.src));
        $('.ko', row).onclick = () => speak(x.ko);
        res.appendChild(row);
      });
    };
    input.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
    input.value = lastQuery; run();
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }

  /* ═════════════ 功能句库 ═════════════ */
  function viewPhrases() {
    const pb = K.phrasebank || [];
    const count = pb.reduce((a, c) => a + c.items.length, 0);
    const el = setView(`<h1 class="page-title">功能句库 <small>${count} 句</small></h1>
      <div class="tip card">按"交际功能"分类的高频句。日常对话里 90% 的句子都由这些零件组成。点句子播放，点 🎤 开口打分。打开「遮住韩语」做中→韩自测。</div>
      <div class="toolbar"><label class="switch"><input type="checkbox" class="hide-ko"> 遮住韩语</label></div>
      ${PB_GROUPS.map((g) => `<div class="pb-group"><b>${esc(g.name)}</b><div class="chips filter">${g.cats.map((c) => `<a class="chip" href="javascript:void 0" data-i="${c.ci}">${esc(c.cat)}</a>`).join('')}</div></div>`).join('')}
      <div class="pb"></div>`);
    const box = $('.pb', el);
    PB_GROUPS.forEach((g) => { box.appendChild(h(`<h2 class="sec-title pb-gtitle">${esc(g.name)}</h2>`)); g.cats.forEach((c) => {
      const ci = c.ci;
      const sec = h(`<section class="card pb-sec" id="pb-${ci}"><h2>${esc(c.cat)}</h2><div class="pb-list"></div></section>`);
      const list = $('.pb-list', sec);
      c.items.forEach((it) => {
        const row = h(`<div class="pb-row"><div class="pb-main"><span class="ko" lang="ko">${esc(it[0])}</span><span class="zh">${esc(it[1])}${it[2] ? ` <em>${esc(it[2])}</em>` : ''}</span></div><div class="pb-acts"></div></div>`);
        $('.pb-acts', row).appendChild(speakBtn(it[0], '▶'));
        const mic = h('<button class="btn icon" title="开口打分">🎤</button>');
        mic.onclick = () => {
          let chk = $('.check', row);
          if (!chk) { chk = speakCheck(it[0], { onScore: () => row.classList.add('reveal'), onSelf: () => row.classList.add('reveal') }); row.appendChild(chk); }
          chk.start();
        };
        $('.pb-acts', row).appendChild(mic);
        $('.pb-acts', row).appendChild(starBtn(it[0], it[1], '句库 · ' + c.cat));
        $('.ko', row).onclick = () => { row.classList.add('reveal'); speak(it[0]); };
        list.appendChild(row);
      });
      box.appendChild(sec);
    }); });
    $$('.filter .chip', el).forEach((a) => (a.onclick = () => $('#pb-' + a.dataset.i).scrollIntoView({ behavior: 'smooth' })));
    $('.hide-ko', el).onchange = (e) => { box.classList.toggle('hidden-ko', e.target.checked); $$('.pb-row', box).forEach((r) => r.classList.remove('reveal')); };
  }

  /* ═════════════ 发音 ═════════════ */
  function viewPron() {
    const el = setView(`<h1 class="page-title">发音急救</h1>
      <div class="tip card">口语里"听不懂"和"说了对方听不懂"，一大半是音变问题。点拼写听发音，再用 🎤 跟读整句。</div><div class="pron"></div>`);
    const box = $('.pron', el);
    K.pronunciation.forEach((r) => {
      const sec = h(`<section class="card"><h2>${esc(r.title)}</h2><p>${esc(r.rule)}</p>
        <div class="pron-ex">${r.examples.map((e) => `<button class="ex" data-t="${esc(e[0])}"><b lang="ko">${esc(e[0])}</b><span>${esc(e[1])}</span><small>${esc(e[2])}</small></button>`).join('')}</div>
        <div class="pron-sent"><div class="ko" lang="ko">${esc(r.sentence[0])}</div><div class="muted">${esc(r.sentence[1])}</div><div class="zh">${esc(r.sentence[2])}</div><div class="acts"></div></div></section>`);
      $$('.ex', sec).forEach((b) => (b.onclick = () => speak(b.dataset.t.replace(/[↗↘]/g, ''), 0.85)));
      const acts = $('.acts', sec);
      acts.appendChild(speakBtn(r.sentence[0], '▶ 播放'));
      acts.appendChild(speakBtn(r.sentence[0], '🐢 慢速', 0.7));
      sec.appendChild(speakCheck(r.sentence[0]));
      box.appendChild(sec);
    });
  }

  /* ═════════════ AI 陪练 ═════════════ */
  function viewAI(sid) {
    if (sid) return viewAIChat(sid);
    const ready = aiReady();
    const intro = ARTIFACT
      ? (SAMPLE_STATE === 'ok'
        ? '<p class="ok-line">✅ 用你自己的 Claude 账户对话，不需要 API Key。第一次发消息时会请你允许这个页面使用 Claude。</p>'
        : SAMPLE_STATE === 'pending'
          ? '<p class="muted">正在连接 Claude……</p>'
          : '<p class="muted">当前打开方式不能直接调用 Claude。请在 claude.ai 里打开这个页面，或者用下面的"复制提示词"。</p>')
      : (ready ? `<p class="ok-line">✅ 已设置 API Key（模型：${esc(S.settings.model)}）</p>` : `<div class="key-box">
          <p><b>方式一：用你的 Anthropic API Key</b>（Key 只保存在你这台设备的浏览器里，直接发往 Anthropic）</p>
          <div class="check-row"><input type="password" class="key" placeholder="sk-ant-..." autocomplete="off"><button class="btn primary save-key">保存</button></div>
          <p class="muted small">在 platform.claude.com 申请 API Key。</p></div>`);
    const el = setView(`<h1 class="page-title">AI 陪练 <small>真实对话 + 实时纠错</small></h1>
      <section class="card">
        <p>AI 扮演一个韩国人和你对话，每句话都会给你中文纠错和更地道的说法。${hasSR ? '你可以<b>说话</b>（语音识别）或打字。' : '手机上点输入框，用<b>键盘上的 🎤 语音输入</b>直接说韩语。'}</p>
        ${intro}
        <p><b>${ARTIFACT || ready ? '想用语音模式聊？' : '方式二：没有 API Key 也能练'}</b>：选一个情景 → 点"复制提示词" → 粘贴到 Claude App 里，打开语音模式就能直接和它说话。</p>
      </section>
      <section class="card"><h2>选择情景</h2>
        <label class="switch"><input type="checkbox" class="corr" ${S.settings.correction ? 'checked' : ''}> 每句都纠错（关掉 = 只纠正严重错误，更像真实聊天）</label>
        <div class="scn-grid">${K.aiScenarios.map((s) => `<div class="scn"><span class="i">${s.icon}</span><b>${esc(s.title)}</b>
          <small>${s.speech === 'ban' ? '半语' : s.speech === 'ai-ban' ? '对方半语·你敬语' : '敬语'}</small>
          <div class="scn-acts">${ready ? `<a class="btn small primary" href="#ai-${s.id}">开始对话</a>` : ''}<button class="btn small ghost cp" data-id="${s.id}">复制提示词</button></div></div>`).join('')}</div>
      </section>`);
    const sk = $('.save-key', el);
    if (sk) sk.onclick = () => { const v = $('.key', el).value.trim(); if (!v) return; S.settings.apiKey = v; save(); toast('已保存'); viewAI(); };
    $('.corr', el).onchange = (e) => { S.settings.correction = e.target.checked; save(); };
    $$('.cp', el).forEach((b) => (b.onclick = () => {
      const sc = K.aiScenarios.find((s) => s.id === b.dataset.id);
      copyText(K.buildTutorPrompt(sc, { correction: S.settings.correction }) + '\n\n（如果你在语音模式下无法显示标签，可以省略 <reply>/<feedback> 标签：先用韩语回复，再用中文简短纠错。）\n\n[시작]');
    }));
  }

  function viewAIChat(sid) {
    const sc = K.aiScenarios.find((s) => s.id === sid);
    if (!sc) { location.hash = '#ai'; return; }
    if (ARTIFACT && SAMPLE_STATE === 'pending') { setView('<div class="card muted">正在连接 Claude……</div>'); return; }
    if (!aiReady()) { toast(ARTIFACT ? '当前无法连接 Claude' : '请先设置 API Key'); location.hash = '#ai'; return; }
    const system = K.buildTutorPrompt(sc, { correction: S.settings.correction });
    // API Key 模式：助手消息保留完整 content，只追加不修改
    // 网页版（sample）：页面自己保存对话；第一条 user 消息是固定的规则
    const history = [];
    let busy = false, alive = true, autoSpeak = true, ctl = null;
    const el = setView(`<div class="eyebrow">AI 陪练 · ${esc(sc.title)}</div>
      <h1 class="page-title">${sc.icon} ${esc(sc.title)}</h1>
      <div class="scene-desc">🎬 ${esc(sc.scene)}</div>
      <div class="chat ai-chat"></div>
      <div class="composer card">
        <div class="live"></div>
        <div class="check-row">
          ${hasSR ? '<button class="btn primary mic">🎤 按一下说话</button>' : ''}
          <input type="text" class="msg" lang="ko" autocomplete="off" placeholder="${hasSR ? '或者打字……' : '点这里 → 键盘 🎤 → 说韩语'}">
          <button class="btn primary send">发送</button>
          <button class="btn ghost stop hidden">停止</button>
        </div>
        <div class="check-row small-row">
          <button class="btn small ghost hint">💡 不知道说什么（提示）</button>
          <button class="btn small ghost end">📝 结束并总评</button>
          <label class="switch"><input type="checkbox" class="auto-sp" checked> 自动朗读</label>
        </div>
      </div>`);
    const chat = $('.ai-chat', el), input = $('.msg', el), live = $('.live', el), stopBtn = $('.stop', el);
    onLeave(() => { alive = false; if (ctl) ctl.abort(); });
    $('.auto-sp', el).onchange = (e) => (autoSpeak = e.target.checked);
    stopBtn.onclick = () => { if (ctl) ctl.abort(); };

    function addUser(text) {
      if (/^\[.*\]$/.test(text)) return;
      chat.appendChild(h(`<div class="bubble me"><div class="ko" lang="ko">${esc(text)}</div></div>`));
    }
    function paint(b, raw) {
      const p = parseTutor(raw);
      $('.ko', b).textContent = p.reply || '……';
      const fb = $('.fb', b);
      if (p.feedback) { fb.classList.remove('hidden'); fb.innerHTML = '<b>纠错 / 建议</b>' + md(p.feedback); } else fb.classList.add('hidden');
      return p;
    }
    async function ask(onRaw, isSummary) {
      if (ARTIFACT) {
        // 对话太长时丢掉最早的几轮（保留规则）
        const turns = history.length > 40 ? history.slice(-40) : history;
        while (turns.length && turns[0].role !== 'user') turns.shift();
        ctl = new AbortController();
        const r = await SAMPLE([{ role: 'user', content: system }].concat(turns), {
          cache: false, signal: ctl.signal, modelTier: isSummary ? 'default' : 'quick',
          onText: ({ text }) => onRaw(text),
        });
        ctl = null;
        history.push({ role: 'assistant', content: r.text });
        return r.text;
      }
      let acc = '';
      const msg = await claude({ system, messages: history, effort: 'low', maxTokens: 4000, onText: (t) => { acc += t; onRaw(acc); } });
      history.push({ role: 'assistant', content: msg.content });
      return textOf(msg);
    }
    async function send(text) {
      if (busy || !text.trim()) return;
      busy = true; stopListen(); stopSpeak();
      stopBtn.classList.remove('hidden');
      addUser(text);
      history.push({ role: 'user', content: text });
      const b = h(`<div class="bubble them"><div class="who">${esc(sc.title)}</div><div class="ko" lang="ko"><span class="muted">${text === '[총평]' ? '正在整理总评……' : '……'}</span></div><div class="fb hidden"></div></div>`);
      chat.appendChild(b); b.scrollIntoView({ behavior: 'smooth', block: 'end' });
      try {
        const raw = await ask((t) => { if (alive) paint(b, t); }, text === '[총평]');
        if (!alive) return;
        const p = paint(b, raw);
        if (!p.reply) $('.ko', b).remove();
        if (p.reply) { b.insertBefore(speakBtn(p.reply, '▶'), $('.fb', b)); if (autoSpeak) speak(p.reply); }
        logRep();
      } catch (e) {
        ctl = null;
        if (history.length && history[history.length - 1].role === 'user') history.pop();
        if (alive) $('.ko', b).innerHTML = `<span class="err">${esc(aiErr(e))}</span>`;
      }
      busy = false;
      stopBtn.classList.add('hidden');
      if (alive) b.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    $('.send', el).onclick = () => { const v = input.value; input.value = ''; send(v); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { const v = input.value; input.value = ''; send(v); } };
    if (hasSR) $('.mic', el).onclick = async () => {
      const mic = $('.mic', el);
      if (listening) { stopListen(); return; }
      mic.classList.add('rec'); mic.textContent = '● 正在听…';
      const r = await listenOnce((t) => { live.textContent = t; }, 20000);
      mic.classList.remove('rec'); mic.textContent = '🎤 按一下说话';
      live.textContent = '';
      if (r.ok) send(r.text); else if (r.err && r.err !== 'aborted') toast(srErrMsg(r.err) || ('识别失败：' + r.err));
    };
    $('.hint', el).onclick = () => send('[힌트]');
    $('.end', el).onclick = () => send('[총평]');
    // 网页版：等用户主动开始（第一次调用会弹出授权），API Key 模式自动开场
    if (ARTIFACT) {
      const startBtn = h('<div class="card end"><p>准备好了吗？AI 会先开口，然后轮到你。</p><button class="btn primary big go">开始对话</button></div>');
      chat.appendChild(startBtn);
      $('.go', startBtn).onclick = () => { startBtn.remove(); send('[시작]'); };
    } else send('[시작]');
  }

  /* 页面内的二次确认（发布页面里浏览器 confirm() 不可用） */
  function confirmInline(anchor, message, okText, onOk) {
    const old = anchor.parentNode.querySelector('.confirm-box');
    if (old) old.remove();
    const box = h(`<div class="confirm-box card"><p>${esc(message)}</p><div class="check-row"><button class="btn primary ok">${esc(okText)}</button><button class="btn ghost no">取消</button></div></div>`);
    anchor.insertAdjacentElement('afterend', box);
    $('.ok', box).onclick = () => { box.remove(); onOk(); };
    $('.no', box).onclick = () => box.remove();
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ═════════════ 设置 ═════════════ */
  let DOWNLOADS = null;
  if (CLAUDE) CLAUDE.use('downloads').then((d) => { DOWNLOADS = d || null; }).catch(() => {});
  function viewSettings() {
    loadVoices();
    const canExport = !ARTIFACT || !!DOWNLOADS;
    const el = setView(`<h1 class="page-title">设置</h1>
      <section class="card"><h2>语音</h2>
        <label class="lbl" for="voice-sel">韩语发音人</label>
        <select class="voice" id="voice-sel">${koVoices.length ? koVoices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === S.settings.voiceURI ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('') : '<option value="">（没有找到韩语语音：请在手机/电脑的系统设置里下载韩语语音包）</option>'}</select>
        <label class="lbl" for="rate-sel">语速：<span class="rv">${S.settings.rate}</span>×</label>
        <input type="range" class="rate" id="rate-sel" min="0.6" max="1.3" step="0.05" value="${S.settings.rate}">
        <div class="check-row"><button class="btn test-voice">▶ 试听</button><button class="btn ghost reload-voices">🔄 刷新语音列表</button></div>
        <details class="voice-info small"><summary>手机里下载了语音，这里却没有？</summary>
          <p class="muted">系统现在告诉网页的韩语语音有 <b class="vc">${koVoices.length}</b> 个（全部语言共 ${allVoiceCount} 个）：</p>
          <ul class="vlist">${koVoices.map((v) => `<li><b>${esc(v.name)}</b> · ${esc(v.lang)}${v.localService === false ? ' · 在线' : ''}<br><code>${esc(v.voiceURI)}</code></li>`).join('') || '<li>（无）</li>'}</ul>
          <p class="muted">• 下载新语音后，要<b>完全关掉</b>页面（Safari 里关掉这个标签页；Claude App 里从后台划掉 App）再打开，网页才会看到新语音。<br>
          • 在 Claude App 里打开时，系统给网页的语音可能比 Safari 少。可以用 <b>Safari</b> 打开同一个链接对比一下。<br>
          • Siri 的声音和「个人声音」苹果不开放给网页，这里一定选不到。</p>
        </details>
        <label class="switch"><input type="checkbox" class="al" id="auto-listen" ${S.settings.autoListen ? 'checked' : ''}> ${hasSR ? '练习时自动开始语音识别（不用每次点 🎤）' : '练习时自动把光标放进输入框（手机上直接点键盘 🎤 就能说）'}</label>
        ${ARTIFACT
          ? '<p class="muted small">网页版用<b>手机键盘的语音输入</b>说韩语：先在系统设置里给键盘添加"韩语"，说话前把键盘切到韩语，再点 🎤。iPhone：设置 → 通用 → 键盘 → 添加新键盘 → 韩语，并打开"启用听写"。Android（Gboard）：设置 → 语言 → 添加韩语。</p>'
          : `<p class="muted small">语音识别：${hasSR ? '✅ 当前浏览器支持' : '❌ 当前浏览器不支持（推荐 Chrome / Edge / Safari）'}。需要通过 <code>http://localhost</code> 或 <code>https</code> 打开页面，并允许麦克风。</p>`}
      </section>
      ${ARTIFACT ? '' : `<section class="card"><h2>AI 陪练（Anthropic API）</h2>
        <label class="lbl" for="api-key">API Key（只保存在本机浏览器）</label>
        <div class="check-row"><input type="password" class="key" id="api-key" value="${esc(S.settings.apiKey)}" placeholder="sk-ant-..." autocomplete="off"><button class="btn save-key">保存</button><button class="btn ghost clear-key">清除</button></div>
        <label class="lbl" for="model-sel">模型</label>
        <select class="model" id="model-sel">${MODELS.map(([v, t]) => `<option value="${v}" ${v === S.settings.model ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </section>`}
      <section class="card"><h2>进度</h2>
        <p class="muted">${ARTIFACT ? (CLOUD.ready ? '✅ 进度已同步到你的 Claude 账户，换手机/电脑登录同一账户就能接着练。' : CLOUD.state === 'pending' ? '正在连接云端同步……' : '进度保存在这个浏览器里（登录 claude.ai 后打开可以同步到账户）。') : '进度只保存在这台设备的浏览器里。换设备前请导出。'}</p>
        <div class="check-row">${canExport ? '<button class="btn export">导出进度</button>' : ''}<label class="btn ghost">导入进度<input type="file" accept=".json,application/json" class="import" id="import-file" hidden></label><button class="btn danger reset">重置全部进度</button></div>
      </section>`);
    $('.voice', el).onchange = (e) => { S.settings.voiceURI = e.target.value; save(); };
    $('.rate', el).oninput = (e) => { S.settings.rate = +e.target.value; $('.rv', el).textContent = e.target.value; save(); };
    $('.test-voice', el).onclick = () => speak('안녕하세요. 오늘도 같이 열심히 말해 봐요!');
    $('.reload-voices', el).onclick = () => {
      // iOS 有时要先"说"一次才会把完整的语音列表交给网页
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
      setTimeout(() => { loadVoices(); viewSettings(); toast('找到 ' + koVoices.length + ' 个韩语语音'); }, 600);
    };
    $('.al', el).onchange = (e) => { S.settings.autoListen = e.target.checked; save(); };
    if (!ARTIFACT) {
      $('.save-key', el).onclick = () => { S.settings.apiKey = $('.key', el).value.trim(); save(); toast('已保存'); };
      $('.clear-key', el).onclick = () => { S.settings.apiKey = ''; $('.key', el).value = ''; save(); toast('已清除'); };
      $('.model', el).onchange = (e) => { S.settings.model = e.target.value; save(); };
    }
    const exp = $('.export', el);
    if (exp) exp.onclick = async () => {
      const data = JSON.stringify(Object.assign({}, S, { settings: Object.assign({}, S.settings, { apiKey: '' }) }), null, 2);
      const filename = `korean-speaking-progress-${today()}.json`;
      if (ARTIFACT) {
        try { const r = await DOWNLOADS.save({ filename, data }); if (r && r.status === 'saved') toast('已导出'); }
        catch (err) { if (!err || err.code !== 'declined') toast('导出失败'); }
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = filename; a.click();
    };
    $('.import', el).onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((t) => {
        try { const o = JSON.parse(t); const key = S.settings.apiKey; S = Object.assign(defaults(), o); S.settings = Object.assign(defaults().settings, o.settings || {}, { apiKey: key }); save(); toast('导入成功'); route(); }
        catch (err) { toast('文件格式不对'); }
      });
    };
    const rs = $('.reset', el);
    rs.onclick = () => confirmInline(rs.closest('.check-row'), '确定要清空全部学习进度吗？此操作不可撤销。', '清空进度', () => {
      const key = S.settings.apiKey; S = defaults(); S.settings.apiKey = key; save(); toast('已重置'); location.hash = '#home';
    });
  }

  /* ═════════════ 启动 ═════════════ */
  window.addEventListener('hashchange', route);
  function boot() {
    route();
    const b = $('#banner');
    if (b && ARTIFACT) {
      b.innerHTML = '📱 网页版：说韩语时点输入框，用<b>键盘上的 🎤 语音输入</b>，说完自动打分。';
      b.classList.remove('hidden');
    } else if (b && !hasSR) {
      b.innerHTML = '⚠️ 当前浏览器不支持韩语语音识别，开口打分功能不可用（可以打字检查或自己对照）。推荐用 Chrome / Edge 打开。';
      b.classList.remove('hidden');
    }
    initCloud();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // 调试/测试用
  window.__kss = { state: () => S, dayInfo, bestScore, diffHtml, UNITS, SCENES, TOTAL_DAYS, sino, native, NUM_TYPES };
})();
