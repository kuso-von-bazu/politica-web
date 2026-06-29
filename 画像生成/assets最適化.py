# -*- coding: utf-8 -*-
"""画像生成/ の生成画像をWeb用に縮小し、ゲームが読む assets/ (ASCIIパス)へ出力する。
GitHub Pages配信・読み込み速度のため最大辺512pxに縮小。
使い方:  python assets最適化.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # POLITICAゲーム/
SRC = os.path.dirname(os.path.abspath(__file__))                    # 画像生成/
MAXEDGE = 512

JOBS = [
    (os.path.join(SRC, '盤面画像'), os.path.join(ROOT, 'assets', 'board')),
    (os.path.join(SRC, 'カード画像'), os.path.join(ROOT, 'assets', 'cards')),
]

total = 0
for src, dst in JOBS:
    if not os.path.isdir(src):
        continue
    os.makedirs(dst, exist_ok=True)
    for fn in sorted(os.listdir(src)):
        if not fn.lower().endswith('.png'):
            continue
        im = Image.open(os.path.join(src, fn)).convert('RGB')
        w, h = im.size
        scale = min(1.0, MAXEDGE / max(w, h))
        if scale < 1.0:
            im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        im.save(os.path.join(dst, fn), optimize=True)
        total += 1
        print('->', os.path.relpath(os.path.join(dst, fn), ROOT))
print('完了:', total, '枚を assets/ へ最適化出力')
