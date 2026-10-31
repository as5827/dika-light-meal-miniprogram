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
        "prompts/07-一句话点餐.md",
        "prompts/08-经营看板.md",
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
body { font-family: "Times New Roman","SimSun","Songti SC",serif; font-size: 10pt; line-height: 1.7; color: #000; margin: 0; }
h1 { font-family: "SimHei","Heiti SC",sans-serif; font-size: 15pt; color: #000; border-bottom: 0.75pt solid #000; padding-bottom: 4pt; margin: 0 0 10pt; page-break-before: always; page-break-after: avoid; }
h2 { font-family: "SimHei","Heiti SC",sans-serif; font-size: 11pt; color: #000; margin: 12pt 0 5pt; page-break-after: avoid; }
h3 { font-family: "SimHei","Heiti SC",sans-serif; font-size: 10pt; margin: 9pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 6pt; text-indent: 2em; text-align: justify; }
ul, ol { margin: 4pt 0 6pt 2em; padding: 0; }
li { margin: 2pt 0; text-align: justify; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 9pt; font-size: 9pt; page-break-inside: avoid; }
th, td { border: 0.5pt solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { background: #f0f0f0; font-weight: 700; }
code { font-family: Consolas,"Courier New",monospace; font-size: 9pt; color: #000; }
pre { font-family: Consolas,"Courier New",monospace; font-size: 8.4pt; line-height: 1.45; background: #fafafa; border: 0.5pt solid #999; padding: 6pt 8pt; margin: 6pt 0 8pt; white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
pre code { font-size: 8.4pt; }
.quote { border-left: 2pt solid #000; padding: 4pt 8pt; margin: 6pt 0 8pt; background: #fafafa; color: #111; }
.quote p { text-indent: 0; }
.paper-head { text-align: center; margin-bottom: 18pt; }
.paper-head .conf { font-size: 9.5pt; color: #333; margin-bottom: 12pt; }
.paper-head h1.title { font-family: "SimHei",sans-serif; font-size: 20pt; border: none; margin: 6pt 0 4pt; page-break-before: auto; letter-spacing: 1pt; }
.paper-head .subtitle { font-size: 11.5pt; margin-bottom: 10pt; }
.paper-head .author { font-size: 10pt; }
.paper-head .affil { font-size: 9pt; color: #333; margin-top: 3pt; }
.abstract { margin: 14pt 0 8pt; font-size: 9.5pt; line-height: 1.7; text-align: justify; }
.abstract p { text-indent: 2em; }
.note { font-size: 9.5pt; border-left: 2pt solid #000; padding: 4pt 8pt; background: #fafafa; margin: 8pt 0 10pt; }
.note p { text-indent: 0; margin: 0; }
.part { font-family: "SimHei",sans-serif; font-size: 13pt; color: #000; font-weight: 700; margin: 0 0 8pt; page-break-before: always; }
"""



DIALOG_DIR = os.path.join(ROOT, "docs", "screenshots", "dialogs")

DIALOG_CAPTIONS = {
    "01": "起始对话：确认赛项与规则，明确要交的是哪些材料",
    "02": "评分维度：过程可复现 25%、解题有效 25%、方法创新 20%，决定了后续所有取舍",
    "03": "材料要求：Prompt 快照、README 复现指南、密钥安全，逐条对到仓库里的文件",
    "04": "推荐引擎核对：手算 BMR / TDEE 与程序结果一致，同参数两次请求菜品完全相同",
    "05": "赛道对比：个人赛与两个团队赛的取舍，以及交件前的三个确认",
    "06": "仓库核验：本地与远程同提交、工作区干净、匿名可读，这一屏是提交前的最后检查",
}


def dialog_appendix():
    if not os.path.isdir(DIALOG_DIR):
        return ""
    files = sorted(f for f in os.listdir(DIALOG_DIR) if f.lower().endswith(".png"))
    if not files:
        return ""
    parts = ["<h1>附录　对话过程截图</h1>",
             "<p>以下截图取自开发时与 AI 的会话界面，按时间顺序排列，用于佐证 prompts/ 下三份对话快照记录的过程真实发生。截图未做美化，保留当时的窗口与侧栏。</p>"]
    for i, name in enumerate(files, 1):
        key = name.split("-")[0]
        cap = DIALOG_CAPTIONS.get(key, name.replace(".png", ""))
        parts.append('<div class="fig"><img src="screenshots/dialogs/%s"><div class="cap">图 A-%d　%s</div></div>' % (name, i, cap))
    return "\n".join(parts)


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
<div class="paper-head">
  <div class="conf">2026 年第九届传智杯全国大学生数智创新与 AI 应用大赛 · AI 创新应用挑战赛（个人赛）</div>
  <h1 class="title">Prompt 历史快照与迭代记录</h1>
  <div class="subtitle">——低卡轻食点餐系统的 AI 协作过程留档</div>
  <div class="author">参赛者：as5827</div>
  <div class="affil">代码仓库：https://github.com/as5827/dika-light-meal-miniprogram　·　2026 年 10 月</div>
</div>

<div class="abstract">
  <p>本册收录该项目开发过程中的三份对话快照与六份迭代记录。快照保留当时的报错原文、执行命令与判断顺序，用于说明问题如何被定位；迭代记录按「需求—拆解—取舍—接口—验证—没做的」组织，逐条说明每次功能落地的依据。所有内容均为纪要（节选），非逐字转录。</p>
</div>
"""

    html_doc = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
        "<title>Prompt 历史快照与迭代记录</title><style>" + CSS + "</style></head><body>"
        + cover + "\n".join(parts) + dialog_appendix() + "</body></html>"
    )

    out = os.path.join(ROOT, "docs", "prompts-book.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_doc)
    print("written:", out, len(html_doc), "chars")


if __name__ == "__main__":
    sys.exit(main())
