import sys, os, json, re, glob
from lxml import etree as ET
src, out = sys.argv[1], sys.argv[2]
rows = []
for f in sorted(glob.glob(os.path.join(src, '*.xml'))):
    for ev, el in ET.iterparse(f, events=('end',), tag='LexicalEntry', recover=True, huge_tree=True, load_dtd=False, no_network=True, resolve_entities=False):
        feats = {x.get('att'): x.get('val') for x in el.findall('feat')}
        lv = feats.get('vocabularyLevel', '')
        if lv in ('초급', '중급', '고급'):
            lemma = el.find('Lemma/feat[@att="writtenForm"]')
            w = (lemma.get('val') if lemma is not None else '').strip()
            senses = []
            for s in el.findall('Sense')[:4]:
                sf = {x.get('att'): x.get('val') for x in s.findall('feat')}
                zh = zhdef = en = ''
                for e in s.findall('Equivalent'):
                    ef = {x.get('att'): x.get('val') for x in e.findall('feat')}
                    if ef.get('language') == '중국어': zh, zhdef = (ef.get('lemma') or '').strip(), (ef.get('definition') or '').strip()
                    if ef.get('language') == '영어': en = (ef.get('lemma') or '').strip()
                exs = []
                for ex in s.findall('SenseExample'):
                    fs = ex.findall('feat')
                    t = next((x.get('val') for x in fs if x.get('att') == 'type'), '')
                    vals = [x.get('val') for x in fs if x.get('att') == 'example']
                    if t == '문장' and vals: exs.append(vals[0])
                senses.append({'zh': zh, 'zhdef': zhdef, 'en': en, 'ex': exs[:1]})
            rows.append({'w': w, 'unit': feats.get('lexicalUnit', ''), 'pos': feats.get('partOfSpeech', ''), 'lv': lv, 'origin': feats.get('origin', ''), 'senses': senses})
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]
json.dump(rows, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
from collections import Counter
print('graded', len(rows), Counter(r['lv'] for r in rows))
print('pos', Counter(r['pos'] for r in rows).most_common(20))
print('unit', Counter(r['unit'] for r in rows))
nz = sum(1 for r in rows if r['senses'] and r['senses'][0]['zh'])
print('with zh sense1', nz)
