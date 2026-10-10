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
# 动漫风景：高饱和蓝天 + 积雨云 + 放射太阳 + 远山 + 稻田 + 电线杆 + 飞鸟
# 与水彩相反：硬边 crisp 形状、高对比高饱和（新海诚式背景）
# -------------------------------------------------------------
def _hill_layer(size, base_y, amp, freq, phase, color, blur=1):
    """一层丘陵：正弦曲线轮廓（blur 控制边缘软硬）"""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts = [(x, base_y + amp * math.sin(x / w * math.pi * 2 * freq + phase)) for x in range(0, w + 8, 8)]
    d.polygon(pts + [(w, h), (0, h)], fill=color)
    return layer.filter(ImageFilter.GaussianBlur(blur))


def bake_anime():
    for fam, size in SIZES.items():
        w, h = size
        horizon = int(h * 0.52)
        img = diag_gradient(size, (250, 252, 246), (238, 244, 232))

        # 高饱和蓝天渐变
        sky = np.zeros((horizon, w, 4), dtype=np.uint8)
        ys = np.linspace(0, 1, horizon)[:, None, None]
        c_top = np.array([43, 122, 210], dtype=float)
        c_bot = np.array([158, 212, 245], dtype=float)
        sky[..., :3] = np.repeat(c_top * (1 - ys) + c_bot * ys, w, axis=1).astype(np.uint8)
        sky[..., 3] = 255
        img.paste(Image.fromarray(sky, "RGBA"), (0, 0))

        # 大团积雨云：蓝灰底层 + 亮白上层（硬边层叠椭圆）
        def cumulus(cx, cy, cw):
            c = Image.new("RGBA", size, (0, 0, 0, 0))
            dc = ImageDraw.Draw(c)
            blobs = [(-0.55, 0.10, 0.34), (-0.20, -0.05, 0.44), (0.18, -0.18, 0.50), (0.52, 0.0, 0.40), (0.05, 0.12, 0.46)]
            for ox, oy, orr in blobs:
                dc.ellipse([cx + ox * cw - orr * cw, cy + oy * cw - orr * cw * 0.55 + cw * 0.05,
                            cx + ox * cw + orr * cw, cy + oy * cw + orr * cw * 0.55 + cw * 0.05],
                           fill=(168, 199, 229, 255))
            for ox, oy, orr in blobs:
                dc.ellipse([cx + ox * cw - orr * cw, cy + oy * cw - orr * cw * 0.55,
                            cx + ox * cw + orr * cw, cy + oy * cw + orr * cw * 0.55],
                           fill=(255, 255, 255, 255))
            return c
        img = Image.alpha_composite(img, cumulus(w * 0.28, h * 0.16, w * 0.42))
        img = Image.alpha_composite(img, cumulus(w * 0.72, h * 0.32, w * 0.28))

        # 太阳 + 放射光线
        sun_x, sun_y, sun_r = int(w * 0.82), int(h * 0.13), int(w * 0.055)
        img = Image.alpha_composite(img, glow_layer(
            size, lambda dd: dd.ellipse([sun_x - sun_r, sun_y - sun_r, sun_x + sun_r, sun_y + sun_r],
                                        fill=(255, 250, 210, 255)), int(w * 0.025)))
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        d.ellipse([sun_x - sun_r, sun_y - sun_r, sun_x + sun_r, sun_y + sun_r], fill=(255, 252, 230, 255))
        for ang in range(0, 360, 30):
            a = math.radians(ang)
            d.line([(sun_x + math.cos(a) * sun_r * 1.5, sun_y + math.sin(a) * sun_r * 1.5),
                    (sun_x + math.cos(a) * sun_r * 2.6, sun_y + math.sin(a) * sun_r * 2.6)],
                   fill=(255, 250, 210, 150), width=3)
        img = Image.alpha_composite(img, ov)

        # 远山（蓝紫剪影）+ 中景绿丘 + 前景
        img = Image.alpha_composite(img, _hill_layer(size, int(h * 0.50), h * 0.025, 1.6, 0.8, (126, 146, 196, 255), 1))
        img = Image.alpha_composite(img, _hill_layer(size, int(h * 0.58), h * 0.04, 1.0, 2.4, (108, 184, 96, 255), 1))
        img = Image.alpha_composite(img, _hill_layer(size, int(h * 0.74), h * 0.05, 1.4, 4.2, (88, 168, 78, 255), 1))

        # 稻田色带（黄绿相间两条）
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        band_y = int(h * 0.82)
        d.polygon([(0, band_y), (w, band_y - h * 0.04), (w, band_y + h * 0.02), (0, band_y + h * 0.06)],
                  fill=(178, 205, 92, 255))
        d.polygon([(0, band_y + h * 0.08), (w, band_y + h * 0.04), (w, band_y + h * 0.10), (0, band_y + h * 0.14)],
                  fill=(230, 215, 120, 255))
        img = Image.alpha_composite(img, ov)

        # 电线杆（动漫标志物）+ 垂弧电线
        px = int(w * 0.60)
        pole_top, pole_bot = int(h * 0.40), int(h * 0.80)
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        d.rectangle([px - 3, pole_top, px + 3, pole_bot], fill=(60, 60, 70, 255))
        d.rectangle([px - int(w * 0.05), pole_top + int(h * 0.03), px + int(w * 0.05), pole_top + int(h * 0.03) + 4],
                    fill=(60, 60, 70, 255))
        for wy in (pole_top + int(h * 0.03), pole_top + int(h * 0.07)):
            pts = [(x, wy + int(abs((x - px) / (w * 0.5)) ** 1.5 * h * 0.04)) for x in range(0, w + 10, 10)]
            d.line(pts, fill=(60, 60, 70, 220), width=2)
        img = Image.alpha_composite(img, ov)

        # 小屋（硬边）+ 两棵树（硬边团 + 亮面）
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        hx, hy = int(w * 0.24), int(h * 0.565)
        hw, hh = int(w * 0.055), int(h * 0.075)
        d.rectangle([hx, hy, hx + hw, hy + hh], fill=(245, 235, 221, 255))
        d.polygon([(hx - hw * 0.18, hy), (hx + hw * 1.18, hy), (hx + hw * 0.5, hy - hh * 0.72)], fill=(201, 111, 74, 255))
        d.rectangle([hx + hw * 0.36, hy + hh * 0.38, hx + hw * 0.62, hy + hh], fill=(139, 96, 63, 255))

        def tree(tx, ty, tr):
            d.rectangle([tx - tr * 0.08, ty, tx + tr * 0.08, ty + tr * 1.1], fill=(120, 85, 55, 255))
            for ox, oy, orr in [(-0.35, -0.25, 0.42), (0.3, -0.3, 0.45), (0.0, -0.62, 0.5)]:
                d.ellipse([tx + ox * tr - orr * tr, ty + oy * tr - orr * tr,
                           tx + ox * tr + orr * tr, ty + oy * tr + orr * tr], fill=(74, 138, 60, 255))
            d.ellipse([tx - tr * 0.28, ty - tr * 0.78, tx + tr * 0.12, ty - tr * 0.38], fill=(120, 184, 92, 255))
        tree(int(w * 0.12), int(h * 0.58), w * 0.045)
        tree(int(w * 0.88), int(h * 0.66), w * 0.055)
        img = Image.alpha_composite(img, ov)

        # 飞鸟（小弧对）
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        for bx, by in [(w * 0.42, h * 0.10), (w * 0.47, h * 0.13), (w * 0.38, h * 0.14)]:
            d.arc([bx - 6, by - 4, bx, by + 4], 200, 340, fill=(50, 60, 80, 255), width=2)
            d.arc([bx, by - 4, bx + 6, by + 4], 200, 340, fill=(50, 60, 80, 255), width=2)
        img = Image.alpha_composite(img, ov)

        # 左侧文字区白色衬底
        scrim_w = int(w * 0.62)
        xs = np.linspace(0, 1, scrim_w)[None, :, None]
        scrim_arr = np.zeros((h, scrim_w, 4), dtype=np.uint8)
        scrim_arr[..., :3] = 255
        scrim_arr[..., 3] = np.repeat((1 - xs) * 95, h, axis=0)[..., 0].astype(np.uint8)
        img = Image.alpha_composite(img, Image.fromarray(scrim_arr, "RGBA").resize(size).filter(ImageFilter.GaussianBlur(8)))

        img.save(os.path.join(ASSETS, f"widget-style-anime-{fam}.png"))


