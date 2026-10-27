"""Emit R1 correspondence CSVs from hand-written rules.

Rules are written by eye from the screenshots, DOM dumps and Classic source.
First matching rule (full regex match on design path) wins.
"""
import csv, json, re, sys

BASE = sys.argv[1]  # sample-captures/tracks-pane
OUT = sys.argv[2]


def load(state, side):
    d = json.load(open(f"{BASE}/{state}/1416x720@1/{side}/dom.json"))
    return {n['path']: n for n in d['nodes']}


def alpha(c):
    m = re.match(r'rgba\([^)]*,\s*([0-9.]+)\)', c)
    return float(m.group(1)) if m else 1.0


def visible(n):
    s = n['style']
    return s['display'] != 'none' and s['visibility'] != 'hidden' and n['box'][2] > 0 and n['box'][3] > 0


def paints(n):
    s = n['style']
    if alpha(s['background-color']) > 0 and s['background-color'] != 'rgba(0, 0, 0, 0)':
        return True
    if s['box-shadow'] != 'none':
        return True
    return any(s[f'border-{x}-width'] != '0px' for x in ('top', 'right', 'bottom', 'left'))


def desc(n, labels, nodes=None):
    if n['path'] in labels:
        return labels[n['path']]
    t = (n.get('text') or '').strip()
    if t:
        return f'text "{t[:60]}"'
    if n['tag'] == 'svg':
        return 'icon'
    if nodes and nodes.get(n['path'] + '/0', {}).get('tag') == 'svg':
        return 'icon wrapper'
    s = n['style']
    bits = []
    if s['background-color'] not in ('rgba(0, 0, 0, 0)',):
        bits.append('filled')
    if s['border-top-left-radius'] != '0px':
        bits.append('rounded')
    return (' '.join(bits) + ' box').strip()


def candidates(nodes, layout_re, skip_re):
    out = []
    for p, n in nodes.items():
        if not visible(n) or p in ('0',):
            continue
        if skip_re and re.fullmatch(skip_re, p):
            continue
        parent = p.rsplit('/', 1)[0]
        in_svg = any(nodes.get(q, {}).get('tag') == 'svg' for q in ancestors(p))
        if in_svg:
            continue
        own_text = bool((n.get('text') or '').strip())
        if own_text or paints(n) or n['tag'] == 'svg' or re.fullmatch(layout_re, p):
            out.append(p)
    return out


def ancestors(p):
    parts = p.split('/')
    return ['/'.join(parts[:i]) for i in range(1, len(parts))]


def emit(state, rules, layout_re, skip_re, dlabels, clabels):
    D, C = load(state, 'design'), load(state, 'code')
    rows, unmatched = [], []
    for p in sorted(candidates(D, layout_re, skip_re), key=lambda s: [int(x) for x in s.split('/')]):
        for pat, tgt, conf, note in rules:
            m = re.fullmatch(pat, p)
            if m:
                code = m.expand(tgt) if tgt != 'none' else 'none'
                break
        else:
            unmatched.append(p)
            continue
        if code != 'none' and code not in C:
            raise SystemExit(f'{state}: bad code path {code} for {p}')
        n = D[p]
        rows.append({
            'design_path': p,
            'design_fdn_id': n.get('fdnId') or '',
            'design_desc': desc(n, dlabels),
            'code_path': code,
            'code_desc': desc(C[code], clabels, C) if code != 'none' else '',
            'confidence': conf,
            'note': note,
        })
    if unmatched:
        raise SystemExit(f'{state}: no rule for ' + ', '.join(unmatched))
    with open(f'{OUT}/{state}.correspondence.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(state, len(rows), 'rows;', sum(r['code_path'] != 'none' for r in rows), 'mapped;',
          sum(r['confidence'] == 'unsure' for r in rows), 'unsure')


# ---------------------------------------------------------------- shared design (selected/proposal)
SHARED_LAYOUT = r'0/0/1/0|0/0/1/0/0|0/0/1/0/1|0/0/1/0/1/\d/0|0/0/1/0/1/\d/0/1|0/0/1/1|0/0/1/1/1|0/0/1/1/1/0|' \
    r'0/0/1/1/1/0/\d+/0|0/0/1/1/1/0/10|0/0/1/1/1/0/10/1/0|0/0/1/1/1/1/0|0/0/1/1/1/1/0/\d/0|0/0/1/1/1/1/1|' \
    r'0/0/1/1/1/1/1/\d/0|0/0/1/1/1/1/2|0/0/1/1/1/1/2/\d/0|0/0/1/1/1/1/2/5'

