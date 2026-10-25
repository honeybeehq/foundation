"""Annotated design/code crops for round-3 ground truth. python3 -I tools/annotate_round3.py <components dir> <out dir>"""
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
def panel(path, crop, scale, boxes, title):
    im = Image.open(path).convert('RGB').crop(crop)
    im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for x, y, w, h, label in boxes:
        x, y, w, h = (x - crop[0]) * scale, (y - crop[1]) * scale, w * scale, h * scale
        d.rectangle([x, y, x + w, y + h], outline=RED, width=3)
        tw = d.textlength(label, font=F)
        ly = y + h - 24 if label.startswith('H-05') else (y + h + 4 if y < 24 else y - 22)
        d.rectangle([x, ly, x + tw + 8, ly + 20], fill=RED); d.text((x + 4, ly + 1), label, fill='white', font=F)
    head = Image.new('RGB', (im.width, 30), (40, 40, 40)); ImageDraw.Draw(head).text((8, 5), title, fill='white', font=FT)
    out = Image.new('RGB', (im.width, im.height + 30), 'white'); out.paste(head, (0, 0)); out.paste(im, (0, 30)); return out
def stack(a, b, path):
    w = max(a.width, b.width); o = Image.new('RGB', (w, a.height + b.height + 8), (200, 200, 200))
    o.paste(a, (0, 0)); o.paste(b, (0, a.height + 8)); o.save(path)
H = f'{B}/help-center/captures/help-center/agent-run/1480x830@1'
stack(panel(f'{H}/design/screenshot.png', (254, 60, 1064, 360), 2,
            [(276, 76, 290, 22, 'H-04 header: THIS PANE · AGENT RUN · opened from'), (274, 100, 608, 250, 'H-05 bordered this-pane card')],
            'DESIGN  HelpCenter agent-run'),
      panel(f'{H}/code/screenshot.png', (217, 60, 1027, 360), 2,
            [(237, 78, 146, 24, 'H-04 AGENT RUN + pill'), (236, 106, 86, 24, 'H-03 name cut off'), (236, 136, 96, 24, 'H-03'), (236, 286, 190, 24, 'H-03'), (840, 136, 74, 24, 'H-16 · between caps')],
            'CODE  HelpCenter agent-run'), f'{OUT}/r3-help-center-truncation.png')
I = f'{B}/inbox-row/captures/inbox-row/selected/340x100@1'
stack(panel(f'{I}/design/screenshot.png', (0, 0, 340, 60), 4,
            [(29, 26, 56, 16, 'IS-04 review dot + word'), (8, 7, 16, 16, 'IS-03'), (31, 7, 180, 16, 'IS-01 serif (undefined --font-sans)')],
            'DESIGN  InboxRow selected'),
      panel(f'{I}/code/screenshot.png', (0, 0, 340, 60), 4,
            [(29, 29, 10, 17, 'IS-04 missing'), (8, 10, 16, 16, 'IS-03 model mark'), (308, 8, 25, 16, 'IS-05 blue age'), (0, 48, 340, 1, 'IS-06 row runs 5px past the frame')],
            'CODE  InboxRow selected'), f'{OUT}/r3-inbox-row-selected.png')