# -------------------------------------------------------------
# 蓝图：细网格 + 主网格 + 罗盘圆弧 + 十字标记 + 图签文字
# -------------------------------------------------------------
def bake_blueprint():
    LINE = (234, 242, 255)
    for fam, size in SIZES.items():
        w, h = size
        img = diag_gradient(size, (16, 48, 92), (10, 31, 61))
        # 线条全部画在 overlay 上再合成（ImageDraw 直接画半透明色会改写像素 alpha）
        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        # 细网格 20px / 主网格 100px
        for xx in range(0, w + 1, 20):
            major = xx % 100 == 0
            d.line([(xx, 0), (xx, h)], fill=LINE + (9 if major else 4,), width=2 if major else 1)
        for yy in range(0, h + 1, 20):
            major = yy % 100 == 0
            d.line([(0, yy), (w, yy)], fill=LINE + (9 if major else 4,), width=2 if major else 1)
        # 罗盘同心圆弧（右上出画）
        cx, cy = int(w * 0.86), int(-h * 0.10)
        for r in (90, 150, 210):
            d.arc([cx - r, cy - r, cx + r, cy + r], 20, 160, fill=LINE + (16,), width=2)
        # 十字准星
        for gx, gy in [(int(w * 0.12), int(h * 0.82)), (int(w * 0.52), int(h * 0.18)), (int(w * 0.88), int(h * 0.66))]:
            d.line([(gx - 7, gy), (gx + 7, gy)], fill=LINE + (40,), width=2)
            d.line([(gx, gy - 7), (gx, gy + 7)], fill=LINE + (40,), width=2)
        img = Image.alpha_composite(img, ov)
        # 左侧文字区暗色衬底（左 -> 右渐变到透明），压住网格保证白字可读
        scrim_w = int(w * 0.62)
        xs = np.linspace(0, 1, scrim_w)[None, :, None]
        scrim_alpha = (1 - xs) * 90
        scrim_arr = np.zeros((h, scrim_w, 4), dtype=np.uint8)
        scrim_arr[..., 0] = 6
        scrim_arr[..., 1] = 14
        scrim_arr[..., 2] = 30
        scrim_arr[..., 3] = np.repeat(scrim_alpha, h, axis=0)[..., 0].astype(np.uint8)
        img = Image.alpha_composite(img, Image.fromarray(scrim_arr, "RGBA").resize(size))
        # 图签文字（overlay 合成）
        if fam == "medium":
            ov2 = Image.new("RGBA", size, (0, 0, 0, 0))
            ImageDraw.Draw(ov2).text((w - 14, h - 14), "DWG.NO VDL-2508 · SCALE 1:1",
                   font=mono_font(13), fill=LINE + (70,), anchor="rs")
            img = Image.alpha_composite(img, ov2)
        img.save(os.path.join(ASSETS, f"widget-style-blueprint-{fam}.png"))



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

        # 星星（overlay 合成，避免透明洞）
        stars = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(stars)
        rng = np.random.default_rng(7)
        for _ in range(int(w * h / 2600)):
            sx, sy = rng.integers(0, w), rng.integers(0, horizon - 8)
            a = int(rng.integers(40, 130))
            d.point([(sx, sy)], fill=(255, 255, 255, a))
        img = Image.alpha_composite(img, stars)

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
        sharp = Image.new("RGBA", size, (0, 0, 0, 0))
        grid(ImageDraw.Draw(sharp), 1, 150)
        img = Image.alpha_composite(img, sharp)
        dg = ImageDraw.Draw(img)

        if fam == "medium":
            ov3 = Image.new("RGBA", size, (0, 0, 0, 0))
            ImageDraw.Draw(ov3).text((w - 14, 12), "NEON.DL // READY", font=mono_font(13), fill=CYAN + (110,), anchor="rs")
            img = Image.alpha_composite(img, ov3)
        img.save(os.path.join(ASSETS, f"widget-style-neon-{fam}.png"))



