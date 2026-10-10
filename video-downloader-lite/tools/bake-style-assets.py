#!/usr/bin/env python3
# tools/bake-style-assets.py — 烘焙小组件风格资产（海报/蓝图/霓虹）
# 产物：assets/widget-style-<风格>-<small|medium>.png 与 assets/widget-style-badge-<风格>.png
# 用法：python3 tools/bake-style-assets.py   （在脚本目录任意位置运行即可）
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
os.makedirs(ASSETS, exist_ok=True)

SIZES = {"small": (360, 360), "medium": (720, 360)}
MONO = "/System/Library/Fonts/Menlo.ttc"


def diag_gradient(size, c1, c2):
    """对角渐变：c1 左上 -> c2 右下（numpy 精确计算）"""
    w, h = size
    x = np.linspace(0, 1, w)[None, :]
    y = np.linspace(0, 1, h)[:, None]
    t = (x + y) / 2
    a = np.array(c1, dtype=float)[None, None, :]
    b = np.array(c2, dtype=float)[None, None, :]
    img = a * (1 - t[..., None]) + b * t[..., None]
    return Image.fromarray(img.astype(np.uint8), "RGB").convert("RGBA")


def add_grain(img, sigma=5.0, alpha=0.10):
    """纸张/胶片噪点颗粒"""
    w, h = img.size
    noise = np.random.normal(0, sigma, (h, w))
    base = np.asarray(img.convert("RGB"), dtype=float)
    out = np.clip(base + noise[..., None], 0, 255).astype(np.uint8)
    grain = Image.fromarray(out, "RGB").convert("RGBA")
    return Image.blend(img, grain, alpha)


def glow_layer(size, draw_fn, blur):
    """在透明层上绘制后高斯模糊，用作辉光"""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def draw_down_arrow(d, cx, cy, h, color):
    """手绘下箭头（轴矩形 + 三角头），不依赖字体"""
    sw = h * 0.26
    d.rectangle([cx - sw / 2, cy - h * 0.52, cx + sw / 2, cy + h * 0.10], fill=color)
    hw = h * 0.34
    d.polygon([(cx - hw, cy + h * 0.02), (cx + hw, cy + h * 0.02), (cx, cy + h * 0.52)], fill=color)


def mono_font(px):
    return ImageFont.truetype(MONO, px)


