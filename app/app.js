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
  const UNITS = K.units.slice().sort((a, b) => a.id.localeCompare(b.id));
  const WEEKS = K.weeks.slice().sort((a, b) => a.week - b.week);
  const SCENES = (K.scenes || []).slice().sort((a, b) => a.id.localeCompare(b.id));
  const PASSAGES = (K.shadowing || []).slice();
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
    startedAt: today(),
    daysDone: {},      // { dayNumber: 'YYYY-MM-DD' }
    unitsDone: {},     // { unitId: 'YYYY-MM-DD' }
    unitSteps: {},     // { unitId: { chunks: true, dialogue: true, drill: true, mission: true } }
    missions: {},      // { 'w1-0': true }
    notes: {},         // { week: '复盘文字' }
    srs: {},           // { cardId: { due, ivl, ease, reps, lapses } }
    log: {},           // { 'YYYY-MM-DD': { sec, reps } }
    scenesDone: {},    // { sceneId: count }
    shadowDone: {},    // { passageId: 'YYYY-MM-DD' }
    settings: { rate: 1, voiceURI: '', autoListen: true, apiKey: '', model: 'claude-opus-5-5', correction: true },
  });
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const o = JSON.parse(raw), d = defaults();
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
        const o = JSON.parse(body.json), d = defaults();
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
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    koVoices = speechSynthesis.getVoices().filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith('ko'));
  }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function ttsText(t) {
    return String(t).replace(/\[.*?\]/g, '').replace(/[~～]/g, '').replace(/\s\/\s/g, ', ').replace(/—/g, ', ').replace(/↗|↘/g, '').replace(/…/g, '...');
  }
  function speak(text, rateMul) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(ttsText(text));
      u.lang = 'ko-KR';
      const v = koVoices.find((x) => x.voiceURI === S.settings.voiceURI) || koVoices.find((x) => /google|yuna|sora|heami|sunhi/i.test(x.name)) || koVoices[0];
      if (v) u.voice = v;
      u.rate = Math.max(0.4, Math.min(1.6, (rateMul || 1) * (S.settings.rate || 1)));
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
  const norm = (s) => String(s).replace(/\[.*?\]/g, '').toLowerCase().replace(/[^가-힣ㄱ-ㆎa-z0-9]/g, '');
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
  const dueIds = () => Object.keys(S.srs).filter((id) => S.srs[id].due <= today() && cardById(id));

  /* ═════════════ 课程日程 ═════════════ */
  function dayInfo(n) {
    const w = Math.ceil(n / 7), d = ((n - 1) % 7) + 1;
    const week = WEEKS[w - 1];
    if (d <= 4) return { n, w, d, week, type: 'unit', unit: UNITS[(w - 1) * 4 + d - 1], label: '新课' };
    if (d === 5) return { n, w, d, week, type: 'review', label: '复习+实战' };
    if (d === 6) return { n, w, d, week, type: 'test', label: '周测' };
    return { n, w, d, week, type: 'free', label: '自由对话' };
  }
  const dayOfUnit = (u) => { const i = UNITS.indexOf(u); return Math.floor(i / 4) * 7 + (i % 4) + 1; };
  function currentDay() { for (let n = 1; n <= TOTAL_DAYS; n++) if (!S.daysDone[n]) return n; return TOTAL_DAYS; }
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
      scenes: viewScenes, scene: viewScene, phrases: viewPhrases, pron: viewPron, shadow: viewShadow,
      ai: viewAI, prefs: viewSettings,
    };
    markNav(name === 'unit' || name === 'day' ? 'units' : name === 'scene' ? 'scenes' : name);
    (R[name] || viewHome).call(null, arg);
    updateHeaderStats();
  }

  /* ═════════════ 首页 ═════════════ */
  function viewHome() {
    const n = currentDay(), info = dayInfo(n);
    const due = dueIds().length;
    const doneCount = Object.keys(S.daysDone).length;
    const todayTitle = info.type === 'unit' ? `${info.unit.title}` : info.type === 'review' ? '复习 + 现实任务' : info.type === 'test' ? `第 ${info.w} 周周测` : '自由对话日（AI / 真人）';
    let grid = '';
    for (let w = 1; w <= WEEKS.length; w++) {
      grid += `<div class="wk"><div class="wk-l">W${w}</div>`;
      for (let d = 1; d <= 7; d++) {
        const dn = (w - 1) * 7 + d, di = dayInfo(dn);
        const cls = S.daysDone[dn] ? 'done' : dn === n ? 'now' : '';
        const icon = di.type === 'unit' ? d : di.type === 'review' ? '复' : di.type === 'test' ? '测' : '聊';
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
        <h2>${WEEKS.length} 周路线图</h2>
        <p class="muted small">数字 = 新课，复 = 复习+现实任务，测 = 周测，聊 = 自由对话。点任意一天都能进去练。</p>
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
            <span class="u-no">${u.id.slice(1)}</span>
            <span class="u-t"><b>${esc(u.title)}</b><small>${esc(u.ko)}</small></span>
            <span class="u-s">${S.unitsDone[u.id] ? '✅' : '›'}</span></a>`).join('')}
          <a class="unit-item extra" href="#day-${(w.week - 1) * 7 + 5}"><span class="u-no">复</span><span class="u-t"><b>复习 + 现实任务</b></span><span class="u-s">${S.daysDone[(w.week - 1) * 7 + 5] ? '✅' : '›'}</span></a>
          <a class="unit-item extra" href="#day-${(w.week - 1) * 7 + 6}"><span class="u-no">测</span><span class="u-t"><b>周测</b></span><span class="u-s">${S.daysDone[(w.week - 1) * 7 + 6] ? '✅' : '›'}</span></a>
          <a class="unit-item extra" href="#day-${(w.week - 1) * 7 + 7}"><span class="u-no">聊</span><span class="u-t"><b>自由对话日</b></span><span class="u-s">${S.daysDone[(w.week - 1) * 7 + 7] ? '✅' : '›'}</span></a>
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
      el = setView(`${head}<h1 class="page-title">第 ${info.w} 周周测</h1>
        <section class="card"><p>每道题都<b>录音</b>，不看任何提示，一口气说完。用 AI 批改，或者自己回听后按下面的标准打分。</p>
        <div class="rubric"><b>自评标准（每项 1–5 分）</b>：流利度（停顿是否超过 3 秒）· 准确度（语法、敬语）· 自然度（像不像韩国人说话）· 任务完成度</div></section>
        <div class="tests"></div>
        <section class="card"><h2>本周自评</h2>
          <div class="selfscore">${['流利度', '准确度', '自然度', '反应速度'].map((k, i) => `<label>${k} <input type="range" min="1" max="5" value="${(S.notes['score' + info.w] || [])[i] || 3}" data-i="${i}"><span>${(S.notes['score' + info.w] || [])[i] || 3}</span></label>`).join('')}</div>
        </section>${doneBtn}`);
      const box = $('.tests', el);
      info.week.test.forEach((t, i) => { const r = recorder(`第 ${i + 1} 题：${t}`, { seconds: 90 }); box.appendChild(r); onLeave(r.cleanup); });
      $$('.selfscore input', el).forEach((r) => (r.oninput = () => {
        const arr = S.notes['score' + info.w] || [3, 3, 3, 3]; arr[+r.dataset.i] = +r.value; S.notes['score' + info.w] = arr; save();
        r.nextElementSibling.textContent = r.value;
      }));
    } else {
      const recs = K.aiScenarios.filter((s) => ({ 1: ['free-jon', 'friend-new'], 2: ['cafe', 'restaurant', 'taxi'], 3: ['friend-new', 'coworker'], 4: ['free-ban'], 5: ['professor', 'senior', 'phone'], 6: ['free-jon', 'interview'], 7: ['realestate', 'doctor', 'phone'], 8: ['halmeoni', 'date', 'complaint'], 9: ['parents', 'free-jon'], 10: ['debate', 'friend-new'], 11: ['classmate', 'secondhand', 'complaint'], 12: ['interview-hard', 'busan', 'free-ban'] }[info.w] || ['free-jon']).includes(s.id));
      el = setView(`${head}<h1 class="page-title">自由对话日</h1>
        <section class="card"><p>今天不学新东西。<b>至少 20 分钟</b>不间断的对话：首选真人（语言交换、韩国朋友、店员闲聊），没有真人就用 AI 陪练。把这周学的句块全部用出来。</p>
          <h3>推荐的 AI 陪练情景</h3>
          <div class="scn-grid">${recs.map((s) => `<a class="scn" href="#ai-${s.id}"><span class="i">${s.icon}</span><b>${esc(s.title)}</b></a>`).join('')}</div>
          <p class="muted small">没有 API Key？到「AI 陪练」页复制提示词，粘贴到 Claude App 里开启语音对话，效果一样。</p>
        </section>
        <section class="card"><h2>本周复盘</h2>
          <p class="muted">写下：这周最常卡壳的3句话、最想记住的3个表达、下周要改的1个坏习惯。</p>
          <textarea class="note" rows="6" placeholder="例：1. 点单时不会说"少冰"→ 얼음 적게 주세요 …">${esc(S.notes[info.w] || '')}</textarea>
        </section>${doneBtn}`);
      const ta = $('.note', el);
      ta.oninput = () => { S.notes[info.w] = ta.value; save(); };
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
      <div class="eyebrow">第 ${n} 天 · 第 ${u.week} 周 · 第 ${u.id.slice(1)} 课</div>
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
    $$('.sline', script).forEach((s, i) => { s.onclick = () => speak(dlg.lines[i][1]); });
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
    const cats = Array.from(new Set(SCENES.map((s) => s.cat)));
    const sel = cat != null && cats[+cat] ? cats[+cat] : '';
    const list = SCENES.filter((s) => !sel || s.cat === sel);
    setView(`<h1 class="page-title">情景对话库 <small>${SCENES.length} 个日常场景</small></h1>
      <div class="tip card">课程之外的日常生活全场景：健身房、洗衣店、搬家、外卖、市场砍价、入境、失物、面试、开会、请假、KTV、汗蒸房、牙科、119……每个都能角色扮演。</div>
      <div class="chips filter"><a class="chip ${!sel ? 'on' : ''}" href="#scenes">全部</a>${cats.map((c, ci) => `<a class="chip ${sel === c ? 'on' : ''}" href="#scenes-${ci}">${esc(c)}</a>`).join('')}</div>
      <div class="unit-list">${list.map((s) => `<a class="unit-item ${S.scenesDone[s.id] ? 'done' : ''}" href="#scene-${s.id}">
        <span class="u-no">${esc(s.id.slice(1))}</span><span class="u-t"><b>${esc(s.title)}</b><small>${esc(s.cat)} · 你扮演 ${esc(s.roles[s.me])}</small></span>
        <span class="u-s">${S.scenesDone[s.id] ? '✅' : '›'}</span></a>`).join('')}</div>`);
  }
  function viewScene(id) {
    const s = SCENES.find((x) => x.id === id) || SCENES[0];
    const i = SCENES.indexOf(s);
    const el = setView(`<div class="eyebrow">情景库 · ${esc(s.cat)}</div><h1 class="page-title">${esc(s.title)}</h1><div class="rp"></div>
      <div class="unit-foot"><div class="nav-units">
        ${i > 0 ? `<a class="btn ghost" href="#scene-${SCENES[i - 1].id}">‹ 上一个</a>` : ''}
        <a class="btn ghost" href="#scenes">全部情景</a>
        ${i < SCENES.length - 1 ? `<a class="btn ghost" href="#scene-${SCENES[i + 1].id}">下一个 ›</a>` : ''}
      </div></div>`);
    onLeave(rolePlay($('.rp', el), { roles: s.roles, me: s.me, lines: s.lines, scene: '' }, () => { S.scenesDone[s.id] = (S.scenesDone[s.id] || 0) + 1; save(); }));
  }

  /* ═════════════ 短文跟读 ═════════════ */
  function viewShadow(pid) {
    if (pid) return viewPassage(pid);
    const levels = { 1: '入门', 2: '基础', 3: '进阶', 4: '挑战' };
    setView(`<h1 class="page-title">短文跟读 <small>${PASSAGES.length} 篇 1 分钟独白</small></h1>
      <div class="tip card">影子跟读（Shadowing）四步：① 先听全文 ② 逐句跟读，模仿语调和停顿 ③ 遮住韩语只看中文说 ④ 什么都不看，用自己的话复述全文。每篇练到能流利复述为止。</div>
      <div class="unit-list">${PASSAGES.map((p) => `<a class="unit-item ${S.shadowDone[p.id] ? 'done' : ''}" href="#shadow-${p.id}">
        <span class="u-no">${p.level}</span><span class="u-t"><b>${esc(p.title)}</b><small lang="ko">${esc(p.ko)} · ${levels[p.level] || ''} · ${p.sentences.length} 句</small></span>
        <span class="u-s">${S.shadowDone[p.id] ? '✅' : '›'}</span></a>`).join('')}</div>`);
  }
  function viewPassage(pid) {
    const p = PASSAGES.find((x) => x.id === pid) || PASSAGES[0];
    const i = PASSAGES.indexOf(p);
    const el = setView(`<div class="eyebrow">短文跟读 · 难度 ${p.level}</div>
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

  /* ═════════════ 功能句库 ═════════════ */
  function viewPhrases() {
    const pb = K.phrasebank || [];
    const count = pb.reduce((a, c) => a + c.items.length, 0);
    const el = setView(`<h1 class="page-title">功能句库 <small>${count} 句</small></h1>
      <div class="tip card">按"交际功能"分类的高频句。日常对话里 90% 的句子都由这些零件组成。点句子播放，点 🎤 开口打分。打开「遮住韩语」做中→韩自测。</div>
      <div class="toolbar"><label class="switch"><input type="checkbox" class="hide-ko"> 遮住韩语</label></div>
      <div class="chips filter">${pb.map((c, i) => `<a class="chip" href="javascript:void 0" data-i="${i}">${esc(c.cat)}</a>`).join('')}</div>
      <div class="pb"></div>`);
    const box = $('.pb', el);
    pb.forEach((c, ci) => {
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
        $('.ko', row).onclick = () => { row.classList.add('reveal'); speak(it[0]); };
        list.appendChild(row);
      });
      box.appendChild(sec);
    });
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
        <select class="voice" id="voice-sel">${koVoices.length ? koVoices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === S.settings.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('') : '<option value="">（没有找到韩语语音：请在手机/电脑的系统设置里下载韩语语音包）</option>'}</select>
        <label class="lbl" for="rate-sel">语速：<span class="rv">${S.settings.rate}</span>×</label>
        <input type="range" class="rate" id="rate-sel" min="0.6" max="1.3" step="0.05" value="${S.settings.rate}">
        <div class="check-row"><button class="btn test-voice">▶ 试听</button></div>
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
  window.__kss = { state: () => S, dayInfo, bestScore, diffHtml, UNITS, SCENES, TOTAL_DAYS };
})();
