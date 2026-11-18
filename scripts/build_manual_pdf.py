#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 docs/录制手册.md 渲染成适合打印／屏幕阅读的操作手册 HTML。

与技术文档（宋体、学术版式）不同，这份是「照着做」的教程：
无衬线标题、更大的表格、彩色提示框、可勾选的复选框。

用法：
    python scripts/build_manual_pdf.py          # 生成 docs/录制手册.html
"""
import importlib.util
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "docs", "录制手册.md")
OUT = os.path.join(ROOT, "docs", "录制手册.html")

TITLE = "演示视频录制完整教程"
SUBTITLE = "低卡轻食点餐系统 · 2026 第九届传智杯 AI 创新应用挑战赛 · B 组"

CSS = """
@page { size: A4; margin: 18mm 16mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
  font-size: 10.5pt; line-height: 1.72; color: #1f2937; margin: 0;
}
h1, h2, h3 { line-height: 1.35; }

h1 {
  font-size: 21pt; font-weight: 700; color: #163A2A;
  margin: 0 0 4pt; letter-spacing: .5px;
}
.sub {
  font-size: 10pt; color: #6b7280; margin-bottom: 6pt;
}
.rule { height: 4px; background: linear-gradient(90deg, #22A06B, #63D8A4 60%, #EAF7F0);
  border-radius: 2px; margin: 10pt 0 14pt; }

h2 {
  font-size: 14.5pt; font-weight: 700; color: #163A2A;
  margin: 20pt 0 9pt; padding: 6pt 0 6pt 10pt;
  border-left: 4px solid #22A06B; background: #F5FAF7;
  page-break-after: avoid;
}
h3 {
  font-size: 12pt; font-weight: 700; color: #1E7A52;
  margin: 15pt 0 7pt; page-break-after: avoid;
}
p { margin: 0 0 7pt; text-align: justify; }

ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
li { margin-bottom: 3.5pt; }
li > ul, li > ol { margin-top: 3pt; margin-bottom: 3pt; }

table {
  width: 100%; border-collapse: collapse; margin: 8pt 0 12pt;
  font-size: 9.5pt; page-break-inside: auto;
}
th {
  background: #EAF7F0; color: #163A2A; font-weight: 700;
  text-align: left; padding: 5.5pt 7pt; border: 1px solid #CFE9DC;
}
td { padding: 5pt 7pt; border: 1px solid #DDE8E2; vertical-align: top; }
tr:nth-child(even) td { background: #FBFDFC; }

.quote {
  background: #F2FBF6; border-left: 3px solid #22A06B;
  padding: 8pt 11pt; margin: 9pt 0 12pt; border-radius: 0 6px 6px 0;
  font-size: 10pt; color: #14532d;
}
.quote p { margin: 0; }

pre {
  background: #F6F8F7; border: 1px solid #E2EAE5; border-radius: 6px;
  padding: 8pt 10pt; margin: 7pt 0 11pt; overflow-wrap: break-word;
  page-break-inside: avoid;
}
code {
  font-family: "Consolas", "Courier New", monospace;
  font-size: 9pt; background: #F1F5F3; padding: .5pt 3pt; border-radius: 3px;
  color: #0f5132;
}
pre code { background: none; padding: 0; color: #1f2937; font-size: 8.8pt; line-height: 1.6; }

blockquote, .check { color: #374151; }
.chk { font-size: 11pt; letter-spacing: .5px; }
strong { color: #111827; }
"""


def load_converter():
    path = os.path.join(HERE, "build_prompt_book.py")
    spec = importlib.util.spec_from_file_location("bpb_manual", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decorate(body):
    """把 - [ ] / - [x] 渲染成可打印的方框。"""
    body = body.replace("<li>[ ] ", '<li class="chk"><span class="chk">&#9744;</span> ')
    body = body.replace("<li>[x] ", '<li class="chk"><span class="chk">&#9745;</span> ')
    body = body.replace("<li>[X] ", '<li class="chk"><span class="chk">&#9745;</span> ')
    return body


def main():
    if not os.path.exists(SRC):
        print("缺少源文件:", SRC)
        return 1
    mod = load_converter()
    with io.open(SRC, encoding="utf-8") as f:
        md = f.read()

    # 顶部标题由 HTML 头提供，去掉 Markdown 自己的一级标题，避免重复
    md = re.sub(r"^\s*#\s+.*?\n", "", md, count=1)
    body = decorate(mod.convert(md))

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<h1>{title}</h1>
<div class="sub">{subtitle}</div>
<div class="rule"></div>
{body}
</body>
</html>
""".format(title=TITLE, subtitle=SUBTITLE, css=CSS, body=body)

    with io.open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print("written:", OUT, len(html), "chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