DLABELS = {
    '0/0': 'pane (white card, 8px radius, shadow)',
    '0/0/0': 'pane title bar',
    '0/0/1/0': 'track list column',
    '0/0/1/0/0': 'filter tab row (All/Attached/Idle)',
    '0/0/1/0/1': 'track list',
    '0/0/1/1': 'detail column',
    '0/0/1/1/0': 'detail header bar',
    '0/0/1/1/1': 'detail body',
    '0/0/1/1/1/0': 'spine column',
    '0/0/1/1/1/0/10': 'exceptions section',
    '0/0/1/1/1/0/11': 'help note block (top rule)',
    '0/0/1/1/1/1': 'right column (attached/queued)',
    '0/0/1/1/1/1/0': 'attached section',
    '0/0/1/1/1/1/1': 'queued section',
    '0/0/1/1/2': 'detail footer bar',
    '0/0/1/1/1/0/10/1/0': 'exception row',
}
for i, name in enumerate(['review-and-ship', 'pr-triage', 'spec-round', 'board-draw', 'flaky-hunt', 'dep-bump', 'nectar-preview']):
    DLABELS[f'0/0/1/0/1/{i}/0'] = f'track row {name}'
    DLABELS[f'0/0/1/0/1/{i}/0/1'] = f'track row {name} status line'
for i, name in enumerate(['Read the diff', 'Fan out reviewers', 'Parallel (branch)', 'Typecheck & lint', 'Run the suite', 'Verdict gate', 'Fix findings', 'Publish preview', 'Ship it?']):
    DLABELS[f'0/0/1/1/1/0/{i+1}/0'] = f'spine row {name}'
for i, name in enumerate(['drone-12', 'wren-2', 'scout-4']):
    DLABELS[f'0/0/1/1/1/1/0/{i+1}/0'] = f'attached bee card {name}'
for i, name in enumerate(['bumble-7', 'mite-3']):
    DLABELS[f'0/0/1/1/1/1/1/{i+1}/0'] = f'queued row {name}'


def track_rail_rules():
    R = r'0/0/1/0/1/(\d)/0'
    return [
        (r'0/0', '0/0/0', 'sure', 'whole pane; code pane root has no card background'),
        (r'0/0/0', '0/0/0/0/0', 'unsure', 'design title bar spans the pane; nearest code equivalent is the rail header, which carries the pane name'),
        (r'0/0/0/0', '0/0/0/0/0/0', 'sure', 'pane name: "Tracks" vs "TRACKS" label'),
        (r'0/0/0/1', '0/0/0/0/0/1', 'unsure', 'track count summary vs bare count "7"'),
        (r'0/0/0/2(/.*)?', 'none', 'sure', 'more menu; code has a + button instead'),
        (r'0/0/1/0', '0/0/0/0', 'sure', 'track rail column'),
        (r'0/0/1/0/0(/.*)?', 'none', 'sure', 'filter tabs absent in code'),
        (r'0/0/1/0/1', '0/0/0/0/1', 'sure', 'track list'),
        (R, r'0/0/0/0/1/\1', 'sure', 'same track, same order'),
        (R + r'/0/0/0', r'0/0/0/0/1/\1/0/0', 'sure', 'track glyph (different drawing)'),
        (R + r'/0/1', r'0/0/0/0/1/\1/1/0', 'sure', 'track name'),
        (R + r'/0/[24]', 'none', 'sure', 'version / last-activity time absent in code'),
        (R + r'/1', r'0/0/0/0/1/\1/1/1', 'unsure', 'second line exists in both but content differs (status counts vs step summary)'),
        (r'0/0/1/0/1/0/0/1/0/0/0/0', '0/0/0/0/1/0/2', 'unsure', 'green running dot vs code attached dot at row end'),
        (R + r'/1/.*', 'none', 'sure', 'per-row status counts / "no attachments" absent in code'),
    ]


