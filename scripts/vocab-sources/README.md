# 单词库的来源与重新生成

| 文件 | 来源 | 许可 |
|---|---|---|
| `app/data/vocab-nikl.js` | 国立国语院《韩国语基础词典》（krdict.korean.go.kr），经 github.com/spellcheck-ko/korean-dict-nikl 获取：2019 年版学习者分级词表 + 2026 年版初级、中级词汇，中文释义取词典自带的中文对应词 | CC BY-SA 2.0 KR（本衍生数据同样按此许可提供） |
| `app/data/vocab-topik.js` | 《完全掌握·新韩国语能力考试 TOPIK 必备单词》正序版词汇表（金龙一著，华东理工大学出版社） | 出版社声明：仅限个人学习等非商业用途 |
| `app/data/vocab-daily.js` | 本项目整理的课程对话生活词汇 | 同本项目 |

重新生成 `vocab-nikl.js`（需要先下载两版词典 XML）：

```bash
python3 scripts/vocab-sources/krdict_extract.py <2026年版XML目录> krdict2026.json
python3 scripts/vocab-sources/build_nikl.py <2019年版分级词表.json> krdict2026.json app/data/vocab-nikl.js
node scripts/build-vocab.mjs   # 重新给所有单词找课程例句
```

`build_nikl.py` 的第一个参数是 2019 年版词典里 初级/中级/高级 分级词条导出的 JSON（字段同 `krdict_extract.py` 的输出）。
