import json, re, sys
old = json.load(open(sys.argv[1], encoding='utf-8'))
new = json.load(open(sys.argv[2], encoding='utf-8'))
out = sys.argv[3]
POS = {'명사': '名', '동사': '动', '형용사': '形', '부사': '副', '대명사': '代', '수사': '数', '관형사': '冠', '감탄사': '感',
       '의존 명사': '依', '보조 동사': '补动', '보조 형용사': '补形', '품사 없음': '', '조사': '助'}
LV = {'초급': 1, '중급': 2, '고급': 3}
bad = lambda r: r['pos'] in ('접사', '조사', '어미') or r['w'].startswith('-') or r['w'].endswith('-')
key = lambda w: re.sub(r'[\s\-^]', '', w)
old_keys = {key(r['w']) for r in old if not bad(r)}
def zh_of(r):
    parts = []
    for s in r['senses'][:3]:
        z = (s.get('zh') or '').strip()
        if not z or '无对应' in z:
            z = (s.get('zhdef') or '').strip().rstrip('。')
            if len(z) > 24: z = z[:24] + '…'
        z = z.replace(',', '，').replace(';', '；').strip('，； ')
        if z and z not in parts: parts.append(z)
        if len('；'.join(parts)) > 22: break
    return '；'.join(parts)
def ex_of(r):
    for s in r['senses'][:2]:
        for e in s.get('ex') or []:
            e = e.strip()
            if 6 <= len(e) <= 70: return e
    return ''
words = {}
for r in new:
    if bad(r): continue
    k = key(r['w'])
    if not k: continue
    lv = LV[r['lv']]
    if lv == 3 and k not in old_keys: continue   # 2026 年扩充的"高级"太多，只保留经典学习词表里的
    if lv <= 2 or k in old_keys:
        z = zh_of(r)
        if not z: continue
        e = words.get(k)
        item = {'ko': r['w'].replace('^', ' ').replace('-', ''), 'hj': re.sub(r'[가-힣]', '', (r.get('origin') or '')).strip(), 'pos': POS.get(r['pos'], ''), 'zh': z, 'lv': lv, 'ex': ex_of(r)}
        if not e: words[k] = item
        else:  # 同形词合并
            if item['zh'] not in e['zh'] and len(e['zh']) < 30: e['zh'] += '；' + item['zh']
            if item['pos'] and item['pos'] not in e['pos'].split('·'): e['pos'] = '·'.join(x for x in [e['pos'], item['pos']] if x)
            if item['hj'] and item['hj'] not in e['hj'].split('/'): e['hj'] = '/'.join(x for x in [e['hj'], item['hj']] if x)
            e['lv'] = min(e['lv'], lv)
            if not e['ex']: e['ex'] = item['ex']
rows = sorted(words.values(), key=lambda x: (x['lv'], x['ko']))
lines = ['/* 韩语口语特训 · 学习词汇（国立国语院《韩国语基础词典》）',
         ' * 来源：국립국어원 한국어기초사전 krdict.korean.go.kr（数据经 github.com/spellcheck-ko/korean-dict-nikl 获取）',
         ' * 许可：CC BY-SA 2.0 KR（署名—相同方式共享）。本文件为其衍生数据，同样按 CC BY-SA 2.0 KR 提供。',
         ' * 范围：2019 年版学习者分级词表（初级/中级/高级）+ 2026 年版初级、中级词汇；中文释义取词典自带的中文对应词。',
         ' * 格式：[韩语, 汉字/原词, 词性, 中文, 等级(1 初级 / 2 中级 / 3 高级), 词典例句]',
         ' */', 'window.KSS = window.KSS || {};', 'KSS.vocabNikl = [']
for x in rows:
    lines.append('  ' + json.dumps([x['ko'], x['hj'], x['pos'], x['zh'], x['lv'], x['ex']], ensure_ascii=False) + ',')
lines.append('];')
open(out, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
from collections import Counter
print('words', len(rows), Counter(x['lv'] for x in rows), 'with ex', sum(1 for x in rows if x['ex']))
import random; random.seed(7)
for x in random.sample(rows, 15): print(' ', x)
