// 从 app/data 生成可打印/离线阅读的 Markdown 讲义：node scripts/build-docs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKSS } from './load-data.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = loadKSS();
const ORDER = K.unitOrder || [];
const ordIdx = (u) => { const i = ORDER.indexOf(u.id); return i < 0 ? 1e6 + (+u.id.slice(1)) : i; };
const ALL = K.units.slice().sort((a, b) => a.week - b.week || ordIdx(a) - ordIdx(b));
const lessonNo = (u) => String(ALL.indexOf(u) + 1).padStart(2, '0');
const out = path.join(root, 'lessons');
fs.mkdirSync(out, { recursive: true });
const cell = (s) => String(s || '').replace(/\|/g, '\\|');
const BANNER = '<!-- 本文件由 scripts/build-docs.mjs 从 app/data 自动生成，请修改数据文件后重新生成 -->\n\n';

// 每周讲义
for (const w of K.weeks) {
  const units = ALL.filter((u) => u.week === w.week);
  const base = (w.week - 1) * 7;
  let md = BANNER + `# 第 ${w.week} 周：${w.title}\n\n> ${w.goal}\n\n`;
  md += `| 天 | 内容 |\n|---|---|\n`;
  units.forEach((u, i) => { md += `| 第 ${base + i + 1} 天 | 第 ${lessonNo(u)} 课 · ${u.title}（${u.ko}） |\n`; });
  md += `| 第 ${base + 6} 天 | 复习 + 现实任务 |\n| 第 ${base + 7} 天 | 周测 + 本周复盘 |\n\n`;
  for (const u of units) {
    md += `---\n\n## 第 ${lessonNo(u)} 课　${u.title}　<small>${u.ko}</small>\n\n${u.goal}\n\n`;
    md += `### ① 核心句块（每句跟读 3 遍，再遮住韩语看中文说）\n\n| # | 韩语 | 中文 | 要点 |\n|---|---|---|---|\n`;
    u.chunks.forEach((c, i) => { md += `| ${i + 1} | ${cell(c[0])} | ${cell(c[1])} | ${cell(c[2])} |\n`; });
    md += `\n### ② 情景对话：${u.dialogue.scene}\n\n你扮演：**${u.dialogue.roles[u.dialogue.me]}**（两个角色都要练）\n\n`;
    for (const [r, ko, zh] of u.dialogue.lines) md += `- **${u.dialogue.roles[r]}**：${ko}  \n  <sub>${zh}</sub>\n`;
    md += `\n### ③ 句型快反：${u.drill.pattern}\n\n> ${u.drill.tip}\n\n| 提示（5秒内开口） | 参考答案 |\n|---|---|\n`;
    for (const [cue, ko] of u.drill.items) md += `| ${cell(cue)} | ${cell(ko)} |\n`;
    md += `\n### ④ 独白任务（录音 ${u.mission.seconds >= 120 ? Math.round(u.mission.seconds / 60) + ' 分钟' : u.mission.seconds + ' 秒'}）\n\n${u.mission.prompt}\n\n可用表达：${u.mission.hints.map((x) => '`' + x + '`').join('　')}\n\n`;
  }
  md += `---\n\n## 第 ${base + 6} 天：现实任务（必须在真实世界完成）\n\n${w.realMissions.map((m) => `- [ ] ${m}`).join('\n')}\n\n`;
  md += `## 第 ${base + 7} 天：周测（每题录音，不看提示）\n\n${w.test.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`;
  md += `自评（各 1–5 分）：流利度 ___　准确度 ___　自然度 ___　反应速度 ___\n\n`;
  md += `**本周复盘**：写下这周最常卡壳的 3 句、最想记住的 3 个表达、下周要改的 1 个坏习惯。\n`;
  fs.writeFileSync(path.join(out, `week-${w.week}.md`), md);
}

// 情景对话库
{
  let md = BANNER + `# 情景对话库（${K.scenes.length} 个日常场景）\n\n课程之外的日常生活全场景。每个都先听、再跟读、再分角色扮演。App 里「情景库」可以直接角色扮演并打分。\n\n`;
  const catOrder = K.sceneCatOrder || [];
  const cats = catOrder.concat([...new Set(K.scenes.map((s) => s.cat))].filter((c) => !catOrder.includes(c))).filter((c) => K.scenes.some((s) => s.cat === c));
  const SC = K.scenes.slice().sort((a, b) => cats.indexOf(a.cat) - cats.indexOf(b.cat) || (+a.id.slice(1)) - (+b.id.slice(1)));
  const no = (s) => String(SC.indexOf(s) + 1).padStart(3, '0');
  md += cats.map((c) => { const ss = SC.filter((s) => s.cat === c); return `- **${c}**（${no(ss[0])}–${no(ss[ss.length - 1])}）：${ss.map((s) => s.title).join('、')}`; }).join('\n') + '\n\n';
  for (const c of cats) {
    md += `---\n\n## ${c}\n\n`;
    for (const s of SC.filter((x) => x.cat === c)) {
      md += `### ${no(s)}. ${s.title}\n\n`;
      for (const [r, ko, zh] of s.lines) md += `- **${s.roles[r]}**：${ko}  \n  <sub>${zh}</sub>\n`;
      md += '\n';
    }
  }
  fs.writeFileSync(path.join(out, 'scenes.md'), md);
}

