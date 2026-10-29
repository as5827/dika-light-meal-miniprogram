#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 prompts/ 下的 markdown 合成一份可打印的 HTML（供 Chromium 导出 PDF）。

只实现本项目文档用到的语法子集：标题、表格、代码块、列表、引用、粗体、行内代码、链接。
不追求完整 Markdown 兼容，够用即可。
"""
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    ("第一部分 对话快照", [
        "prompts/snapshots/01-建仓与推送排障.md",
        "prompts/snapshots/02-推荐引擎调参.md",
        "prompts/snapshots/03-大模型润色的数字约束.md",
    ]),
    ("第二部分 迭代记录", [
        "prompts/01-订单落库.md",
        "prompts/02-后台登录与鉴权.md",
        "prompts/03-订单状态驱动跟踪页.md",
        "prompts/04-小程序端与双端架构.md",
        "prompts/05-AI减脂套餐推荐.md",
        "prompts/06-运行日志与CI.md",
    ]),
    ("第三部分 归档说明", [
        "prompts/README.md",
    ]),
]


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def strip_front_matter(lines):
    return lines


def convert(md):
    lines = md.splitlines()
    out = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>")
            continue

        if stripped.startswith("|") and i + 1 < n and re.match(r"^\|[\s:|-]+\|?\s*$", lines[i + 1].strip()):
            header = [c.strip() for c in stripped.strip("|").split("|")]
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            table = ["<table><tr>" + "".join("<th>" + inline(c) + "</th>" for c in header) + "</tr>"]
            for r in rows:
                table.append("<tr>" + "".join("<td>" + inline(c) + "</td>" for c in r) + "</tr>")
            table.append("</table>")
            out.append("".join(table))
            continue

        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2)), level))
            i += 1
            continue

        if stripped.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append("<div class='quote'>" + inline(" ".join(buf)) + "</div>")
            continue

        if re.match(r"^[-*]\s+", stripped):
            out.append("<ul>")
            while i < n and re.match(r"^[-*]\s+", lines[i].strip()):
                out.append("<li>" + inline(re.sub(r"^[-*]\s+", "", lines[i].strip())) + "</li>")
                i += 1
            out.append("</ul>")
            continue

        if re.match(r"^\d+\.\s+", stripped):
            out.append("<ol>")
            while i < n and re.match(r"^\d+\.\s+", lines[i].strip()):
                out.append("<li>" + inline(re.sub(r"^\d+\.\s+", "", lines[i].strip())) + "</li>")
                i += 1
            out.append("</ol>")
            continue

        if re.match(r"^---+$", stripped):
            out.append("<hr/>")
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        out.append("<p>" + inline(stripped) + "</p>")
        i += 1

    return "\n".join(out)


CSS = """
@page { size: A4; margin: 16mm 14mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; font-size: 9.6pt; line-height: 1.75; color: #1f2328; margin: 0; }
h1 { font-size: 16pt; color: #14532d; border-bottom: 2px solid #22A06B; padding-bottom: 6px; margin: 0 0 10px; page-break-before: always; page-break-after: avoid; }
h2 { font-size: 12pt; color: #166534; margin: 14px 0 6px; page-break-after: avoid; }
h3 { font-size: 10.4pt; margin: 10px 0 4px; page-break-after: avoid; }
p { margin: 4px 0; text-align: justify; }
ul, ol { margin: 4px 0 4px 20px; padding: 0; }
li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 10px; font-size: 8.8pt; page-break-inside: avoid; }
th, td { border: 1px solid #d7dde3; padding: 4px 6px; vertical-align: top; }
th { background: #f0f7f3; color: #14532d; }
code { font-family: Consolas,monospace; font-size: 8.6pt; background: #f2f4f6; padding: 1px 3px; border-radius: 2px; }
pre { background: #f7f9fa; border: 1px solid #e3e8ec; border-left: 3px solid #22A06B; padding: 7px 9px; font-size: 8.2pt; white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
.quote { background: #f6fbf8; border-left: 3px solid #cbe7d8; padding: 6px 10px; margin: 8px 0; color: #374151; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover .k { color: #22A06B; font-weight: 600; letter-spacing: 2px; font-size: 10.5pt; }
.cover h1.t { border: none; font-size: 26pt; color: #0f2e1f; margin: 8px 0 8px; page-break-before: avoid; }
.cover .s { font-size: 12pt; color: #374151; margin-bottom: 24px; }
.cover .m { font-size: 9.4pt; color: #4b5563; line-height: 2; }
.cover .r { width: 90px; height: 3px; background: #22A06B; margin: 16px 0 20px; }
.part { font-size: 13pt; color: #166534; font-weight: 700; margin: 0 0 8px; page-break-before: always; }
"""


def main():
    parts = []
    for title, files in FILES:
        parts.append("<div class='part'>%s</div>" % html.escape(title))
        for rel in files:
            path = os.path.join(ROOT, rel)
            if not os.path.exists(path):
                parts.append("<p>（缺少文件：%s）</p>" % rel)
                continue
            with open(path, encoding="utf-8") as f:
                md = f.read()
            parts.append(convert(md))

    cover = """
<div class="cover">
  <div class="k">2026 第九届传智杯 · AI 创新应用挑战赛（个人赛）</div>
  <h1 class="t">Prompt 历史快照与迭代记录</h1>
  <div class="s">低卡轻食点餐系统 · dika-light-meal-miniprogram</div>
  <div class="r"></div>
  <div class="m">
    代码仓库：https://github.com/as5827/dika-light-meal-miniprogram<br>
    内容：3 份对话快照 + 6 份迭代记录 + 归档说明<br>
    说明：本册为对话纪要（节选），保留当时的报错、命令与判断顺序，非逐字转录。<br>
    导出：2026-10-29
  </div>
</div>
"""

    html_doc = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
        "<title>Prompt 历史快照与迭代记录</title><style>" + CSS + "</style></head><body>"
        + cover + "\n".join(parts) + "</body></html>"
    )

    out = os.path.join(ROOT, "docs", "prompts-book.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_doc)
    print("written:", out, len(html_doc), "chars")


if __name__ == "__main__":
    sys.exit(main())