def detail_tail_rules(canvas, sidecar, footer):
    return [
        (r'0/0/1/1/1/0/10', 'none', 'sure', 'exceptions section absent in code'),
        (r'0/0/1/1/1/0/10/0/0/1', f'{footer}/1', 'unsure', 'exception count; code shows "1 exception" in footer'),
        (r'0/0/1/1/1/0/10/.*', 'none', 'sure', 'exceptions section absent in code'),
        (r'0/0/1/1/1/0/11(/.*)?', 'none', 'sure', 'help note absent in code'),
        (r'0/0/1/1/1/1', 'none', 'sure', 'right column absent; code right edge is the AI sidecar rail (different function)'),
        (r'0/0/1/1/1/1/0(/.*)?', 'none', 'sure', 'attached bees section absent in code'),
    ]


def footer_rules(footer):
    return [
        (r'0/0/1/1/2', footer, 'sure', 'detail footer bar'),
        (r'0/0/1/1/2/[0-3]', f'{footer}/0', 'unsure', 'left footer hint text; different content'),
        (r'0/0/1/1/2/4', 'none', 'sure', 'definition age/versions absent in code'),
    ]


DONE_ROWS = set()


def spine_rules(cards):
    """cards: list of (design index 1..9, code card path or none, status path or none, title path, kind label path or none, desc path or none, conf, note)."""
    rules = [
        (r'0/0/1/1/1/0/0/0', 'none', 'sure', 'SPINE section header absent in code'),
        (r'0/0/1/1/1/0/0/0/.*', 'none', 'sure', 'SPINE section header absent in code'),
    ]
    for i, card, status, icon, title, kind, desc_, extra, conf, note in cards:
        b = f'0/0/1/1/1/0/{i}/0'
        rules.append((b, card, conf, note))
        if status != 'none' and i in DONE_ROWS:
            rules.append((b + '/0/0/0', status + '/0', 'sure', 'done check icon'))
        rules.append((b + '/0(/.*)?', status, 'sure', 'step status marker' + ('' if status != 'none' else ' absent in this code view')))
        rules.append((b + '/1/0', icon, 'unsure' if icon != 'none' else 'sure', 'step kind icon'))
        rules.append((b + '/2', kind, 'unsure' if kind != 'none' else 'sure', 'kind label (ACTION/REVIEW...)'))
        rules.append((b + '/3', title, 'sure', 'step title'))
        rules.append((b + '/4', extra, 'unsure' if extra != 'none' else 'sure', 'lane tag / DENIED badge / description'))
        rules.append((b + '/5', desc_, 'unsure' if desc_ != 'none' else 'sure', 'step description'))
    return rules


