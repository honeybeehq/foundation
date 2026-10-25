"""Assemble the Flow View draft of the Tracks board from the current document.

Usage: python3 -I assemble.py CURRENT.fdn.html OUT.fdn.html
The draft is only an input: the engine diffs it against the chain head and the
changes are committed through `foundation edit` (see commit.ts)."""
import re, sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pane import tracks_pane

cur = open(sys.argv[1]).read()
GEN = os.path.dirname(os.path.abspath(__file__)) + '/'

# ——— tokens: code token values the Flow View uses (packages/ui tokens.stylex.ts) ———
TOKENS = {
  '--art-honey': '#CFA04A', '--art-ink-deep': '#3E3529', '--art-pale': '#E8E2D2',
  '--color-canvas-dot': 'rgba(46,43,39,.16)', '--color-chip-bg': '#EFEEEA', '--color-chip-ink': '#6F6B63',
  '--color-icon-muted': '#6B645B', '--color-label-track': '#9A968D', '--color-meta-faint': '#C5BEB3',
  '--color-mono-meta': '#A7A096', '--color-on-honey': '#FFFDF8', '--color-proposal-wash': 'rgba(139,123,184,.05)',
  '--color-rail-selection': '#DCE8F8', '--color-segment-on': '#FAFAF8',
  '--font-mono': "'IBM Plex Mono', ui-monospace, monospace",
  '--font-sans': "'Hanken Grotesk', system-ui, sans-serif",
  '--font-size-meta': '10px', '--font-size-row': '12.5px', '--font-size-title': '14px',
  '--line-height-ui': '1.45',
  '--shadow-card': '0 1px 2px rgba(40,35,30,.07)', '--shadow-card-current': '0 6px 18px rgba(40,35,30,.1)',
  '--shadow-dock': '0 4px 12px rgba(0,0,0,.08)', '--shadow-segment': '0 1px 2px rgba(40,35,30,.08)',
}
root = re.search(r':root \{\n(.*?)\n  \}', cur, re.S)
decls = dict(re.findall(r'\s*(--[\w-]+): (.*?);', root.group(1)))
decls.update(TOKENS)
body = '\n'.join(f'    {k}: {v};' for k, v in sorted(decls.items()))
cur = cur[:root.start(1)] + body + cur[root.end(1):]

