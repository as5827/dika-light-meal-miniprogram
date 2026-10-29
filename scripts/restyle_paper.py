#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把技术文档改造成学术论文版式：黑白配色、宋体正文、章节数字编号、摘要关键词、参考文献。"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "docs", "tech-doc.html")

CSS = """
@page { size: A4; margin: 24mm 22mm 22mm 24mm; }
* { box-sizing: border-box; }
body {
  font-family: "Times New Roman", "SimSun", "Songti SC", serif;
  font-size: 10.5pt; line-height: 1.7; color: #000; margin: 0;
}
/* ---------- 标题层级 ---------- */
h1 {
  font-family: "SimHei", "Heiti SC", sans-serif;
  font-size: 14pt; font-weight: 700; color: #000;
  margin: 16pt 0 8pt; padding: 0;
  page-break-before: always; page-break-after: avoid;
}
h2 {
  font-family: "SimHei", "Heiti SC", sans-serif;
  font-size: 11.5pt; font-weight: 700; margin: 12pt 0 5pt; page-break-after: avoid;
}
h3 {
  font-family: "SimHei", "Heiti SC", sans-serif;
  font-size: 10.5pt; font-weight: 700; margin: 9pt 0 4pt; page-break-after: avoid;
}
/* ---------- 正文 ---------- */
p { margin: 0 0 6pt; text-indent: 2em; text-align: justify; }
ul, ol { margin: 4pt 0 6pt 2em; padding: 0; }
li { margin: 2pt 0; text-align: justify; }
b, strong { font-weight: 700; }
code {
  font-family: Consolas, "Courier New", monospace; font-size: 9pt; color: #000;
}
pre {
  font-family: Consolas, "Courier New", monospace;
  font-size: 8.4pt; line-height: 1.45; background: #fafafa;
  border: 0.5pt solid #999; padding: 6pt 8pt; margin: 6pt 0 8pt;
  white-space: pre-wrap; word-break: break-all; page-break-inside: avoid;
}
pre code { font-size: 8.4pt; }
a { color: #000; text-decoration: none; }

/* ---------- 表格 ---------- */
table {
  width: 100%; border-collapse: collapse; margin: 6pt 0 9pt;
  font-size: 9pt; page-break-inside: avoid;
}
th, td { border: 0.5pt solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { background: #f0f0f0; font-weight: 700; }

/* ---------- 图 ---------- */
.fig { text-align: center; margin: 8pt 0 6pt; page-break-inside: avoid; }
.fig img { max-width: 82%; border: 0.5pt solid #999; }
.fig .cap { font-size: 9pt; text-align: center; margin-top: 4pt; text-indent: 0; }
.fig-row { display: flex; gap: 10pt; justify-content: center; page-break-inside: avoid; }
.fig-row .fig { flex: 1; }
.fig-row .fig img { max-width: 100%; max-height: 95mm; }

/* ---------- 论文首页 ---------- */
.paper-head { text-align: center; margin-bottom: 14pt; }
.paper-head .conf { font-size: 9.5pt; color: #333; margin-bottom: 10pt; text-indent: 0; }
.paper-head h1.title {
  font-size: 19pt; margin: 6pt 0 4pt; page-break-before: auto; letter-spacing: 1pt;
}
.paper-head .subtitle { font-size: 11.5pt; color: #222; margin-bottom: 10pt; text-indent: 0; }
.paper-head .author { font-size: 10pt; color: #000; text-indent: 0; }
.paper-head .affil { font-size: 9pt; color: #333; margin-top: 2pt; text-indent: 0; }

.abstract {
  margin: 16pt 0 8pt; padding: 0 6pt; font-size: 9.5pt; line-height: 1.65;
  text-align: justify; text-indent: 0;
}
.abstract b { font-family: "SimHei", sans-serif; }
.abstract p { text-indent: 2em; margin: 0 0 5pt; }
.kw { font-size: 9.5pt; margin-top: 4pt; text-indent: 0; }
.kw b { font-family: "SimHei", sans-serif; }

/* ---------- 目录 ---------- */
.toc { font-size: 10pt; margin-top: 6pt; }
.toc div { margin: 3pt 0; text-indent: 0; }
.toc .l1 { font-weight: 700; margin-top: 6pt; }
.toc .l2 { padding-left: 2em; color: #222; }

/* ---------- 注释块 ---------- */
.note {
  border-left: 2pt solid #000; padding: 4pt 8pt; margin: 6pt 0 8pt;
  font-size: 9.5pt; background: #fafafa; page-break-inside: avoid;
}
.note p { text-indent: 0; margin: 0; }
.lead { font-size: 10pt; }

/* ---------- 参考文献 ---------- */
ol.refs { font-size: 9pt; margin-left: 2.2em; }
ol.refs li { margin: 3pt 0; }
"""