# ---------------------------------------------------------------- track-selected
CV = '0/0/0/1/1/0/0/0'  # flow canvas content (live overlay)
TS_CARDS = [
    # i, card, status, kind icon, title, kind label, desc(/5), slot4, conf, note
    (1, f'{CV}/2/0', f'{CV}/2/0/0', 'none', f'{CV}/2/0/1', 'none', 'none', 'none', 'sure', 'step card'),
    (2, f'{CV}/4/0', f'{CV}/4/0/0', 'none', f'{CV}/4/0/1', 'none', 'none', 'none', 'sure', 'step card'),
    (3, f'{CV}/6', 'none', 'none', 'none', 'none', 'none', 'none', 'unsure', 'branch row vs untitled parallel frame around the lanes'),
    (4, f'{CV}/6/0/0/0/0', f'{CV}/6/0/0/0/0/0', 'none', f'{CV}/6/0/0/0/0/1', 'none', 'none', 'none', 'sure', 'lane A card'),
    (5, f'{CV}/6/0/1/0/0', f'{CV}/6/0/1/0/0/0', 'none', f'{CV}/6/0/1/0/0/1', 'none', 'none', 'none', 'sure', 'lane B card (current)'),
    (6, f'{CV}/8/0', f'{CV}/8/0/0', 'none', f'{CV}/8/0/1', 'none', 'none', 'none', 'sure', 'gate card'),
    (7, f'{CV}/9/1/1/0/0', f'{CV}/9/1/1/0/0/0', 'none', f'{CV}/9/1/1/0/0/1', 'none', 'none', f'{CV}/0/1/0', 'sure', 'denied-arm card (below visible area in code)'),
    (8, f'{CV}/11/0', f'{CV}/11/0/0', 'none', f'{CV}/11/0/1', 'none', 'none', 'none', 'sure', 'step card (below visible area in code)'),
    (9, f'{CV}/13/0', f'{CV}/13/0/0', 'none', f'{CV}/13/0/1', 'none', 'none', 'none', 'sure', 'step card (below visible area in code)'),
]
# lane tags on rows 4/5 sit in slot 4 and the description in slot 5; rows without tags have desc in slot 4.
DONE_ROWS.update({1, 2, 4})
TS_RULES = track_rail_rules() + [
    (r'0/0/1/1', '0/0/0/1', 'sure', 'detail column'),
    (r'0/0/1/1/0', '0/0/0/1/0', 'sure', 'detail header'),
    (r'0/0/1/1/0/0/0', 'none', 'sure', 'header track glyph absent'),
    (r'0/0/1/1/0/1', '0/0/0/1/0/0', 'sure', 'track name'),
    (r'0/0/1/1/0/2', 'none', 'sure', 'version badge absent'),
    (r'0/0/1/1/0/3', 'none', 'unsure', 'description absent; code shows attachment status line in that spot'),
    (r'0/0/1/1/0/4/0/0(/.*)?', 'none', 'sure', '"Attach a bee" absent in live view (code offers "Open agent")'),
    (r'0/0/1/1/0/4/1/0(/.*)?', 'none', 'sure', '"Edit spine" absent'),
    (r'0/0/1/1/0/4/2/0', 'none', 'sure', 'more menu absent'),
    (r'0/0/1/1/1', '0/0/0/1/1', 'sure', 'detail body'),
    (r'0/0/1/1/1/0', '0/0/0/1/1/0', 'sure', 'spine area -> flow canvas'),
    (r'0/0/1/1/1/0/7/0/4', f'{CV}/0/1/0', 'unsure', 'DENIED badge vs DENIED connector label'),
] + spine_rules(TS_CARDS) + detail_tail_rules(CV, '0/0/0/2', '0/0/0/1/2') + [
    (r'0/0/1/1/1/1/1', f'{CV}/14', 'unsure', 'queue: code "up next ..." line under the flow, clipped below visible area'),
    (r'0/0/1/1/1/1/1/[12]/0', f'{CV}/14', 'unsure', 'queued entry is part of the single "up next" line'),
    (r'0/0/1/1/1/1/1/.*', 'none', 'sure', 'queued header/row parts absent'),
    (r'0/0/1/1/1/1/2(/.*)?', 'none', 'sure', '"no pending proposal" absent'),
] + footer_rules('0/0/0/1/2')

