#!/usr/bin/env python3
"""Render assets/demo.gif — a brand-matched terminal animation of a real /skillfed run.

This is a *rendered* animation (like assets/demo.svg), not a screen capture, but the wishes and
matches shown are the REAL results the live federation returns for
`/skillfed plan a launch for my open-source dev tool` (verified via search_wishlist.py). A GIF is
useful where an animated SVG won't play — X/Twitter, LinkedIn, slide decks.

Deps: Pillow. Fonts: Consolas (Windows). Run: python scripts/render_demo_gif.py
Output: assets/demo.gif (720x400, looping).
"""
from __future__ import annotations
import os
from PIL import Image, ImageDraw, ImageFont

S = 2                      # supersample factor (render 2x, downscale for crisp text)
W, H = 720 * S, 400 * S
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "demo.gif")

# palette (matches demo.svg)
BG=(247,243,235); INK=(30,27,22); SOFT=(79,73,63); MUTED=(138,131,119)
VIOLET=(124,92,219); GREEN=(46,158,107); AMBER=(201,138,18); WHITE=(255,255,255)
BORDER=(206,201,192)
DOT=[(224,122,85),(232,194,74),(95,182,140)]

def font(px, bold=False):
    path = "C:/Windows/Fonts/" + ("consolab.ttf" if bold else "consola.ttf")
    try: return ImageFont.truetype(path, px*S)
    except OSError: return ImageFont.truetype("DejaVuSansMono.ttf", px*S)

F_CMD=font(15); F_BODY=font(13); F_SM=font(12); F_BTN=font(13, True)

CMD = "/skillfed plan a launch for my open-source dev tool"
BOUNDARY = "-> 4 abstract wishes cross the boundary (paraphrases + sketch) - never your plan or files"
ROWS = [
    ("wish: launch-strategy",      "-> multi-platform-launch", [("review",SOFT),(" · verified",MUTED)]),
    ("wish: repo-discoverability", "-> github-presence",       [("review",SOFT),(" · verified",MUTED)]),
    ("wish: community-building",   "-> community-building",     [("review",SOFT),(" · verified",MUTED)]),
    ("wish: growth-analytics",     "-> product-analytics",      [("permissive",GREEN),(" · verified · ",MUTED),("221*",AMBER)]),
]
RANKED = "each picked from 5 ranked candidates - license · provenance · stars shown"

def seg(d, x, y, parts, fnt):
    for text, color in parts:
        d.text((x, y), text, font=fnt, fill=color, anchor="ls")
        x += d.textlength(text, font=fnt)
    return x

def scene(reveal, typed, caret):
    """reveal: 0 command only .. 1 +boundary, 2..5 +rows, 6 +ranked, 7 +install."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([6*S,6*S,714*S,394*S], radius=18*S, fill=BG, outline=BORDER, width=1*S)
    for i,(cx) in enumerate((34,54,74)):
        d.ellipse([(cx-6)*S,(36-6)*S,(cx+6)*S,(36+6)*S], fill=DOT[i])
    d.text((360*S,40*S), "skill-federation · finder", font=F_SM, fill=MUTED, anchor="ms")
    d.line([6*S,58*S,714*S,58*S], fill=BORDER, width=1*S)
    # command
    d.text((30*S,92*S), "You:", font=F_CMD, fill=MUTED, anchor="ls")
    shown = CMD[:typed]
    d.text((78*S,92*S), shown, font=F_CMD, fill=INK, anchor="ls")
    if caret:
        cx = 78*S + d.textlength(shown, font=F_CMD)
        d.rectangle([cx+2, 76*S, cx+2+7*S, 96*S], fill=VIOLET)
    if reveal >= 1:
        d.text((30*S,124*S), BOUNDARY, font=F_SM, fill=MUTED, anchor="ls")
    ys = [164,192,220,248]
    for i,(wish,skill,trust) in enumerate(ROWS):
        if reveal >= 2+i:
            y = ys[i]*S
            d.text((30*S,y), wish, font=F_BODY, fill=MUTED, anchor="ls")
            x = seg(d, 248*S, y, [("-> ",VIOLET),(skill[3:],INK)], F_BODY)
            seg(d, 470*S, y, trust, F_BODY)
    if reveal >= 6:
        d.text((30*S,278*S), RANKED, font=F_SM, fill=MUTED, anchor="ls")
    if reveal >= 7:
        seg(d, 30*S, 322*S, [("» ",VIOLET),("Install the 4 selected?  -> ",SOFT),
                             (".claude/skills/",INK),(" with license + source.",SOFT)], F_BODY)
        d.rounded_rectangle([30*S,338*S,126*S,368*S], radius=15*S, fill=VIOLET)
        d.text((78*S,358*S), "Install", font=F_BTN, fill=WHITE, anchor="ms")
        d.rounded_rectangle([136*S,338*S,248*S,368*S], radius=15*S, outline=(120,116,108), width=1*S)
        d.text((192*S,358*S), "Review each", font=F_BODY, fill=SOFT, anchor="ms")
    return img.resize((720,400), Image.LANCZOS)

frames, durations = [], []
# 1) type the command
for n in range(0, len(CMD)+1, 5):
    frames.append(scene(0, n, True)); durations.append(70)
frames.append(scene(0, len(CMD), True)); durations.append(450)
# 2) reveal blocks
for r, dur in [(1,450),(2,360),(3,360),(4,360),(5,360),(6,450),(7,650)]:
    frames.append(scene(r, len(CMD), False)); durations.append(dur)
# 3) hold on the full scene, then loop
frames.append(scene(7, len(CMD), False)); durations.append(2200)

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations,
               loop=0, optimize=True, disposal=2)
print("wrote", os.path.abspath(OUT), "|", len(frames), "frames")