TITLE_BLOCK = """<div class="paper-head">
  <h1 class="title">低卡轻食点餐系统的设计与实现</h1>
  <div class="subtitle">——面向小微轻食商家的双端点餐系统与个性化套餐推荐</div>
  <div class="author">参赛者：as5827　　代码仓库：github.com/as5827/dika-light-meal-miniprogram</div>
  <div class="affil">2026 年第九届传智杯全国大学生数智创新与 AI 应用大赛 · AI 创新应用挑战赛（个人赛）</div>
</div>

<div class="abstract">
  <p><b>摘　要：</b>小微轻食门店普遍缺一套用得起的点餐工具：菜单改不动、估清靠嘴说、下单后进入信息黑箱。本文设计并实现了一套面向此类门店的双端点餐系统，由微信原生小程序（生产端）、H5 页面（演示端）、商家后台与零第三方依赖的 Node.js 后端组成，四者共用同一套 REST 接口，业务逻辑只实现一次。系统在点餐链路之外增加了一个个性化套餐推荐模块：以 Mifflin-St Jeor 公式估算基础代谢，结合活动系数与目标系数得到单餐热量与蛋白预算，再在菜单的组合空间中做带约束的搜索，输出可解释的推荐结果；大模型仅用于文案润色且默认关闭，避免模型输出污染计算结果。开发过程采用意图驱动的 AI 协作方式：由人给出约束与验收标准，AI 产出实现，人负责取舍、复核与纠偏，全部迭代留有可检索的记录。系统共 32 次提交，通过 GitHub Actions 的语法检查、类型检查与接口冒烟，可在 10 分钟内本地复现。</p>
  <div class="kw"><b>关键词：</b>轻食点餐；微信小程序；意图驱动开发；营养学模型；组合优化；可复现性</div>
</div>

<div class="abstract">
  <p><b>Abstract: </b>Small light-meal stores usually cannot afford a full ordering platform: menus are hard to update, sold-out items are announced verbally, and customers lose visibility after placing an order. This paper presents a dual-front-end ordering system for such stores, consisting of a native WeChat Mini Program (production), an H5 page (demonstration), a merchant console, and a zero-dependency Node.js backend sharing one REST API. An additional module recommends personalized meal sets: resting energy expenditure is estimated with the Mifflin-St Jeor equation, activity and goal factors yield a per-meal calorie and protein budget, and a constrained search over menu combinations produces an explainable recommendation. A large language model is used only to polish the wording and is disabled by default, so generated text never contaminates computed values. The system is developed through intent-driven AI collaboration, with 32 commits, a passing CI pipeline, and a ten-minute reproduction path.</p>
  <div class="kw"><b>Keywords: </b>light meal ordering; WeChat Mini Program; intent-driven development; nutrition model; combinatorial search; reproducibility</div>
</div>
"""