# -------------------------------------------------------------
# 赛博朋克：警示黄 + 青色电路走线 + 扫描线 + 切角框 + 故障条纹
# -------------------------------------------------------------
CYBER_YELLOW = (252, 238, 10)
CYBER_CYAN = (0, 240, 255)


def bake_cyberpunk():
    for fam, size in SIZES.items():
        w, h = size
        img = diag_gradient(size, (11, 6, 24), (27, 16, 51))

        ov = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        # 扫描线（4px 间隔）
        for yy in range(0, h, 4):
            d.line([(0, yy), (w, yy)], fill=(255, 255, 255, 10), width=1)
        # 电路走线（45° 折线 + 节点方块）
        traces = [
            [(0, int(h * 0.22)), (int(w * 0.20), int(h * 0.22)), (int(w * 0.30), int(h * 0.34)), (int(w * 0.46), int(h * 0.34))],
            [(w, int(h * 0.70)), (int(w * 0.72), int(h * 0.70)), (int(w * 0.62), int(h * 0.58)), (int(w * 0.50), int(h * 0.58))],
            [(int(w * 0.08), h), (int(w * 0.08), int(h * 0.78)), (int(w * 0.18), int(h * 0.66)), (int(w * 0.34), int(h * 0.66))],
        ]
        for pts in traces:
            d.line(pts, fill=CYBER_CYAN + (95,), width=3, joint="curve")
            for px, py in (pts[1], pts[2]):
                d.rectangle([px - 4, py - 4, px + 4, py + 4], outline=CYBER_CYAN + (130,), width=2)
        # 故障条纹（短横条，黄/品红）
        rng = np.random.default_rng(11)
        for _ in range(5):
            yy = int(rng.integers(int(h * 0.1), int(h * 0.9)))
            x0 = int(rng.integers(0, int(w * 0.7)))
            ln = int(rng.integers(int(w * 0.06), int(w * 0.18)))
            col = CYBER_YELLOW if rng.random() < 0.6 else (255, 46, 136)
            d.rectangle([x0, yy, x0 + ln, yy + 3], fill=col + (150,))
        # 切角框线（四角 L 型括号）
        m, ln2 = 10, 26
        for ox, oy, sx, sy in [(m, m, 1, 1), (w - m, m, -1, 1), (m, h - m, 1, -1), (w - m, h - m, -1, -1)]:
            d.line([(ox, oy), (ox + sx * ln2, oy)], fill=CYBER_YELLOW + (210,), width=4)
            d.line([(ox, oy), (ox, oy + sy * ln2)], fill=CYBER_YELLOW + (210,), width=4)
        # 右下角警示斜纹带
        for i in range(6):
            x0 = w - 90 + i * 16
            d.polygon([(x0, h), (x0 + 8, h), (x0 + 8 - 24, h - 24), (x0 - 24, h - 24)], fill=CYBER_YELLOW + (55,))
        img = Image.alpha_composite(img, ov)

        # 左侧文字区暗色衬底（同蓝图处理）
        scrim_w = int(w * 0.62)
        xs = np.linspace(0, 1, scrim_w)[None, :, None]
        scrim_arr = np.zeros((h, scrim_w, 4), dtype=np.uint8)
        scrim_arr[..., 0] = 8
        scrim_arr[..., 1] = 4
        scrim_arr[..., 2] = 20
        scrim_arr[..., 3] = np.repeat((1 - xs) * 90, h, axis=0)[..., 0].astype(np.uint8)
        img = Image.alpha_composite(img, Image.fromarray(scrim_arr, "RGBA").resize(size))

        if fam == "medium":
            ov2 = Image.new("RGBA", size, (0, 0, 0, 0))
            ImageDraw.Draw(ov2).text((w - 16, 12), "CYBER.DL // SECTOR 07", font=mono_font(13),
                                     fill=CYBER_CYAN + (160,), anchor="rs")
            img = Image.alpha_composite(img, ov2)
        img.save(os.path.join(ASSETS, f"widget-style-cyberpunk-{fam}.png"))