# ——— header block: params, data, lookups, states ———
DOC_HEAD = '''    <fdn-params>
      <fdn-param name="selectedtrack" type="enum" values="review-and-ship,pr-triage,spec-round,board-draw,flaky-hunt,dep-bump,nectar-preview" default="review-and-ship" description="which track definition the rail has selected; the canvas renders that definition. Opening the pane always selects one — there is no unselected view"></fdn-param>
      <fdn-param name="proposalstate" type="enum" values="pending,none" default="pending" description="whether a sidecar agent has a track_propose edit awaiting the human's accept/refine/discard — at most one pending per track. Pending swaps the live register for the proposal register"></fdn-param>
    </fdn-params>
    <fdn-data name="tracks">
      <fdn-item id="review-and-ship" attached="yes" meta="7 steps · action ×3 · orchestrate · review · deploy · ask" name="review-and-ship" proposalmeta="7 steps · action ×4 · orchestrate · review · ask"></fdn-item>
      <fdn-item id="pr-triage" attached="no" meta="5 steps · action ×3 · orchestrate · review" name="pr-triage" proposalmeta="5 steps · action ×3 · orchestrate · review"></fdn-item>
      <fdn-item id="spec-round" attached="no" meta="5 steps · action ×3 · orchestrate · review" name="spec-round" proposalmeta="5 steps · action ×3 · orchestrate · review"></fdn-item>
      <fdn-item id="board-draw" attached="no" meta="5 steps · action ×3 · orchestrate · review" name="board-draw" proposalmeta="5 steps · action ×3 · orchestrate · review"></fdn-item>
      <fdn-item id="flaky-hunt" attached="no" meta="5 steps · action ×3 · orchestrate · review" name="flaky-hunt" proposalmeta="5 steps · action ×3 · orchestrate · review"></fdn-item>
      <fdn-item id="dep-bump" attached="no" meta="4 steps · action ×3 · orchestrate" name="dep-bump" proposalmeta="4 steps · action ×3 · orchestrate"></fdn-item>
      <fdn-item id="nectar-preview" attached="no" meta="5 steps · action ×3 · orchestrate · review" name="nectar-preview" proposalmeta="5 steps · action ×3 · orchestrate · review"></fdn-item>
    </fdn-data>
    <fdn-lookups>
      <fdn-lookup name="cardgap">
        <fdn-entry key="lane" value="8px"></fdn-entry>
        <fdn-entry key="spine" value="9px"></fdn-entry>
        <fdn-entry key="wide" value="9px"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="cardopacity">
        <fdn-entry key="current" value="1"></fdn-entry>
        <fdn-entry key="definition" value="0.78"></fdn-entry>
        <fdn-entry key="done" value="0.62"></fdn-entry>
        <fdn-entry key="removed" value="0.55"></fdn-entry>
        <fdn-entry key="upcoming" value="1"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="cardpadx">
        <fdn-entry key="lane" value="13px"></fdn-entry>
        <fdn-entry key="spine" value="14px"></fdn-entry>
        <fdn-entry key="wide" value="14px"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="cardpady">
        <fdn-entry key="current" value="12px"></fdn-entry>
        <fdn-entry key="definition" value="10px"></fdn-entry>
        <fdn-entry key="done" value="10px"></fdn-entry>
        <fdn-entry key="removed" value="10px"></fdn-entry>
        <fdn-entry key="upcoming" value="10px"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="cardshadow">
        <fdn-entry key="current" value="var(--shadow-card-current)"></fdn-entry>
        <fdn-entry key="definition" value="var(--shadow-card)"></fdn-entry>
        <fdn-entry key="done" value="var(--shadow-card)"></fdn-entry>
        <fdn-entry key="removed" value="var(--shadow-card)"></fdn-entry>
        <fdn-entry key="upcoming" value="var(--shadow-card)"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="cardwidth">
        <fdn-entry key="lane" value="100%"></fdn-entry>
        <fdn-entry key="spine" value="auto"></fdn-entry>
        <fdn-entry key="wide" value="480px"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="glyphcolor">
        <fdn-entry key="ask" value="var(--color-status-review)"></fdn-entry>
        <fdn-entry key="deploy" value="var(--color-status-blocked)"></fdn-entry>
        <fdn-entry key="gate" value="var(--color-status-review)"></fdn-entry>
        <fdn-entry key="lines" value="var(--color-text-muted)"></fdn-entry>
        <fdn-entry key="orchestrate" value="var(--color-status-merged)"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="metasize">
        <fdn-entry key="current" value="var(--font-size-xs)"></fdn-entry>
        <fdn-entry key="definition" value="var(--font-size-meta)"></fdn-entry>
        <fdn-entry key="done" value="var(--font-size-xs)"></fdn-entry>
        <fdn-entry key="removed" value="var(--font-size-meta)"></fdn-entry>
        <fdn-entry key="upcoming" value="var(--font-size-xs)"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="paneheight">
        <fdn-entry key="none" value="525.5px"></fdn-entry>
        <fdn-entry key="pending" value="611px"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="statuscolor">
        <fdn-entry key="blocked" value="var(--color-status-blocked)"></fdn-entry>
        <fdn-entry key="done" value="var(--color-status-done)"></fdn-entry>
        <fdn-entry key="merged" value="var(--color-status-merged)"></fdn-entry>
        <fdn-entry key="review" value="var(--color-status-review)"></fdn-entry>
        <fdn-entry key="running" value="var(--color-status-running)"></fdn-entry>
        <fdn-entry key="waiting" value="var(--color-status-waiting)"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="titlecolor">
        <fdn-entry key="current" value="var(--color-text-primary)"></fdn-entry>
        <fdn-entry key="definition" value="var(--color-text-primary)"></fdn-entry>
        <fdn-entry key="done" value="var(--color-text-primary)"></fdn-entry>
        <fdn-entry key="removed" value="var(--color-text-muted)"></fdn-entry>
        <fdn-entry key="upcoming" value="var(--color-text-muted)"></fdn-entry>
      </fdn-lookup>
      <fdn-lookup name="titleweight">
        <fdn-entry key="current" value="var(--font-weight-semibold)"></fdn-entry>
        <fdn-entry key="definition" value="var(--font-weight-medium)"></fdn-entry>
        <fdn-entry key="done" value="var(--font-weight-medium)"></fdn-entry>
        <fdn-entry key="removed" value="var(--font-weight-medium)"></fdn-entry>
        <fdn-entry key="upcoming" value="var(--font-weight-medium)"></fdn-entry>
      </fdn-lookup>
    </fdn-lookups>
    <fdn-states>
      <fdn-state name="at-rest" proposalstate="none" selectedtrack="review-and-ship"></fdn-state>
      <fdn-state name="track-selected" proposalstate="none" selectedtrack="review-and-ship"></fdn-state>
      <fdn-state name="proposal-pending" proposalstate="pending" selectedtrack="review-and-ship"></fdn-state>
    </fdn-states>
'''
a = cur.index('    <fdn-params>'); b = cur.index('    <fdn-matrix>')
cur = cur[:a] + DOC_HEAD + cur[b:]
cur = cur.replace('data-fdn-title="Apiary — Tracks pane"', 'data-fdn-title="Apiary — Tracks pane · Flow View"')
cur = cur.replace('<title>Apiary — Tracks pane</title>', '<title>Apiary — Tracks pane · Flow View</title>')

