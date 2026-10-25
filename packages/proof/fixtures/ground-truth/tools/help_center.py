"""Write help-center/agent-run.correspondence.csv from hand rules (L1, round 3).

python3 -I tools/help_center.py <captures/help-center/agent-run/1480x830@1> <out.csv>
A visual design layer is a node with own text, paint (bg/border/shadow), an icon root, or a visible
row/section block, whose box intersects the 1064x720 frame. Fails if a layer has no rule or a rule
names a code path that does not exist.
"""
import csv, json, sys

B, OUT = sys.argv[1], sys.argv[2]
D = json.load(open(f'{B}/design/dom.json'))['nodes']
C = json.load(open(f'{B}/code/dom.json'))['nodes']
cpath = {n['path']: n for n in C}
txt = lambda n: ' '.join((n.get('text') or '').split())

def painted(n):
    s = n['style']
    return (s.get('background-color') not in (None, 'rgba(0, 0, 0, 0)') or s.get('box-shadow', 'none') != 'none'
            or any(s.get(f'border-{x}-width', '0px') != '0px' for x in ('top', 'right', 'bottom', 'left')))

def visible(n):
    x, y, w, h = n['box']
    return w > 0 and h > 0 and y < 720 and y + h > 0 and x < 1064

fid = lambda n: n.get('fdnId') or ''
ROWBLOCK = ('::n2', '::n12', '::n9')  # ShortcutRow row, NavRow row, SectionHead row
layers = [n for n in D if visible(n) and n['path'] != '0' and n['tag'] not in ('path', 'g', 'rect', 'circle', 'line')
          and (txt(n) or painted(n) or n['tag'] == 'svg' or fid(n).endswith(ROWBLOCK) or fid(n).endswith('::n5')
               or fid(n) in ('n47', 'n48', 'n53', 'n54', 'n55', 'n65', 'n76', 'n46::n17'))]
# text nodes that only wrap a painted keycap are covered by the keycap row itself
layers = [n for n in layers if not (fid(n).endswith('::n7') or (fid(n).endswith('::n5') and False))]

# code shortcut rows by label text: label span is <row>/0/0/0 under 0/0/1/1/0/<section>/<r>
code_rows = {}
for n in C:
    p = n['path'].split('/')
    if len(p) == 10 and n['path'].startswith('0/0/1/1/0/') and p[7:] == ['0', '0', '0'] and txt(n):
        code_rows.setdefault(txt(n), '/'.join(p[:8]))

ROW_LABEL = {  # design label -> (code label or None, confidence, note)
    'Reply': ('Reply', 'sure', ''),
    'Interrupt & send now': ('Interrupt & send now', 'sure', ''),
    'Surface a card': (None, 'unsure', 'code splits it into separate "Sidecar · …" commands further down the section'),
    'Archive agent': (None, 'sure', 'no Archive agent row in the code catalog'),
    'Toggle important': ('Toggle important', 'unsure', 'agent-run row below the visible area in code'),
    'Copy bee id': ('Copy bee id', 'unsure', 'agent-run row below the visible area in code'),
    'Ask agent to self-seal': ('Ask the bee to self-seal', 'unsure', 'below the visible area; reworded'),
    'Back to previous view': ('Back to previous view', 'unsure', 'lives in another section, scrolled above the visible area'),
    'Command palette': ('Command palette', 'unsure', 'Global section is scrolled above the visible area in code'),
    'New agent — quick compose': ('New agent — quick compose', 'unsure', 'Global section is scrolled above the visible area in code'),
    'Jump to pane — picker': (None, 'unsure', 'no row with this label in the code catalog'),
    'Jump to most important': (None, 'unsure', 'no row with this label in the code catalog'),
    'Needs me — triage': (None, 'unsure', 'no row with this label in the code catalog'),
    'Search everything': ('Search everything', 'unsure', 'Global section is scrolled above the visible area in code'),
    'Toggle sidebar': ('Toggle sidebar', 'unsure', 'Global section is scrolled above the visible area in code'),
    'Switch workspace · switch yard': ('Switch workspace', 'unsure', 'code has separate Switch workspace / Switch yard rows, scrolled above'),
    'New window tab': ('New window tab', 'unsure', 'Global section is scrolled above the visible area in code'),
    'Next · previous window tab': (None, 'unsure', 'no combined row in the code catalog'),
    'Keyboard shortcuts — this panel': (None, 'unsure', 'no row with this label in the code catalog'),
}
NAV = {'Getting started': '0/0/0/2', 'Bees & the fleet': '0/0/0/3', 'Yards & quests': '0/0/0/4', 'Reviewing changes': '0/0/0/5',
       'Loops': None, 'Keyboard shortcuts': '0/0/0/7', 'Command palette': '0/0/0/8', 'Message delivery': '0/0/0/9',
       "What's new": None, 'About Apiary': None}
ANCHOR = {'This pane': (None, 'sure', 'code has no "This pane" anchor; Agent run is highlighted in its catalog slot'),
          'Global': ('0/0/1/1/1/0', 'sure', ''), 'Panes & tabs': ('0/0/1/1/1/1', 'sure', ''), 'Lists': ('0/0/1/1/1/6', 'sure', ''),
          'Composer': ('0/0/1/1/1/10', 'sure', ''), 'Fleet': ('0/0/1/1/1/8', 'sure', ''), 'Changes': (None, 'sure', 'no Changes anchor in code'),
          'Editor': ('0/0/1/1/1/12', 'unsure', '"Files & editor" in code'), 'Search': ('0/0/1/1/1/13', 'sure', ''),
          'Sidebar & pickers': (None, 'sure', 'no such anchor in code')}