# -------------------------------------------------------------
# 海报：米色纸感 + 噪点 + 暖棕半调圆点群 + 巨型水印箭头
# -------------------------------------------------------------
def bake_poster():
    for fam, size in SIZES.items():
        w, h = size
        img = diag_gradient(size, (247, 242, 231), (233, 224, 204))
        img = add_grain(img, sigma=6, alpha=0.5)

        d = ImageDraw.Draw(img)
        # 半调圆点群（右下角，暖棕色，极低透明度）
        step = 18
        for row, yy in enumerate(range(int(h * 0.45), h, step)):
            for col, xx in enumerate(range(int(w * 0.5), w, step)):
                r = 1.2 + 1.6 * ((row + col) % 3) / 2
                d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(160, 110, 60, 38))
        # 巨型水印箭头（正红，8% 透明度，右侧出画）
        d2 = ImageDraw.Draw(img)
        draw_down_arrow(d2, w * 0.88, h * 0.42, h * 0.85, (192, 57, 43, 30))
        # 边缘轻晕影（纸张四周略深）
        vig = Image.new("L", size, 0)
        dv = ImageDraw.Draw(vig)
        dv.rectangle([0, 0, w, h], outline=30, width=int(min(w, h) * 0.06))
        vig = vig.filter(ImageFilter.GaussianBlur(min(w, h) * 0.05))
        dark = Image.new("RGBA", size, (120, 90, 50, 255))
        img = Image.composite(dark, img, vig.point(lambda v: v * 0.20))
        img.save(os.path.join(ASSETS, f"widget-style-poster-{fam}.png"))

    # 徽章：正红圆钮 + 柔和投影 + 白箭头
    S = 256
    badge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = glow_layer((S, S), lambda dd: dd.ellipse([28, 40, S - 28, S - 16], fill=(90, 50, 20, 120)), 10)
    badge = Image.alpha_composite(badge, shadow)
    d = ImageDraw.Draw(badge)
    d.ellipse([24, 24, S - 24, S - 24], fill=(192, 57, 43, 255))
    # 顶部高光
    hl = glow_layer((S, S), lambda dd: dd.ellipse([60, 34, S - 60, S // 2], fill=(255, 255, 255, 60)), 14)
    badge = Image.alpha_composite(badge, hl)
    d = ImageDraw.Draw(badge)
    draw_down_arrow(d, S / 2, S / 2, 108, (255, 255, 255, 255))
    badge.save(os.path.join(ASSETS, "widget-style-badge-poster.png"))


# -------------------------------------------------------------
# 蓝图：细网格 + 主网格 + 罗盘圆弧 + 十字标记 + 图签文字
# -------------------------------------------------------------
def bake_blueprint():
    LINE = (234, 242, 255)
    for fam, size in SIZES.items():
        w, h = size
        img = diag_gradient(size, (16, 48, 92), (10, 31, 61))
        d = ImageDraw.Draw(img)
        # 细网格 20px / 主网格 100px
        for xx in range(0, w + 1, 20):
            major = xx % 100 == 0
            d.line([(xx, 0), (xx, h)], fill=LINE + (16 if major else 6,), width=2 if major else 1)
        for yy in range(0, h + 1, 20):
            major = yy % 100 == 0
            d.line([(0, yy), (w, yy)], fill=LINE + (16 if major else 6,), width=2 if major else 1)
        # 罗盘同心圆弧（右上出画）
        cx, cy = int(w * 0.86), int(-h * 0.10)
        for r in (90, 150, 210):
            d.arc([cx - r, cy - r, cx + r, cy + r], 20, 160, fill=LINE + (26,), width=2)
        # 十字准星
        for gx, gy in [(int(w * 0.12), int(h * 0.82)), (int(w * 0.52), int(h * 0.18)), (int(w * 0.88), int(h * 0.66))]:
            d.line([(gx - 7, gy), (gx + 7, gy)], fill=LINE + (70,), width=2)
            d.line([(gx, gy - 7), (gx, gy + 7)], fill=LINE + (70,), width=2)
        # 图签文字
        if fam == "medium":
            d.text((w - 14, h - 14), "DWG.NO VDL-2508 · SCALE 1:1",
                   font=mono_font(13), fill=LINE + (70,), anchor="rs")
        img.save(os.path.join(ASSETS, f"widget-style-blueprint-{fam}.png"))

    # 徽章：白圆环 + 琥珀箭头
    S = 256
    badge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    d.ellipse([22, 22, S - 22, S - 22], outline=(234, 242, 255, 255), width=13)
    d.ellipse([48, 48, S - 48, S - 48], outline=(234, 242, 255, 60), width=2)
    draw_down_arrow(d, S / 2, S / 2, 104, (255, 200, 46, 255))
    badge.save(os.path.join(ASSETS, "widget-style-badge-blueprint.png"))


# -------------------------------------------------------------
# 霓虹：合成波——夜空 + 地平线辉光 + 透视网格地板 + 落日
# -------------------------------------------------------------
def bake_neon():
    CYAN = (0, 229, 255)
    MAGENTA = (255, 46, 136)
    for fam, size in SIZES.items():
        w, h = size
        horizon = int(h * 0.60)
        # 夜空（上）-> 地板（下）
        top = np.array([10, 6, 24], dtype=float)
        bot = np.array([26, 10, 46], dtype=float)
        ys = np.linspace(0, 1, h)[:, None, None]
        arr = np.repeat(top * (1 - ys) + bot * ys, w, axis=1)
        img = Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")

        # 星星
        d = ImageDraw.Draw(img)
        rng = np.random.default_rng(7)
        for _ in range(int(w * h / 2600)):
            sx, sy = rng.integers(0, w), rng.integers(0, horizon - 8)
            a = int(rng.integers(40, 130))
            d.point([(sx, sy)], fill=(255, 255, 255, a))

        # 落日（右上，品红->橙，横向切缝）
        sun_r = int(w * 0.16)
        sun_x, sun_y = int(w * 0.78), int(horizon - sun_r + int(sun_r * 0.35))
        sun = Image.new("RGBA", size, (0, 0, 0, 0))
        ds = ImageDraw.Draw(sun)
        grad = np.linspace(0, 1, 2 * sun_r)[:, None]
        sc = np.array(MAGENTA, dtype=float) * (1 - grad[..., None]) + np.array((255, 150, 60), dtype=float) * grad[..., None]
        sun_grad = Image.fromarray(np.repeat(sc, 2 * sun_r, axis=1).astype(np.uint8), "RGB").convert("RGBA")
        mask = Image.new("L", (2 * sun_r, 2 * sun_r), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, 2 * sun_r - 1, 2 * sun_r - 1], fill=255)
        sun.paste(sun_grad, (sun_x - sun_r, sun_y - sun_r), mask)
        ds = ImageDraw.Draw(sun)
        # 切缝：越靠下越宽
        for i, frac in enumerate((0.30, 0.48, 0.64, 0.78)):
            yy = sun_y - sun_r + int(2 * sun_r * frac)
            th = 2 + i * 2
            ds.rectangle([sun_x - sun_r - 2, yy, sun_x + sun_r + 2, yy + th], fill=(0, 0, 0, 0))
        # 落日辉光
        sun_glow = sun.filter(ImageFilter.GaussianBlur(10))
        img = Image.alpha_composite(img, sun_glow)
        img = Image.alpha_composite(img, sun)

        # 地平线辉光带（青->品红）
        band = Image.new("RGBA", size, (0, 0, 0, 0))
        db = ImageDraw.Draw(band)
        grad_x = np.linspace(0, 1, w)[None, :, None]
        band_col = np.array(CYAN, dtype=float) * (1 - grad_x) + np.array(MAGENTA, dtype=float) * grad_x
        band_img = Image.fromarray(np.repeat(band_col.astype(np.uint8), 6, axis=0), "RGB").convert("RGBA")
        band.paste(band_img, (0, horizon - 3))
        img = Image.alpha_composite(img, band.filter(ImageFilter.GaussianBlur(6)))

        # 透视地板网格（发光层 + 锐利层）
        def grid(dd, width, alpha):
            vx = w / 2
            for k in np.linspace(-w * 1.2, w * 2.2, 13):
                dd.line([(vx, horizon), (k, h)], fill=CYAN + (alpha,), width=width)
            for i in range(1, 8):
                yy = horizon + (h - horizon) * (i / 8) ** 2.1
                dd.line([(0, yy), (w, yy)], fill=CYAN + (alpha,), width=width)
        img = Image.alpha_composite(img, glow_layer(size, lambda dd: grid(dd, 3, 110), 5))
        dg = ImageDraw.Draw(img)
        grid(dg, 1, 150)

        if fam == "medium":
            dg.text((w - 14, 12), "NEON.DL // READY", font=mono_font(13), fill=CYAN + (110,), anchor="rs")
        img.save(os.path.join(ASSETS, f"widget-style-neon-{fam}.png"))

    # 徽章：青色辉光环 + 深色内芯 + 青箭头
    S = 256
    badge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow = glow_layer((S, S), lambda dd: dd.ellipse([40, 40, S - 40, S - 40], fill=CYAN + (200,)), 16)
    badge = Image.alpha_composite(badge, glow)
    d = ImageDraw.Draw(badge)
    d.ellipse([30, 30, S - 30, S - 30], outline=CYAN + (255,), width=11)
    d.ellipse([44, 44, S - 44, S - 44], fill=(11, 11, 26, 255))
    draw_down_arrow(d, S / 2, S / 2, 100, CYAN + (255,))
    badge.save(os.path.join(ASSETS, "widget-style-badge-neon.png"))


if __name__ == "__main__":
    bake_poster()
    print("poster ok")
    bake_blueprint()
    print("blueprint ok")
    bake_neon()
    print("neon ok")
