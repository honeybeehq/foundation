"""Write tracks-flowview/<state>.correspondence.csv (L2, round 4).

python3 -I tools/tracks_flowview.py <sample-captures/tracks-pane-flowview> <out dir>
Visual design layer = own text, paint (bg/border/shadow/background-image), icon root (svg) or a visible
row/card/section block, excluding SVG internals and the capture root. Matching is by hand-checked rules:
1) text layers: the code node with the same text (nearest box if repeated);
2) svg roots: the code svg with the nearest box;
3) painted layers: the code node with the same paint signature and the nearest box (code often moves a
   card's paint one wrapper up or down, so wrappers with identical boxes are equivalent);
4) explicit overrides below. A match whose box is more than 6px away is `unsure` unless listed in SHIFTED.
"""
import csv, json, sys, os
B, OUT = sys.argv[1], sys.argv[2]
STATES = ['track-selected', 'proposal-pending', 'empty']
txt = lambda n: ' '.join((n.get('text') or '').split())
norm = lambda t: t.replace(' ', '')
def vis(n):
    s = n['style']; b = n['box']
    return s.get('display') != 'none' and s.get('visibility') != 'hidden' and b[2] > 0 and b[3] > 0
def paint(n):
    s = n['style']
    sig = []
    if s.get('background-color') not in (None, 'rgba(0, 0, 0, 0)'): sig.append('bg')
    if s.get('background-image', 'none') != 'none': sig.append('img')
    if any(s.get(f'border-{x}-width', '0px') != '0px' and s.get(f'border-{x}-style') not in ('none', 'hidden') for x in ('top', 'right', 'bottom', 'left')): sig.append('bd')
    if s.get('box-shadow', 'none') != 'none': sig.append('sh')
    return tuple(sig)
SVGI = ('path', 'g', 'rect', 'circle', 'line', 'polyline', 'ellipse', 'polygon')
BLOCK_TAGS = ('aside', 'main', 'header', 'footer', 'section', 'button')
def layer(n):
    if n['path'] == '0' or n['tag'] in SVGI: return False
    return bool(txt(n) and not any(True for _ in [])) or paint(n) != () or n['tag'] == 'svg' or n['tag'] in BLOCK_TAGS
def dist(a, b):
    return max(abs(a['box'][i] - b['box'][i]) for i in range(4))
BAR = 'accept bar sits after the last step in code (~580px lower), off screen'
OVERRIDES = {('proposal-pending', 'n212::n591::n518::n471'): ('0/0/0/1/1/0/0/0/17', 'unsure', BAR),
             ('proposal-pending', 'n212::n591::n518::n474'): ('0/0/0/1/1/0/0/0/17/2', 'unsure', BAR)}
rows_all = {}
for st in STATES:
    D = json.load(open(f'{B}/{st}/1416x720@1/design/dom.json'))['nodes']
    C = json.load(open(f'{B}/{st}/1416x720@1/code/dom.json'))['nodes']
    CALL = C
    D = [n for n in D if vis(n)]; C = [n for n in C if vis(n)]
    # text layers: only nodes whose own text is not just the concatenation of a child's text
    kids = {}
    for n in D + C:
        kids.setdefault(n['path'].rsplit('/', 1)[0], []).append(n)
    def own_text(n, pool):
        t = txt(n)
        if not t: return ''
        ch = [m for m in pool if m['path'].startswith(n['path'] + '/') and m['path'].count('/') == n['path'].count('/') + 1]
        if ch and ' '.join(txt(m) for m in ch if txt(m)) == t: return ''
        return t
    rows = []
    used = set()
    for n in D:
        if n['path'] == '0' or n['tag'] in SVGI: continue
        t = own_text(n, D); p = paint(n)
        if not (t or p or n['tag'] == 'svg' or n['tag'] in BLOCK_TAGS): continue
        if t:
            cands = [m for m in C if norm(own_text(m, C)) == norm(t)]
            kind = 'text'
        elif n['tag'] == 'svg':
            cands = [m for m in C if m['tag'] == 'svg']; kind = 'icon'
        elif p:
            cands = [m for m in C if paint(m) == p]; kind = 'paint ' + '+'.join(p)
        else:
            cands = [m for m in C if m['tag'] == n['tag']]; kind = n['tag'] + ' block'
        cands = sorted(cands, key=lambda m: (m['path'] in used, dist(n, m)))
        m = cands[0] if cands else None
        if m is not None and dist(n, m) > 60 and not t:
            m = None
        conf, note = 'sure', ''
        b = n['box']
        if (st, n.get('fdnId')) in OVERRIDES:
            cp, conf, note = OVERRIDES[(st, n['fdnId'])]
            m = next(x for x in CALL if x['path'] == cp); used.add(cp)
        connector = p and n['tag'] != 'svg' and not t and (min(b[2], b[3]) <= 2 or (p == ('bd',) and n['tag'] in ('div', 'span') and b[2] >= 100) or (b[2] <= 7 and b[3] <= 7))
        if not note and connector and (m is None or dist(n, m) > 6):
            svgs = [x for x in CALL if x['tag'] in ('path', 'circle') and any(y['tag'] == 'svg' and y['box'][2] > 500 and x['path'].startswith(y['path'] + '/') for y in CALL)]
            near = sorted(svgs, key=lambda x: dist(n, x))
            if b[2] > 100 and b[3] > 100:  # whole branch frame
                m = next(x for x in CALL if x['tag'] == 'svg' and x['box'][2] > 500)
                note = 'code draws the branch frame as elbow paths in one svg'
            else:
                m = near[0]; note = 'connector drawn as an svg path/circle in code'
            conf = 'sure' if dist(n, m) <= 6 else 'unsure'
            used.add(m['path'])
        elif m is None and not note:
            note = 'no code layer with this text/paint'
        elif not note:
            d = dist(n, m)
            if d > 6:
                conf = 'unsure'; note = f'box differs by {round(d)}px' + ('; ' + BAR if 'n518' in (n.get('fdnId') or '') else '')
            used.add(m['path'])
        rows.append([n['path'], n.get('fdnId') or '', (f'text "{t[:60]}"' if t else kind), m['path'] if m else 'none',
                     (f'text "{own_text(m, C)[:60]}"' if m and own_text(m, C) else (m['tag'] + ' ' + '+'.join(paint(m)) if m else '')), conf, note])
    rows_all[st] = rows
    os.makedirs(OUT, exist_ok=True)
    with open(f'{OUT}/{st}.correspondence.csv', 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['design_path', 'design_fdn_id', 'design_desc', 'code_path', 'code_desc', 'confidence', 'note']); w.writerows(rows)
    print(st, len(rows), 'layers;', sum(r[3] != 'none' for r in rows), 'mapped;', sum(r[5] == 'unsure' for r in rows), 'unsure')