# ---------------------------------------------------------------- proposal-pending
PV = '0/0/0/1/1/0/0/0'  # flow canvas content (proposal overlay)
PP_CARDS = [
    (1, f'{PV}/1', 'none', f'{PV}/1/0/0', f'{PV}/1/1', 'none', 'none', 'none', 'sure', 'step card'),
    (2, f'{PV}/3', 'none', f'{PV}/3/0/0', f'{PV}/3/1', f'{PV}/3/2', 'none', 'none', 'sure', 'step card'),
    (3, f'{PV}/5', 'none', 'none', 'none', 'none', 'none', 'none', 'unsure', 'branch row vs untitled parallel frame'),
    (4, f'{PV}/5/0/0/0', 'none', f'{PV}/5/0/0/0/0/0', f'{PV}/5/0/0/0/1', 'none', 'none', 'none', 'sure', 'lane A card'),
    (5, f'{PV}/5/0/1/0', 'none', f'{PV}/5/0/1/0/0/0', f'{PV}/5/0/1/0/1', 'none', 'none', 'none', 'sure', 'lane B card'),
    (6, f'{PV}/7', 'none', f'{PV}/7/0/0', f'{PV}/7/1', f'{PV}/7/2', 'none', 'none', 'sure', 'gate card'),
    (7, f'{PV}/8/1/1/0', 'none', f'{PV}/8/1/1/0/0/0/0', f'{PV}/8/1/1/0/1', f'{PV}/8/1/1/0/0/1', f'{PV}/8/1/1/0/2/1', f'{PV}/0/1/0', 'unsure', 'existing step in design, shown as a proposed ghost card in code'),
    (8, f'{PV}/12', 'none', f'{PV}/12/0/0/0', f'{PV}/12/1', f'{PV}/12/0/1', 'none', 'none', 'unsure', 'existing step in design, shown as a proposed ghost card in code (below visible area)'),
    (9, f'{PV}/14', 'none', f'{PV}/14/0/0', f'{PV}/14/1', f'{PV}/14/2', 'none', 'none', 'sure', 'step card (below visible area)'),
]
DONE_ROWS.clear()
PP_RULES = track_rail_rules() + [
    (r'0/0/1/1', '0/0/0/1', 'sure', 'detail column'),
    (r'0/0/1/1/0', '0/0/0/1/0', 'sure', 'detail header'),
    (r'0/0/1/1/0/0/0', 'none', 'sure', 'header track glyph absent'),
    (r'0/0/1/1/0/1', '0/0/0/1/0/0', 'sure', 'track name'),
    (r'0/0/1/1/0/2', 'none', 'sure', 'version badge absent'),
    (r'0/0/1/1/0/3', 'none', 'unsure', 'description absent; code shows proposal status line in that spot'),
    (r'0/0/1/1/0/4/0/0', '0/0/0/1/0/4', 'unsure', '"Attach a bee" vs disabled "Attach to agent"'),
    (r'0/0/1/1/0/4/0/0/0', '0/0/0/1/0/4', 'unsure', 'button label'),
    (r'0/0/1/1/0/4/0/0/1', 'none', 'sure', 'shortcut hint absent'),
    (r'0/0/1/1/0/4/1/0(/.*)?', 'none', 'sure', '"Edit spine" absent'),
    (r'0/0/1/1/0/4/2/0', 'none', 'sure', 'more menu absent'),
    (r'0/0/1/1/1', '0/0/0/1/1', 'sure', 'detail body'),
    (r'0/0/1/1/1/0', '0/0/0/1/1/0', 'sure', 'spine area -> flow canvas'),
    (r'0/0/1/1/1/0/7/0/4', f'{PV}/0/1/0', 'unsure', 'DENIED badge vs DENIED connector label'),
    (r'0/0/1/1/1/0/7/0/5', f'{PV}/8/1/1/0/2/1', 'sure', 'same text "then back to the gate" as instruction field'),
    (r'0/0/1/1/1/0/8/0/4', f'{PV}/12/2/1', 'unsure', 'description vs TARGET field value'),
    (r'0/0/1/1/1/0/10/0/0/1', 'none', 'sure', 'no exception count in proposal view'),
] + spine_rules(PP_CARDS) + detail_tail_rules(PV, '0/0/0/2', '0/0/0/1/2') + [
    (r'0/0/1/1/1/1/1(/.*)?', 'none', 'sure', 'queued section absent in proposal view'),
    (r'0/0/1/1/1/1/2', f'{PV}/15', 'unsure', 'proposal card vs action bar at end of canvas (below visible area)'),
    (r'0/0/1/1/1/1/2/0/0', 'none', 'sure', 'proposal card header row absent'),
    (r'0/0/1/1/1/1/2/0/0/0', 'none', 'sure', 'PROPOSED EDIT label absent'),
    (r'0/0/1/1/1/1/2/0/0/1', 'none', 'sure', 'author/age absent'),
    (r'0/0/1/1/1/1/2/1', f'{PV}/16', 'unsure', 'proposal rationale; different wording'),
    (r'0/0/1/1/1/1/2/2/0', f'{PV}/12', 'sure', 'added Publish preview change -> ghost card'),
    (r'0/0/1/1/1/1/2/2/0/1', f'{PV}/12/0/1', 'sure', 'kind label'),
    (r'0/0/1/1/1/1/2/2/0/2', f'{PV}/12/1', 'sure', 'title'),
    (r'0/0/1/1/1/1/2/2/0/3', f'{PV}/12/2/1', 'unsure', 'description vs TARGET field'),
    (r'0/0/1/1/1/1/2/3/0', f'{PV}/8/1/1/0', 'unsure', 'changed gate (denied arm gains Fix findings) -> ghost Fix findings card'),
    (r'0/0/1/1/1/1/2/3/0/2', f'{PV}/7/1', 'unsure', 'changed step title'),
    (r'0/0/1/1/1/1/2/4/0', f'{PV}/10', 'sure', 'removed Manual smoke test -> removed card'),
    (r'0/0/1/1/1/1/2/4/0/2', f'{PV}/10/1', 'sure', 'title'),
    (r'0/0/1/1/1/1/2/[234]/0/.*', 'none', 'sure', 'change sign / kind / description absent for this change'),
    (r'0/0/1/1/1/1/2/5', f'{PV}/15', 'unsure', 'proposal footer row vs action bar'),
    (r'0/0/1/1/1/1/2/5/0', 'none', 'sure', '"v3 -> v4 · one pending at a time" absent'),
    (r'0/0/1/1/1/1/2/5/1/0(/0)?', f'{PV}/15/4', 'sure', 'discard button'),
    (r'0/0/1/1/1/1/2/5/2/0(/0)?', f'{PV}/15/2', 'sure', 'accept button'),
    (r'0/0/1/1/1/1/2/5/2/0/1', f'{PV}/15/2/0', 'sure', 'accept shortcut hint'),
] + footer_rules('0/0/0/1/2')
DLABELS_PP = dict(DLABELS)
DLABELS_PP.update({
    '0/0/1/1/1/1/2': 'proposed edit card',
    '0/0/1/1/1/1/2/2/0': 'proposal change row + Publish preview',
    '0/0/1/1/1/1/2/3/0': 'proposal change row ~ Verdict gate',
    '0/0/1/1/1/1/2/4/0': 'proposal change row - Manual smoke test',
    '0/0/1/1/1/1/2/5': 'proposal footer (version note, discard, accept)',
})