# -------------------------------------------------------------
# 主题徽章：3 风格 × 10 主题色（点缀色跟随配色主题，背景不动）
# -------------------------------------------------------------
def theme_accents():
    """从 services/theme.ts 解析主题 accent 表"""
    import re
    src = open(os.path.join(ROOT, "services", "theme.ts")).read()
    return {m.group(1): m.group(2) for m in re.finditer(r'(\w+):\s*\{[^}]*?accent:\s*"(#[0-9A-Fa-f]{6})"', src)}


def darken_for_light(hex_color, target_l=0.15):
    """与 theme.ts 的 accentOn('light') 同逻辑：先 gamma 2.2 保色相，不够再线性缩放"""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    lum = lambda rr, gg, bb: 0.2126 * lin(rr) + 0.7152 * lin(gg) + 0.0722 * lin(bb)
    if lum(r, g, b) <= target_l:
        return hex_color
    # 纯线性缩放：三通道同比缩小，色相严格不变
    # （此前 gamma 2.2 会压垮绿色通道，把橙色压成红色）
    k = 1.0
    while lum(r * k, g * k, b * k) > target_l and k > 0.25:
        k -= 0.02
    return "#{:02X}{:02X}{:02X}".format(round(r * k * 255), round(g * k * 255), round(b * k * 255))


def hex_rgba(hex_color, a=255):
    return (int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16), a)


GLYPHS = ["clapperboard", "popcorn", "play", "film", "video", "download"]


