"""Annotated design/code crop for round-4 Tracks Flow View labels.
python3 -I tools/annotate_round4.py <sample-captures/tracks-pane-flowview> <out dir>"""
import sys
from PIL import Image, ImageDraw, ImageFont
B, OUT = sys.argv[1], sys.argv[2]
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        try: return ImageFont.truetype(p, sz)
        except OSError: pass
    return ImageFont.load_default()
F, FT = font(15), font(18)
RED = (214, 40, 40)
def panel(path, crop, boxes, title):
    im = Image.open(path).convert('RGB').crop(crop); d = ImageDraw.Draw(im)
    for x, y, w, h, label in boxes:
        x, y = x - crop[0], y - crop[1]
        d.rectangle([x, y, x + w, y + h], outline=RED, width=3)
        tw = d.textlength(label, font=F); ly = y - 22
        d.rectangle([x, ly, x + tw + 8, ly + 20], fill=RED); d.text((x + 4, ly + 1), label, fill='white', font=F)
    head = Image.new('RGB', (im.width, 30), (40, 40, 40)); ImageDraw.Draw(head).text((8, 5), title, fill='white', font=FT)
    out = Image.new('RGB', (im.width, im.height + 30), 'white'); out.paste(head, (0, 0)); out.paste(im, (0, 30)); return out
T = f'{B}/proposal-pending/1416x720@1'
a = panel(f'{T}/design/screenshot.png', (232, 360, 1380, 611), [(566, 519, 480, 44, 'PP-01 Accept / Refine / Discard bar in view')], 'DESIGN (Flow View)  proposal-pending')
b = panel(f'{T}/code/screenshot.png', (232, 360, 1380, 611), [(566, 500, 480, 78, 'PP-01 bar is ~580px further down, off screen; Fix findings shows here')], 'CODE  proposal-pending')
o = Image.new('RGB', (a.width, a.height + b.height + 8), (200, 200, 200)); o.paste(a, (0, 0)); o.paste(b, (0, a.height + 8))
o.save(f'{OUT}/r4-tracks-flowview-accept-bar.png')
