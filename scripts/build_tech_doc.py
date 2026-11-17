#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 docs/tech-doc.md 渲染成通用技术文档版式的 HTML。

版式取中文技术文档的通用约定：宋体小四正文、1.5 倍行距、首行缩进 2 字符、
黑体标题、A4 页面、Word 默认页边距（上下 2.54cm / 左右 3.17cm）。
Markdown 解析复用 build_prompt_book.py 里的转换器，保证与其它材料一致。

用法：
    python scripts/build_tech_doc.py            # 生成 docs/tech-doc.html
"""
import html as H
import importlib.util
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "docs", "tech-doc.md")
OUT = os.path.join(ROOT, "docs", "tech-doc.html")

DOC = {
    "title": "低卡轻食点餐系统 技术文档",
    "subtitle": "微信小程序 + H5 + 零依赖 Node 服务",
    "project": "dika-light-meal-miniprogram",
    "author": "张晨",
    "school": "黄淮学院",
    "group": "B 组",
    "student_id": "2434160225",
    "date": "2026 年 11 月",
    "version": "v3.0",
}

# 通用技术文档版式（中文排版约定：正文宋体小四 12pt，行距 1.5，标题黑体）
CSS = """
@page { size: A4; margin: 25.4mm 31.7mm; }
* { box-sizing: border-box; }
body {
  font-family: "SimSun", "Songti SC", "宋体", serif;
  font-size: 12pt; line-height: 1.5; color: #000; margin: 0;
}
p { margin: 0 0 6pt; text-indent: 2em; text-align: justify; }
h1 {
  font-family: "SimHei", "Heiti SC", "黑体", sans-serif;
  font-size: 16pt; font-weight: 700; margin: 20pt 0 10pt;
  page-break-after: avoid; text-indent: 0;
}
h2 {
  font-family: "SimHei", "Heiti SC", "黑体", sans-serif;
  font-size: 14pt; font-weight: 700; margin: 14pt 0 7pt;
  page-break-after: avoid; text-indent: 0;
}
h3 {
  font-family: "SimHei", "Heiti SC", "黑体", sans-serif;
  font-size: 12pt; font-weight: 700; margin: 11pt 0 5pt;
  page-break-after: avoid; text-indent: 0;
}
ul, ol { margin: 3pt 0 7pt 2.2em; padding: 0; }
li { margin: 2pt 0; text-align: justify; }
table {
  width: 100%; border-collapse: collapse; margin: 6pt 0 10pt;
  font-size: 10.5pt; page-break-inside: avoid;
}
th, td { border: 0.5pt solid #000; padding: 4pt 6pt; vertical-align: top; text-align: left; }
th { background: #f2f2f2; font-family: "SimHei", "黑体", sans-serif; font-weight: 700; }
pre {
  font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; line-height: 1.45;
  background: #f7f7f7; border: 0.5pt solid #bbb; padding: 6pt 8pt; margin: 5pt 0 9pt;
  white-space: pre-wrap; word-break: break-all; page-break-inside: avoid;
}
pre code { font-size: 9.5pt; }
code { font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; }
.quote {
  border-left: 2pt solid #888; background: #fafafa; padding: 4pt 9pt;
  margin: 5pt 0 9pt; font-size: 11pt;
}
.quote p { text-indent: 0; margin: 0; }

/* 封面 */
.cover { text-align: center; page-break-after: always; padding-top: 60mm; }
.cover .kicker { font-family: "SimHei", "黑体", sans-serif; font-size: 12pt; letter-spacing: 1pt; margin-bottom: 26mm; }
.cover .title { font-family: "SimHei", "黑体", sans-serif; font-size: 26pt; font-weight: 700; letter-spacing: 2pt; margin: 0 0 8pt; }
.cover .subtitle { font-size: 13pt; margin-bottom: 40mm; }
.cover .meta { font-size: 12pt; line-height: 2.1; }
.cover .meta b { font-family: "SimHei", "黑体", sans-serif; font-weight: 700; display: inline-block; width: 68pt; text-align: right; margin-right: 10pt; }

/* 文档信息与目录 */
.front { page-break-after: always; }
.front h1 { font-size: 15pt; margin-top: 0; }
.toc { font-size: 9.5pt; line-height: 1.35; }
.toc .l1 { font-family: "SimHei", "黑体", sans-serif; font-weight: 700; margin-top: 2pt; }
.toc .l2 { margin-left: 1.8em; }
"""


def load_converter():
    spec = importlib.util.spec_from_file_location(
        "bpb", os.path.join(HERE, "build_prompt_book.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_toc(body_html):
    """从渲染结果里抽 h1/h2 生成目录（不标页码，避免二次排版）。"""
    items = []
    for m in re.finditer(r"<h([12])>(.*?)</h\1>", body_html, re.S):
        level = int(m.group(1))
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        items.append('<div class="l%d">%s</div>' % (level, H.escape(text)))
    return "\n".join(items)


def main():
    if not os.path.exists(SRC):
        print("缺少源文件:", SRC)
        return 1
    mod = load_converter()
    with io.open(SRC, encoding="utf-8") as f:
        md = f.read()

    body = mod.convert(md)
    toc = build_toc(body)

    cover = """
<div class="cover">
  <div class="kicker">2026 年第九届传智杯全国大学生数智创新与 AI 应用大赛 · AI 创新应用挑战赛（个人赛）</div>
  <div class="title">{title}</div>
  <div class="subtitle">{subtitle}</div>
  <div class="meta">
    <div><b>参赛者</b>{author}</div>
    <div><b>学校</b>{school}</div>
    <div><b>组别</b>{group}</div>
    <div><b>学号</b>{student_id}</div>
    <div><b>项目</b>{project}</div>
    <div><b>日期</b>{date}</div>
  </div>
</div>
""".format(**DOC)

    info = """
<div class="front">
  <h1>文档信息</h1>
  <table>
    <tr><th style="width:22%%">项目</th><th>内容</th></tr>
    <tr><td>文档名称</td><td>%s</td></tr>
    <tr><td>作品名称</td><td>低卡轻食点餐系统（%s）</td></tr>
    <tr><td>版本</td><td>%s</td></tr>
    <tr><td>编写人</td><td>%s　%s　%s　学号 %s</td></tr>
    <tr><td>编写日期</td><td>%s</td></tr>
    <tr><td>适用范围</td><td>作品提交与评审阅读；配套材料见提交包内 00~12 号文件</td></tr>
  </table>
  <h1>版本记录</h1>
  <table>
    <tr><th style="width:14%%">版本</th><th style="width:20%%">日期</th><th>说明</th></tr>
    <tr><td>v1.0</td><td>2026-10-28</td><td>初稿：选题、方案、架构与可复现性四章</td></tr>
    <tr><td>v2.0</td><td>2026-10-30</td><td>补意图控制策略、Prompt 链、经营看板与自测</td></tr>
    <tr><td>v2.5</td><td>2026-11-17</td><td>补真实场景与上线路径、AI 响应可视化</td></tr>
    <tr><td>v3.0</td><td>2026-11-18</td><td>按通用技术文档结构重排并精简；补部署与验收章节</td></tr>
  </table>
</div>
""" % (DOC["title"], DOC["project"], DOC["version"], DOC["author"],
       DOC["school"], DOC["group"], DOC["student_id"], DOC["date"])

    toc_page = """
<div class="front">
  <h1>目　录</h1>
  <div class="toc">
%s
  </div>
</div>
""" % toc

    doc = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
        "<title>%s</title><style>%s</style></head><body>%s%s%s%s</body></html>"
        % (H.escape(DOC["title"]), CSS, cover, info, toc_page, body)
    )

    with io.open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(doc)
    print("written:", OUT, len(doc), "chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
