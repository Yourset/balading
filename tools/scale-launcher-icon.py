#!/usr/bin/env python3
"""从幽灵前景母版生成各 Android 密度的启动图标。

自适应图标前景占画布约 64%（相对旧版约放大 2 倍）；
旧式方形/圆形图标主体占约 68%，避免圆形启动器蒙版裁切。
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "icon-source" / "ghost-foreground-original.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def render(canvas_size: int, occupancy: float, transparent: bool) -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("幽灵母版没有可见像素")
    ghost = source.crop(bbox)
    target_width = round(canvas_size * occupancy)
    target_height = round(target_width * ghost.height / ghost.width)
    ghost = ghost.resize((target_width, target_height), Image.Resampling.LANCZOS)
    background = (0, 0, 0, 0) if transparent else (253, 253, 253, 255)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), background)
    x = (canvas_size - target_width) // 2
    y = (canvas_size - target_height) // 2
    canvas.alpha_composite(ghost, (x, y))
    return canvas


def main() -> None:
    for density, legacy_size in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        foreground_size = round(legacy_size * 2.25)
        foreground = render(foreground_size, 0.64, True)
        legacy = render(legacy_size, 0.68, False)
        foreground.save(folder / "ic_launcher_foreground.png", optimize=True)
        legacy.save(folder / "ic_launcher.png", optimize=True)
        legacy.save(folder / "ic_launcher_round.png", optimize=True)
        print(
            f"{density}: legacy={legacy_size}px ghost≈68%, "
            f"foreground={foreground_size}px ghost≈64%"
        )


if __name__ == "__main__":
    main()
