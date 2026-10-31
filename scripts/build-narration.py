# -*- coding: utf-8 -*-
"""把时间轴和逐段旁白合成一条与画面同步的音轨。

流程：读 timeline.json（录屏时写下的各段起止秒数）→ 每段用 Windows SAPI 合成中文旁白
→ 按段起点摆进一条静音轨 → 输出 narration.wav，供 ffmpeg 与视频合成。
"""
import io
import json
import os
import subprocess
import sys
import wave

BUILD = r"D:\Y\video-build"
TIMELINE = os.path.join(BUILD, "timeline.json")
OUT_WAV = os.path.join(BUILD, "narration.wav")
SR = 44100

NARRATION = {
    "opening": "低卡轻食点餐系统，传智杯个人赛作品。",
    "menu": (
        "先看顾客端。左边是类目，右边是菜品，每道菜上的红字是热量。"
        "选规格、加进购物车，底部实时累计总热量——这一餐吃了多少卡，顾客不用自己算。"
        "库存为零的菜会直接置灰，标上已估清，点不进去；接口层也会再拦一次，防止绕过前端下单。"
        "整套前端是原生写的，没有框架，也没有构建步骤，打开就能用。"
    ),
    "nlorder": (
        "再看一句话点餐。我输入一句人话：五百千卡以内、高蛋白、不要香菜、预算四十。点 AI 解析。"
        "服务端把这句话交给大模型，要求它输出固定的 JSON 结构，温度设为零。"
        "解析出来的条件变成三个标签，菜单按这些条件在本地筛，命中八道，第一道三百三十千卡、蛋白三十三克。"
        "关键在于：模型只负责听懂，筛选和计算都不在模型里做，同一句话、同一份菜单，结果可以复算。"
    ),
    "plan": (
        "这是按身体指标算套餐。填性别、年龄、身高、体重、活动量和目标，"
        "服务端用 Mifflin 公式算基础代谢和每日目标，取四成作为这一餐的预算，再在菜单里搜组合。"
        "结果里给了热量偏差和蛋白达成，数字全部来自本地计算，模型不参与。"
    ),
    "board": (
        "商家这边不只是订单列表。今天几单、营业额、客单价、几点最忙、什么卖得最好、"
        "顾客点的热量分布，一屏看完。图表是纯 CSS 画的，没有引图表库。"
        "点 AI 解读，模型读的是同一份数字，只负责把它说成人话，数字还是服务端算的。"
        "没有配 Key 的时候走模板，输出结构一致，只是措辞生硬。"
    ),
    "prompt": (
        "接下来是 AI 协同部分。这是给模型的系统提示，我把它锁死成一个 JSON 结构："
        "热量上限、蛋白下限、价格、忌口，用户没提到的字段一律填空，不许猜。"
        "温度设为零，同一个输入不会给你两个答案。调用参数里还加了十二秒超时，超时就放弃，走正则兜底。"
        "这样即使模型不可用，功能也不会瘫。"
    ),
    "fix": (
        "这是一次真实的修复。第一版的数字转换没挡空值，而 JavaScript 里 Number(null) 是零、不是 NaN，"
        "所以模型没解析出蛋白时，条件里会多出一条蛋白大于等于零，把筛选结果带偏。"
        "我是在自测里看到价格小于等于一元这种鬼条件才发现的，改成先挡空值再转数字，"
        "重跑七十三项自测，全部通过。"
    ),
    "ending": "代码与对话记录都在仓库里。",
}

PS_TEMPLATE = r'''
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft Huihui Desktop")
$s.Rate = -1
$s.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile("{out}", $fmt)
$s.Speak([Console]::In.ReadToEnd())
$s.Dispose()
'''


def synth(text, out):
    ps = os.path.join(BUILD, "_tts.ps1")
    with io.open(ps, "w", encoding="utf-8-sig") as f:
        f.write(PS_TEMPLATE.replace("{out}", out.replace("\\", "\\\\")))
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps],
        input=text.encode("utf-8"),
        capture_output=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.decode("utf-8", "ignore")[:300])
    return os.path.exists(out)


def wav_frames(path):
    with wave.open(path, "rb") as w:
        assert w.getframerate() == SR, w.getframerate()
        assert w.getnchannels() == 1
        return w.readframes(w.getnframes()), w.getnframes()


def main():
    data = json.load(io.open(TIMELINE, encoding="utf-8"))
    timeline = data["timeline"]
    total = int(data["total"] + 2)
    print("视频总长 %.1fs，共 %d 段" % (data["total"], len(timeline)))

    track = bytearray(b"\x00\x00" * (SR * total))
    for seg in timeline:
        name = seg["name"]
        text = NARRATION.get(name)
        if not text:
            continue
        out = os.path.join(BUILD, "tts_%s.wav" % name)
        if not synth(text, out):
            print("  合成失败:", name)
            continue
        frames, n = wav_frames(out)
        dur = n / SR
        slot = seg["end"] - seg["start"]
        print("  %-8s 旁白 %5.1fs / 段长 %5.1fs %s" % (name, dur, slot, "（超出，将被截断）" if dur > slot else ""))
        start_frame = int(seg["start"] * SR)
        max_frames = int(slot * SR)
        frames = frames[: max_frames * 2]
        track[start_frame * 2 : start_frame * 2 + len(frames)] = frames

    with wave.open(OUT_WAV, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(track))
    print("写出:", OUT_WAV, "%.1f 秒" % (len(track) / 2 / SR))


if __name__ == "__main__":
    main()