# ——— named styles ———
STYLES = open(GEN + 'styles.html').read()
a = cur.index('  <fdn-styles hidden>'); b = cur.index('  </fdn-styles>') + len('  </fdn-styles>\n')
cur = cur[:a] + STYLES + cur[b:]

# ——— components: keep BoardCaption, everything else from the draft ———
comps = {}
for m in re.finditer(r'  <fdn-component name="(\w+)" hidden>.*?</fdn-component>\n', cur, re.S):
    comps[m.group(1)] = m.group(0)
first = cur.index('  <fdn-component '); last = cur.rindex('</fdn-component>\n') + len('</fdn-component>\n')
new = {'BoardCaption': comps['BoardCaption']}
for m in re.finditer(r'  <fdn-component name="(\w+)" hidden>.*?</fdn-component>\n', open(GEN + 'components.html').read(), re.S):
    new[m.group(1)] = m.group(0)
new['TracksPane'] = tracks_pane()
cur = cur[:first] + ''.join(new[k] for k in sorted(new)) + cur[last:]

# ——— boards ———
a = cur.index('  <main>'); b = cur.index('  </main>') + len('  </main>\n')
cur = cur[:a] + open(GEN + 'main.html').read() + cur[b:]

# ——— ids for every new element (n400+), so diffs and anchors stay stable ———
counter = [400]
def mint(m):
    tag = m.group(1)
    if tag.startswith('fdn-') and tag != 'fdn-use': return m.group(0)
    if tag in ('html', 'head', 'meta', 'title', 'style', 'body') or (tag == 'main' and not m.group(2)) or 'data-fdn-id=' in m.group(0): return m.group(0)
    counter[0] += 1
    return f'<{tag} data-fdn-id="n{counter[0]}"' + m.group(2) + '>'
start = cur.index('  <fdn-component ')
cur = cur[:start] + re.sub(r'<([a-z][\w-]*)([^>]*)>', mint, cur[start:])
open(sys.argv[2], 'w').write(cur)
print('minted up to n%d' % counter[0])
