import sys
from PIL import Image, ImageDraw, ImageFont
B = sys.argv[1]; OUT = sys.argv[2]
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        try: return ImageFont.truetype(p, sz)
        except OSError: pass
    return ImageFont.load_default()
F = font(15); FT = font(18)
RED = (214, 40, 40)
def panel(state, side, crop, boxes, title):
    im = Image.open(f'{B}/{state}/1416x720@1/{side}/screenshot.png').convert('RGB').crop(crop)
    d = ImageDraw.Draw(im)
    for box in boxes:
        x, y, w, h, label = box[:5]
        x -= crop[0]; y -= crop[1]
        d.rectangle([x, y, x + w, y + h], outline=RED, width=3)
        if not label:
            continue
        tw = d.textlength(label, font=F)
        if len(box) > 5:
            lx, ly = box[5] - crop[0], box[6] - crop[1]
        else:
            lx, ly = x, (y - 22 if y > 24 else y + h + 4)
        d.rectangle([lx, ly, lx + tw + 8, ly + 20], fill=RED)
        d.text((lx + 4, ly + 1), label, fill='white', font=F)
    head = Image.new('RGB', (im.width, 30), (40, 40, 40))
    ImageDraw.Draw(head).text((8, 5), title, fill='white', font=FT)
    out = Image.new('RGB', (im.width, im.height + 30), 'white'); out.paste(head, (0, 0)); out.paste(im, (0, 30))
    return out
def stack(a, b, path):
    w = max(a.width, b.width); o = Image.new('RGB', (w, a.height + b.height + 8), (200, 200, 200))
    o.paste(a, (0, 0)); o.paste(b, (0, a.height + 8)); o.save(path)

# 1. proposal-pending: accept/discard hidden + proposal placement
stack(panel('proposal-pending', 'design', (660, 280, 1416, 611),
            [(998, 375, 404, 191, 'P-27/28 proposal card with accept / discard in view')], 'DESIGN  proposal-pending'),
      panel('proposal-pending', 'code', (440, 280, 1416, 611),
            [(814, 501, 232, 78, 'P-27 proposal drawn inline as ghost cards'), (566, 560, 480, 18, 'P-28 accept/discard bar is at y~1030, off screen')],
            'CODE  proposal-pending'), f'{OUT}/defect-proposal-actions.png')
# 2. track-selected rail
stack(panel('track-selected', 'design', (0, 40, 700, 250),
            [(10, 49, 130, 22, 'S-06 filter tabs', 330, 50), (8, 77, 300, 45, 'S-10 selected row warm grey #EEEDE9', 330, 90),
             (38, 101, 262, 15, 'S-08 status counts, version, time', 330, 130), (0, 41, 317, 205, 'S-07 rail 317px', 330, 170)],
            'DESIGN  track-selected rail'),
      panel('track-selected', 'code', (0, 40, 700, 250),
            [(6, 48, 219, 48, 'S-10 selected row light blue #DCE8F8', 250, 55), (37, 73, 166, 16, 'S-08 static step summary', 250, 95),
             (0, 41, 232, 205, 'S-07 rail 232px', 250, 135)],
            'CODE  track-selected rail'),
      f'{OUT}/defect-track-rail.png')
# 3. empty state
stack(panel('empty', 'design', (0, 0, 724, 468),
            [(332, 102, 60, 40, 'E-03 flying bee'), (315, 162, 94, 17, 'E-04 heading'), (152, 342, 420, 34, 'E-09 sidecar hint'), (0, 437, 724, 31, 'E-10 footer')],
            'DESIGN  empty'),
      panel('empty', 'code', (0, 0, 724, 468),
            [(0, 0, 232, 468, 'E-01 track rail kept', 245, 30), (438, 141, 44, 56, 'E-03 upright bee'), (339, 215, 243, 22, 'E-04 heading'), (688, 0, 36, 468, 'E-12 sidecar rail', 545, 60)],
            'CODE  empty'), f'{OUT}/defect-empty.png')