FIXED = {'n45': ('0/0', 'sure', 'card'), 'n46::n16': ('0/0/0', 'sure', 'guide sidebar'), 'n46::n17': ('0/0/0/0', 'sure', ''),
         'n46::n18': ('0/0/0/0/0', 'sure', ''), 'n46::n20::n1': ('0/0/0/0/1', 'sure', ''),
         'n46::n21::n9': ('0/0/0/1', 'sure', ''), 'n46::n21::n10': ('0/0/0/1', 'sure', 'label text sits in the block itself in code'),
         'n46::n23::n9': ('0/0/0/6', 'sure', ''), 'n46::n23::n10': ('0/0/0/6', 'sure', 'label text sits in the block itself in code'),
         'n46::n26::n14': (None, 'sure', "What's new row absent in code"),
         'n47': ('0/0/1', 'sure', ''), 'n48': ('0/0/1/0', 'sure', ''), 'n49': ('0/0/1/0/0', 'sure', ''),
         'n50': ('0/0/1/0/0/0', 'sure', 'input placeholder'), 'n51': ('0/0/1/0/0/0', 'unsure', 'painted caret vs the native input caret (not visible in the code capture)'),
         'n52': ('0/0/1/0/1', 'sure', ''), 'n53': ('0/0/1/1', 'sure', ''), 'n54': ('0/0/1/1/0', 'sure', 'catalog column'),
         'n55': ('0/0/1/1/0/7', 'sure', 'agent-run section'), 'n56::n9': ('0/0/1/1/0/7/0', 'sure', ''),
         'n56::n10': ('0/0/1/1/0/7/0/0', 'sure', '"THIS PANE · AGENT RUN" vs "AGENT RUN" + "THIS PANE" tag'),
         'n56::n11': (None, 'sure', '"· opened from drone-07" absent'), 'n57': (None, 'sure', 'code draws no bordered card around the section'),
         'n59::n9': ('0/0/1/1/0/0/0', 'unsure', 'Global section header, scrolled above the visible area'),
         'n59::n10': ('0/0/1/1/0/0/0', 'unsure', 'Global section header, scrolled above the visible area'),
         'n65': ('0/0/1/1/1', 'sure', 'anchor rail'), 'n76': ('0/0/1/2', 'sure', 'footer'),
         'n83': ('0/0/1/2/0', 'sure', ''), 'n86': ('0/0/1/2/1', 'sure', '')}
for k in ('n77', 'n78', 'n79', 'n80', 'n81', 'n82', 'n84', 'n85'):
    FIXED[k] = (None, 'sure', 'footer hint absent in code (only "click keys to rebind" remains)')

def find_label(n):  # design ShortcutRow label text for any node in that row
    prefix = fid(n).split('::n')[0] + '::' + fid(n).split('::')[1]
    for m in D:
        if fid(m) == prefix + '::n3':
            return txt(m)

def kbds(row):
    return [p for p in sorted(cpath, key=lambda q: [int(x) for x in q.split('/')]) if p.startswith(row + '/1/') and cpath[p]['tag'] == 'kbd']

rows = []
def emit(n, cp, conf, note):
    if cp is not None and cp not in cpath:
        sys.exit(f'bad code path {cp} for {n["path"]}')
    rows.append([n['path'], fid(n), (f'text "{txt(n)}"' if txt(n) and n['tag'] != 'div' else n['tag'] + ' ' + fid(n).split('::')[-1]),
                 cp or 'none', (f'text "{txt(cpath[cp])[:60]}"' if cp and txt(cpath[cp]) else (cpath[cp]['tag'] if cp else '')), conf, note])

all_design_keys = {}
for n in layers:
    f = fid(n)
    if f in FIXED:
        emit(n, *FIXED[f]); continue
    if f.startswith('n46::n2') and (f.endswith('::n12') or f.endswith('::n13')):
        row = next(m for m in D if fid(m) == f.rsplit('::', 1)[0] + '::n13')
        cp = NAV[txt(row)]
        emit(n, cp, 'sure', '' if cp else f'"{txt(row)}" topic absent in code'); continue
    if f.startswith(('n66', 'n67', 'n68', 'n69', 'n70', 'n71', 'n72', 'n73', 'n74', 'n75')):
        emit(n, *ANCHOR[txt(n)]); continue
    if f.startswith(('n58#', 'n60#')):
        lab = find_label(n)
        clab, conf, note = ROW_LABEL[lab]
        if clab is None:
            emit(n, None, conf, note); continue
        row = code_rows[clab]
        part = f.split('::')[-1] if '::n8::' not in f else 'key'
        if part == 'n2': cp = row
        elif part == 'n3': cp = row + '/0/0'
        elif part == 'n4':
            cp = row + '/0/1' if (row + '/0/1') in cpath and txt(cpath[row + '/0/1']) else None
            note = (note + '; ' if note else '') + ('' if cp else 'code row has no note')
        elif part == 'n5': cp = row + '/1'
        else:
            ks = kbds(row); i = int(f.split('::n7#')[1].split('::')[0])
            cp = ks[i] if i < len(ks) else None
            if cp is None: note = (note + '; ' if note else '') + 'code row has fewer key groups'
        emit(n, cp, conf, note); continue
    sys.exit(f'no rule for {n["path"]} {f} {txt(n)!r}')

with open(OUT, 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['design_path', 'design_fdn_id', 'design_desc', 'code_path', 'code_desc', 'confidence', 'note'])
    w.writerows(rows)
print(len(rows), 'layers;', sum(r[3] != 'none' for r in rows), 'mapped;', sum(r[5] == 'unsure' for r in rows), 'unsure')
