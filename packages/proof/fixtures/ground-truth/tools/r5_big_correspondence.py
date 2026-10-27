"""Correspondence for round-5 matched-data HelpCenter captures (P3 part 2).
python3 -I tools/r5_big_correspondence.py <capture dir with design/ code/> <out.csv> [overrides.json]
Visual design layer = own text, paint, svg root, or a ShortcutRow/NavRow/SectionHead block; layers fully
outside the frame are skipped. Rules, in order: hand overrides; same data-fdn-id; same text (spaces ignored,
nearest box); same paint signature within 60px. A paint or repeated-text match more than 6px away is `unsure`;
an id match or a unique text match is `sure` (whole regions shift with the narrower code sidebar)."""
import csv, json, sys
B, OUT = sys.argv[1], sys.argv[2]
OV = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
D = json.load(open(f'{B}/design/dom.json')); C = json.load(open(f'{B}/code/dom.json'))
FW, FH = D['extent']['frame'][2], D['extent']['frame'][3] if 'extent' in D else (0, 0)
D, C = D['nodes'], C['nodes']
txt = lambda n: ' '.join((n.get('text') or '').split())
norm = lambda t: t.replace(' ', '').lower()
SVGI = ('path', 'g', 'rect', 'circle', 'line', 'polyline', 'ellipse', 'polygon')
def vis(n):
    s, b = n['style'], n['box']
    return s.get('display') != 'none' and s.get('visibility') != 'hidden' and b[2] > 0 and b[3] > 0
def paint(n):
    s = n['style']; sig = []
    if s.get('background-color') not in (None, 'rgba(0, 0, 0, 0)'): sig.append('bg')
    if any(s.get(f'border-{x}-width', '0px') != '0px' and s.get(f'border-{x}-style') not in ('none', 'hidden') for x in ('top', 'right', 'bottom', 'left')): sig.append('bd')
    if s.get('box-shadow', 'none') != 'none': sig.append('sh')
    return tuple(sig)
def own_text(n, pool):
    t = txt(n)
    if not t: return ''
    ch = [m for m in pool if m['path'].startswith(n['path'] + '/') and m['path'].count('/') == n['path'].count('/') + 1]
    if ch and ' '.join(txt(m) for m in ch if txt(m)) == t: return ''
    return t
dist = lambda a, b: max(abs(a['box'][i] - b['box'][i]) for i in range(4))
BLOCK = ('::n2', '::n12', '::n9')
Dv = [n for n in D if vis(n) and n['path'] != '0' and n['tag'] not in SVGI and n['box'][1] < FH and n['box'][1] + n['box'][3] > 0]
Cv = [n for n in C if vis(n)]
byid = {}
for m in Cv:
    if m.get('fdnId'): byid.setdefault(m['fdnId'], m)
rows, used = [], set()
for n in Dv:
    f = n.get('fdnId') or ''; t = own_text(n, Dv); p = paint(n)
    if not (t or p or n['tag'] == 'svg' or f.endswith(BLOCK)): continue
    conf, note, m = 'sure', '', None
    if f in OV:
        cp, conf, note = OV[f]
        m = next((x for x in C if x['path'] == cp), None) if cp != 'none' else None
    elif f in byid:
        m = byid[f]
    else:
        if t: cands = [x for x in Cv if norm(own_text(x, Cv)) == norm(t)]
        elif n['tag'] == 'svg': cands = [x for x in Cv if x['tag'] == 'svg']
        elif p: cands = [x for x in Cv if paint(x) == p]
        else: cands = [x for x in Cv if x['tag'] == n['tag']]
        cands = sorted(cands, key=lambda x: (x['path'] in used, dist(n, x)))
        m = cands[0] if cands else None
        if m is not None and not t and dist(n, m) > 60: m = None
        unique = t and len(cands) == 1
        if t == '·': m = None  # bare separators are not matched by text
        elif m is not None and dist(n, m) > 6 and not unique: conf, note = 'unsure', f'box differs by {round(dist(n, m))}px'
        elif m is not None and dist(n, m) > 6: note = f'same unique text; box shifted by {round(dist(n, m))}px'
    if m is None and not note: note = 'no code layer renders this'
    if m is not None: used.add(m['path'])
    rows.append([n['path'], f, (f'text "{t[:60]}"' if t else (n['tag'] + ' ' + '+'.join(p)).strip()), m['path'] if m else 'none',
                 (f'text "{own_text(m, Cv)[:60]}"' if m and own_text(m, Cv) else (m['tag'] + ' ' + '+'.join(paint(m)) if m else '')), conf, note])
with open(OUT, 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['design_path', 'design_fdn_id', 'design_desc', 'code_path', 'code_desc', 'confidence', 'note']); w.writerows(rows)
print(len(rows), 'layers;', sum(r[3] != 'none' for r in rows), 'mapped;', sum(r[5] == 'unsure' for r in rows), 'unsure')