def draw_glyph(d, glyph, cx, cy, h, color):
    """六款徽章字形，全部 PIL 原语绘制；挖洞用全透明填充（在 overlay 层上等效裁切）"""
    HOLE = (0, 0, 0, 0)
    if glyph == "play":
        d.polygon([(cx - h * 0.28, cy - h * 0.42), (cx - h * 0.28, cy + h * 0.42), (cx + h * 0.46, cy)], fill=color)
    elif glyph == "download":
        draw_down_arrow(d, cx, cy, h, color)
    elif glyph == "film":
        # 横置胶片：圆角框 + 上下两排齿孔
        w2, h2 = h * 0.58, h * 0.40
        d.rounded_rectangle([cx - w2, cy - h2, cx + w2, cy + h2], radius=h * 0.10, fill=color)
        hole = h * 0.10
        for i in range(4):
            x = cx - w2 + h * 0.10 + i * (2 * w2 - h * 0.20 - hole) / 3
            d.rectangle([x, cy - h2 + h * 0.06, x + hole, cy - h2 + h * 0.06 + hole], fill=HOLE)
            d.rectangle([x, cy + h2 - h * 0.06 - hole, x + hole, cy + h2 - h * 0.06], fill=HOLE)
    elif glyph == "video":
        # 摄像机：圆角机身 + 右侧三角镜头
        w2, h2 = h * 0.40, h * 0.30
        d.rounded_rectangle([cx - h * 0.58, cy - h2, cx + w2 - h * 0.18, cy + h2], radius=h * 0.10, fill=color)
        d.polygon([(cx + w2 - h * 0.14, cy - h * 0.12), (cx + w2 - h * 0.14, cy + h * 0.12),
                   (cx + h * 0.58, cy + h * 0.30), (cx + h * 0.58, cy - h * 0.30)], fill=color)
    elif glyph == "clapperboard":
        # 场记板：底板 + 斜纹上翻板
        w2 = h * 0.52
        d.rounded_rectangle([cx - w2, cy - h * 0.10, cx + w2, cy + h * 0.40], radius=h * 0.07, fill=color)
        d.polygon([(cx - w2, cy - h * 0.14), (cx - w2 + h * 0.06, cy - h * 0.38),
                   (cx + w2, cy - h * 0.28), (cx + w2, cy - h * 0.04)], fill=color)
        for i in range(3):  # 斜纹挖洞
            x0 = cx - w2 + h * (0.14 + i * 0.34)
            d.polygon([(x0, cy - h * 0.36 + h * 0.02 * i), (x0 + h * 0.10, cy - h * 0.345 + h * 0.02 * i),
                       (x0 + h * 0.22, cy - h * 0.08), (x0 + h * 0.12, cy - h * 0.065)], fill=HOLE)
    elif glyph == "popcorn":
        # 爆米花桶：梯形盒身 + 竖条纹挖洞 + 顶部三颗米花
        d.polygon([(cx - h * 0.36, cy - h * 0.02), (cx + h * 0.36, cy - h * 0.02),
                   (cx + h * 0.25, cy + h * 0.46), (cx - h * 0.25, cy + h * 0.46)], fill=color)
        for sx in (-0.14, 0.0, 0.14):
            d.polygon([(cx + h * (sx - 0.035), cy), (cx + h * (sx + 0.035), cy),
                       (cx + h * (sx * 0.7 + 0.03), cy + h * 0.44), (cx + h * (sx * 0.7 - 0.03), cy + h * 0.44)], fill=HOLE)
        for bx, by, br in ((-0.22, -0.12, 0.14), (0.0, -0.22, 0.16), (0.22, -0.12, 0.14)):
            d.ellipse([cx + h * (bx - br), cy + h * (by - br), cx + h * (bx + br), cy + h * (by + br)], fill=color)