// 功能句库
{
  const n = K.phrasebank.reduce((a, c) => a + c.items.length, 0);
  let md = BANNER + `# 功能句库（${n} 句）\n\n按交际功能分类。日常对话 90% 的句子都由这些"零件"组成。用法：遮住左栏，看中文说韩语。\n\n`;
  for (const c of K.phrasebank) {
    md += `## ${c.cat}\n\n| 韩语 | 中文 | 备注 |\n|---|---|---|\n`;
    for (const it of c.items) md += `| ${cell(it[0])} | ${cell(it[1])} | ${cell(it[2])} |\n`;
    md += '\n';
  }
  fs.writeFileSync(path.join(out, 'phrasebank.md'), md);
}

// 发音
{
  let md = BANNER + `# 发音急救（${K.pronunciation.length} 条音变规则）\n\n口语里"听不懂"和"说了对方听不懂"，一大半是音变问题。\n\n`;
  for (const r of K.pronunciation) {
    md += `## ${r.title}\n\n${r.rule}\n\n| 拼写 | 实际发音 | 意思 |\n|---|---|---|\n`;
    for (const e of r.examples) md += `| ${cell(e[0])} | ${cell(e[1])} | ${cell(e[2])} |\n`;
    md += `\n例句：**${r.sentence[0]}**　${r.sentence[1]}　（${r.sentence[2]}）\n\n`;
  }
  fs.writeFileSync(path.join(out, 'pronunciation.md'), md);
}

// 短文跟读
{
  let md = BANNER + `# 短文跟读（${K.shadowing.length} 篇 1 分钟独白）\n\n影子跟读四步：① 先听全文 ② 逐句跟读，模仿语调和停顿 ③ 遮住韩语只看中文说 ④ 什么都不看，用自己的话复述全文。\n\n`;
  for (const p of K.shadowing) {
    md += `## ${p.id.slice(1)}. ${p.title}　<small>${p.ko} · 难度 ${p.level}</small>\n\n`;
    md += p.sentences.map(([ko, zh]) => `> ${ko}  \n> <sub>${zh}</sub>`).join('\n>\n') + '\n\n';
  }
  fs.writeFileSync(path.join(out, 'shadowing.md'), md);
}

// 百问百答
{
  const n = K.qa.reduce((a, c) => a + c.items.length, 0);
  let md = BANNER + `# 百问百答：韩国人最常问你的 ${n} 个问题\n\n用法：遮住参考回答，听（读）问题后 5 秒内用自己的情况回答 → 对照参考回答 → 跟读 → 改成你自己的版本再说一遍。\n\n`;
  for (const c of K.qa) {
    md += `## ${c.cat}\n\n| 问题 | 参考回答 |\n|---|---|\n`;
    for (const [q, qzh, a, azh] of c.items) md += `| ${cell(q)}<br><sub>${cell(qzh)}</sub> | ${cell(a)}<br><sub>${cell(azh)}</sub> |\n`;
    md += '\n';
  }
  fs.writeFileSync(path.join(out, 'qa.md'), md);
}

// 专项练习：语体转换 + 听辨
{
  let md = BANNER + `# 专项练习\n\n## 语体转换（${K.styles.length} 句 × 3 种语体）\n\n遮住右边三栏，看中文依次说出 해요体 → 반말 → 합니다体。\n\n| 中文 | 해요体 | 반말 | 합니다体 |\n|---|---|---|---|\n`;
  for (const [zh, a, b, c] of K.styles) md += `| ${cell(zh)} | ${cell(a)} | ${cell(b)} | ${cell(c)} |\n`;
  md += `\n## 听辨练习（${K.pairs.length} 组易混音）\n\n请别人随机读一个，你来猜；或者自己录音回听，确认自己能读出区别。\n\n`;
  for (const g of K.pairs) md += `- **${g.title}**：${g.items.map(([w, z]) => `${w}（${z}）`).join(' · ')}\n`;
  md += `\n## 数字快练\n\n数字题是 App 里随机生成的（价格、时间、日期、电话、年龄、个数、房号、年份）。规则速记：\n\n- **汉字词**（일 이 삼 사…）：钱、日期、分钟、电话、楼层、房号、年份\n- **固有词**（한 두 세 네…）：几点、个数、年龄\n- 6월 = 유월，10월 = 시월；20 + 量词 = 스무；电话里 0 = 공，"-" = 에\n`;
  fs.writeFileSync(path.join(out, 'drills.md'), md);
}

// AI 陪练提示词
{
  let md = BANNER + `# AI 陪练提示词\n\n没有 API Key 也能用：把下面任意一段提示词完整复制，粘贴到 Claude App（或网页版）的新对话里，然后打开**语音模式**直接说韩语。\n\n> 语音模式下如果它不输出 \`<reply>\`/\`<feedback>\` 标签也没关系，你也可以加一句"语音模式下先用韩语回复，再用中文简短纠错"。\n\n`;
  md += `**指令：** \`[시작]\` 开始对话 · \`[힌트]\` 不知道说什么时要提示 · \`[총평]\` 结束并要总评\n\n`;
  for (const sc of K.aiScenarios) {
    md += `## ${sc.icon} ${sc.title}\n\n\`\`\`text\n${K.buildTutorPrompt(sc, { correction: true })}\n\n[시작]\n\`\`\`\n\n`;
  }
  md += `## 📝 独白 / 周测批改\n\n\`\`\`text\n${K.buildGradePrompt()}\n\n【口语任务】\n（粘贴任务）\n\n【我的口语转写】\n（粘贴你说的内容）\n\`\`\`\n`;
  fs.writeFileSync(path.join(out, 'ai-prompts.md'), md);
}
console.log('✓ 已生成 lessons/*.md');
