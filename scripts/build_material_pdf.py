#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把指定的 markdown 材料渲染成与论文同款的黑白版式 HTML。

用法：
    python build_material_pdf.py <输出html> <标题> <副标题> <md1> [md2 ...]

复用 build_prompt_book.py 里的 markdown 转换器，保证两份材料版式完全一致。
"""
import importlib.util
import io
import os
import sys
import html as H

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load_converter():
    spec = importlib.util.spec_from_file_location("bpb", os.path.join(HERE, "build_prompt_book.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # 有 __main__ 保护，import 时不会执行 main()
    return mod


def main():
    if len(sys.argv) < 5:
        print("usage: build_material_pdf.py <out.html> <title> <subtitle> <md...>")
        return 1

    out_html, title, subtitle = sys.argv[1], sys.argv[2], sys.argv[3]
    md_files = sys.argv[4:]

    mod = load_converter()

    body = []
    for rel in md_files:
        path = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        with io.open(path, encoding="utf-8") as f:
            body.append(mod.convert(f.read()))

    head = """
<div class="paper-head">
  <div class="conf">2026 年第九届传智杯全国大学生数智创新与 AI 应用大赛 · AI 创新应用挑战赛（个人赛）</div>
  <h1 class="title">%s</h1>
  <div class="subtitle">%s</div>
  <div class="author">参赛者：as5827</div>
  <div class="affil">代码仓库：https://github.com/as5827/dika-light-meal-miniprogram　·　2026 年 10 月</div>
</div>
""" % (H.escape(title), H.escape(subtitle))

    doc = (
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
        "<title>" + H.escape(title) + "</title><style>" + mod.CSS + "</style></head><body>"
        + head + "\n".join(body) + "</body></html>"
    )

    with io.open(out_html, "w", encoding="utf-8") as f:
        f.write(doc)
    print("written:", out_html, len(doc), "chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