def bake_theme_badges():
    """全矩阵：3 风格 × 6 款式 × 10 主题 = 180 张徽章
    4 倍超采样绘制再 LANCZOS 缩小（PIL 无抗锯齿，直接 256 画边缘全是大锯齿）"""
    SS = 4
    S = 256 * SS
    OUT = 256
    accents = theme_accents()
    for theme, accent in accents.items():
        for glyph in GLYPHS:
            # 动漫：主题色硬边圆钮（浅底用压暗色）+ 白色描边环 + 白色字形
            base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            base = Image.alpha_composite(base, glow_layer(
                (S, S), lambda dd: dd.ellipse([28, 40, S - 28, S - 16], fill=(40, 70, 40, 90)), 10 * SS))
            d = ImageDraw.Draw(base)
            d.ellipse([24, 24, S - 24, S - 24], fill=hex_rgba(darken_for_light(accent), 225),
                      outline=(255, 255, 255, 255), width=8 * SS)
            base = Image.alpha_composite(base, glow_layer(
                (S, S), lambda dd: dd.ellipse([60, 34, S - 60, S // 2], fill=(255, 255, 255, 45)), 14 * SS))
            ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            draw_glyph(ImageDraw.Draw(ov), glyph, S / 2, S / 2, 118 * SS, (255, 255, 255, 255))
            badge = Image.alpha_composite(base, ov).resize((OUT, OUT), Image.LANCZOS)
            badge.save(os.path.join(ASSETS, f"widget-style-badge-anime-{glyph}-{theme}.png"))

            # 蓝图：八边形白环（工程制图感）+ 主题色字形
            base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            d = ImageDraw.Draw(base)
            def octagon(cx, cy, r):
                return [(cx + r * math.cos(math.radians(22.5 + 45 * k)),
                         cy + r * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
            octo = octagon(S / 2, S / 2, S * 0.42)
            d.line(octo + [octo[0]], fill=(234, 242, 255, 255), width=13 * SS, joint="curve")
            octo2 = octagon(S / 2, S / 2, S * 0.32)
            d.line(octo2 + [octo2[0]], fill=(234, 242, 255, 60), width=2 * SS, joint="curve")
            ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            draw_glyph(ImageDraw.Draw(ov), glyph, S / 2, S / 2, 118 * SS, hex_rgba(accent))
            badge = Image.alpha_composite(base, ov).resize((OUT, OUT), Image.LANCZOS)
            badge.save(os.path.join(ASSETS, f"widget-style-badge-blueprint-{glyph}-{theme}.png"))

            # 霓虹：主题色圆角矩形辉光牌（霓虹灯招牌形）+ 深色内芯 + 主题色字形
            base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            base = Image.alpha_composite(base, glow_layer(
                (S, S), lambda dd: dd.rounded_rectangle([40, 40, S - 40, S - 40], radius=30 * SS,
                                                        fill=hex_rgba(accent, 200)), 16 * SS))
            d = ImageDraw.Draw(base)
            d.rounded_rectangle([30, 30, S - 30, S - 30], radius=28 * SS, outline=hex_rgba(accent), width=11 * SS)
            d.rounded_rectangle([44, 44, S - 44, S - 44], radius=22 * SS, fill=(11, 11, 26, 200))
            ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            draw_glyph(ImageDraw.Draw(ov), glyph, S / 2, S / 2, 112 * SS, hex_rgba(accent))
            badge = Image.alpha_composite(base, ov).resize((OUT, OUT), Image.LANCZOS)
            badge.save(os.path.join(ASSETS, f"widget-style-badge-neon-{glyph}-{theme}.png"))

            # 赛博朋克：切角方牌（主题色描边 + 深色半透明底 + 黄色角标）+ 主题色字形
            c = int(S * 0.09)  # 切角量
            m0, m1 = int(S * 0.10), int(S * 0.90)
            base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            d = ImageDraw.Draw(base)
            chamfer = [(m0 + c, m0), (m1, m0), (m1, m1 - c), (m1 - c, m1), (m0, m1), (m0, m0 + c)]
            d.polygon(chamfer, fill=(11, 6, 24, 200))
            d.line(chamfer + [chamfer[0]], fill=hex_rgba(accent), width=11 * SS, joint="curve")
            # 左上角黄色小角标（风格识别色）
            d.polygon([(m0, m0 + c), (m0 + c, m0), (m0 + int(c * 2.2), m0), (m0, m0 + int(c * 2.2))],
                      fill=CYBER_YELLOW + (255,))
            ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            draw_glyph(ImageDraw.Draw(ov), glyph, S / 2, S / 2, 112 * SS, hex_rgba(accent))
            badge = Image.alpha_composite(base, ov).resize((OUT, OUT), Image.LANCZOS)
            badge.save(os.path.join(ASSETS, f"widget-style-badge-cyberpunk-{glyph}-{theme}.png"))


if __name__ == "__main__":
    bake_anime()
    print("anime ok")
    bake_blueprint()
    print("blueprint ok")
    bake_neon()
    print("neon ok")
    bake_cyberpunk()
    print("cyberpunk ok")
    bake_theme_badges()
    print("theme badges ok")