# ---------------------------------------------------------------- empty
EM_RULES = [
    (r'0/0', '0/0/0', 'sure', 'whole pane; code pane root has no card background'),
    (r'0/0/0', '0/0/0/0/0', 'unsure', 'title bar vs rail header (only header in code)'),
    (r'0/0/0/0', '0/0/0/0/0/0', 'sure', 'pane name "Tracks" vs "TRACKS"'),
    (r'0/0/0/1', '0/0/0/0/0/1', 'sure', '"none defined" vs count "0"'),
    (r'0/0/0/2(/.*)?', 'none', 'sure', 'more menu absent; code has + button'),
    (r'0/0/1', '0/0/0/1/0', 'sure', 'empty-state body'),
    (r'0/0/1/0/0', '0/0/0/1/0/0', 'sure', 'pixel bee illustration (different sprite)'),
    (r'0/0/1/1', '0/0/0/1/0/1', 'sure', 'empty heading'),
    (r'0/0/1/2', '0/0/0/1/0/2', 'sure', 'explanation copy'),
    (r'0/0/1/3(/0/0)?', '0/0/0/1/0/3', 'sure', 'primary CTA'),
    (r'0/0/1/3/0/0/0', '0/0/0/1/0/3', 'sure', 'CTA label (text sits directly in code button)'),
    (r'0/0/1/3/0/0/1', '0/0/0/1/0/3/0', 'sure', 'CTA shortcut hint'),
    (r'0/0/1/4', 'none', 'sure', 'sidecar hint line absent'),
    (r'0/0/2(/.*)?', 'none', 'sure', 'footer absent in code'),
]
EM_LAYOUT = r'0/0/1|0/0/1/0/0'
EM_SKIP = r'0/0/1/0/0/.+'  # individual bee pixels: label the sprite root only
EM_LABELS = {'0/0': 'pane (white card, 8px radius, shadow)', '0/0/0': 'pane title bar', '0/0/1': 'empty-state body',
             '0/0/1/0/0': 'pixel bee sprite (12x8 grid of 5px pixels)', '0/0/2': 'footer bar',
             '0/0/1/3': 'CTA wrapper', '0/0/1/3/0/0': 'CTA button "Define a track"'}
C_LABELS = {'0/0/0': 'pane root (no background)', '0/0/0/0': 'track rail <aside>', '0/0/0/0/0': 'rail header',
            '0/0/0/0/1': 'rail list', '0/0/0/1': '<main> detail', '0/0/0/1/0': 'detail header (main) / empty body',
            '0/0/0/1/1': 'detail body', '0/0/0/1/1/0': 'flow canvas (dot grid)', '0/0/0/1/2': 'detail footer',
            '0/0/0/2': 'AI sidecar rail'}
EM_CLABELS = {'0/0/0': 'pane root (no background)', '0/0/0/0/0': 'rail header', '0/0/0/1/0': 'empty-state column',
              '0/0/0/1/0/0': 'pixel bee sprite (box-shadow pixels)'}

if __name__ == '__main__':
    emit('track-selected', TS_RULES, SHARED_LAYOUT, None, DLABELS, C_LABELS)
    emit('proposal-pending', PP_RULES, SHARED_LAYOUT, None, DLABELS_PP, C_LABELS)
    emit('empty', EM_RULES, EM_LAYOUT, EM_SKIP, EM_LABELS, EM_CLABELS)
