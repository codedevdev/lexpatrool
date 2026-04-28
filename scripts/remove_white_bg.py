"""Удалить светлый нейтральный фон у PNG (белый/серый без оттенка; синие части не трогаем)."""
from __future__ import annotations

import sys

from PIL import Image


def is_neutral_light(r: int, g: int, b: int, *, floor: int, spread_max: int) -> bool:
    """Светлый серый/белый без заметного оттенка (насыщенные цвета не попадают)."""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < floor:
        return False
    return (mx - mn) <= spread_max


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print(
            "Usage: remove_white_bg.py <image.png> [floor 0-255] [spread_max], "
            "defaults floor=215 spread_max=32"
        )
        sys.exit(1)
    floor = int(sys.argv[2]) if len(sys.argv) > 2 else 215
    spread_max = int(sys.argv[3]) if len(sys.argv) > 3 else 32

    img = Image.open(path).convert("RGBA")
    pixels = list(img.getdata())

    out: list[tuple[int, int, int, int]] = []
    removed = 0
    for r, g, b, a in pixels:
        if is_neutral_light(r, g, b, floor=floor, spread_max=spread_max):
            out.append((r, g, b, 0))
            removed += 1
        else:
            out.append((r, g, b, a))

    img.putdata(out)
    img.save(path, optimize=True)
    print(f"OK: {path} (floor={floor}, spread_max={spread_max}, removed {removed} px)")


if __name__ == "__main__":
    main()
