#!/usr/bin/env python3
"""HandCAD identity slots for the brand site, rendered from the HandCAD mirror (never hand-drawn here).

Writes brand/subbrands/handcad/identity/{icon,wordmark,logo}{,-inverse}@4x.png:
  icon      the chosen app icon (HandCAD design/icon/chosen, Tile 07 filled), masked to the iOS tile radius
            (rx 229 of 1024, as in HandCAD site/app-tile.svg); light icon on paper, dark icon on ink
  wordmark  HANDCAD in Instrument Sans Bold, all caps, 0.04 em tracking (HandCAD site/site.css .brand)
  logo      tile left of the wordmark: tile 1.6x the type size, gap 0.6x (site.css: 2rem tile, 1.25rem type, 12 pt gap)
Ink is HandCAD text.primary: #201D1A on paper (light), #F7F3EE on ink (dark). Transparent backgrounds;
the site supplies paper or ink.

  python3 brand/scripts/make-handcad-identity.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BRAND = Path(__file__).resolve().parent.parent
MIRROR = BRAND / "subbrands/handcad/mirror/design/icon/chosen"
OUT = BRAND / "subbrands/handcad/identity"
FONT = BRAND / "fonts/instrument-sans/InstrumentSans-Bold.ttf"
INK = {"paper": (0x20, 0x1D, 0x1A, 255), "ink": (0xF7, 0xF3, 0xEE, 255)}
ICON = {"paper": "app-icon-light-1024.png", "ink": "app-icon-dark-1024.png"}
SS = 4  # supersample for smooth edges


def tile(variant: str, size: int) -> Image.Image:
    src = Image.open(MIRROR / ICON[variant]).convert("RGBA").resize((size * SS, size * SS), Image.LANCZOS)
    mask = Image.new("L", src.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, src.width - 1, src.height - 1], radius=round(src.width * 229 / 1024), fill=255)
    src.putalpha(mask)
    return src.resize((size, size), Image.LANCZOS)


def word(variant: str, px: int, padded: bool = True) -> Image.Image:
    font = ImageFont.truetype(str(FONT), px * SS)
    text, track = "HANDCAD", 0.04 * px * SS
    widths = [font.getlength(c) for c in text]
    w = int(sum(widths) + track * (len(text) - 1))
    asc, desc = font.getmetrics()
    top = font.getbbox("H")[1]  # cap top: trim the space above the caps
    cap = asc - top
    pad = round(cap * 0.2) if padded else 0  # all caps fill the line box; room above and below keeps them level with mixed-case wordmarks
    h = cap + 2 * pad
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 0.0
    for c, cw in zip(text, widths):
        d.text((x, pad - top), c, font=font, fill=INK[variant])
        x += cw + track
    return im.resize((max(1, w // SS), max(1, h // SS)), Image.LANCZOS)


def logo(variant: str, px: int) -> Image.Image:
    t, wm = tile(variant, round(px * 1.6)), word(variant, px, padded=False)
    gap = round(px * 0.6)
    im = Image.new("RGBA", (t.width + gap + wm.width, t.height), (0, 0, 0, 0))
    im.alpha_composite(t, (0, 0))
    im.alpha_composite(wm, (t.width + gap, (t.height - wm.height) // 2))
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for variant, suffix in (("paper", ""), ("ink", "-inverse")):
        tile(variant, 512).save(OUT / f"icon{suffix}@4x.png", optimize=True)
        word(variant, 160).save(OUT / f"wordmark{suffix}@4x.png", optimize=True)
        logo(variant, 160).save(OUT / f"logo{suffix}@4x.png", optimize=True)
    print(f"Wrote HandCAD identity (icon, wordmark, logo; paper + inverse) to {OUT.relative_to(BRAND.parent)}/")


if __name__ == "__main__":
    main()