TOC = """<h1 style="page-break-before: always;">目　录</h1>
<div class="toc">
  <div class="l1">1　选题与问题定义</div>
  <div class="l2">1.1 场景与用户　1.2 三个具体痛点　1.3 目标与范围界定</div>
  <div class="l1">2　产品方案与业务闭环</div>
  <div class="l2">2.1 功能地图　2.2 订单闭环时序　2.3 关键界面　2.4 AI 个性化推荐</div>
  <div class="l1">3　意图控制策略</div>
  <div class="l2">3.1 协作范式　3.2 上下文管理　3.3 Prompt 结构模板　3.4 五次迭代的 Prompt 链　3.5 纠偏与复核　3.6 约束清单</div>
  <div class="l1">4　架构设计与工程实现</div>
  <div class="l2">4.1 分层与职责　4.2 请求管线　4.3 数据一致性　4.4 订单状态机　4.5 对生成代码的约束　4.6 双端架构</div>
  <div class="l1">5　可复现性论证</div>
  <div class="l2">5.1 提交策略　5.2 Prompt 归档　5.3 十分钟复现路径　5.4 验证证据　5.5 不可复现项声明</div>
  <div class="l1">6　工程质量与安全</div>
  <div class="l2">6.1 鉴权与会话　6.2 输入校验与金额可信　6.3 并发与文件一致性　6.4 风险清单　6.5 日志与可观测性</div>
  <div class="l1">7　用户体验与产品精细度</div>
  <div class="l1">8　局限与后续规划</div>
  <div class="l1">参考文献</div>
  <div class="l1">附录 A–D</div>
</div>
"""

REFS = """<h1>参考文献</h1>
<ol class="refs">
  <li>Mifflin M D, St Jeor S T, Hill L A, et al. A new predictive equation for resting energy expenditure in healthy individuals[J]. The American Journal of Clinical Nutrition, 1990, 51(2): 241-247.</li>
  <li>微信开放文档. 小程序开发指南与 API 参考[EB/OL]. https://developers.weixin.qq.com/miniprogram/dev/framework/, 2026.</li>
  <li>DeepSeek. API Reference: Chat Completions[EB/OL]. https://api-docs.deepseek.com/, 2026.</li>
  <li>Node.js Documentation. HTTP, File System, Crypto[EB/OL]. https://nodejs.org/docs/latest/api/, 2026.</li>
  <li>全国高等院校计算机基础教育研究会. 2026 第九届传智杯全国大学生数智创新与 AI 应用大赛·AI 创新应用挑战赛赛项规程[Z]. 2026.</li>
  <li>OWASP Foundation. Cross-Site Request Forgery Prevention Cheat Sheet[EB/OL]. https://cheatsheetseries.owasp.org/, 2025.</li>
</ol>

"""

H1_MAP = [
    ("<h1>一、选题与问题定义</h1>", "<h1>1　选题与问题定义</h1>"),
    ("<h1>二、产品方案与业务闭环</h1>", "<h1>2　产品方案与业务闭环</h1>"),
    ("<h1>三、意图控制策略（AI 协作方法）</h1>", "<h1>3　意图控制策略</h1>"),
    ("<h1>四、架构设计与工程实现</h1>", "<h1>4　架构设计与工程实现</h1>"),
    ("<h1>五、可复现性论证</h1>", "<h1>5　可复现性论证</h1>"),
    ("<h1>六、工程质量与安全</h1>", "<h1>6　工程质量与安全</h1>"),
    ("<h1>七、用户体验与产品精细度</h1>", "<h1>7　用户体验与产品精细度</h1>"),
    ("<h1>八、局限与后续规划</h1>", "<h1>8　局限与后续规划</h1>"),
]


def main():
    with io.open(PATH, encoding="utf-8") as f:
        html = f.read()

    # 1. 换样式
    html = re.sub(r"<style>.*?</style>", "<style>" + CSS + "</style>", html, flags=re.S)

    # 2. 封面 -> 论文首页
    start = html.index('<div class="cover">')
    end = html.index("</div>\n\n<!-- ================= 目录 ================= -->")
    html = html[:start] + TITLE_BLOCK + html[end + len("</div>\n\n"):]

    # 3. 目录
    toc_start = html.index("<!-- ================= 目录 ================= -->")
    toc_end = html.index("<h1>一、选题与问题定义</h1>")
    html = html[:toc_start] + TOC + "\n" + html[toc_end:]

    # 4. 章节编号
    for old, new in H1_MAP:
        html = html.replace(old, new)

    # 5. 参考文献插在附录前
    html = html.replace("<!-- ================= 附录 ================= -->",
                        REFS + "<!-- ================= 附录 ================= -->")

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print("rewritten:", len(html), "chars")


if __name__ == "__main__":
    main()
