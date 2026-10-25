"""R1 unique-defect lists, written by eye. One row per user-visible cause."""
import csv, sys

OUT = sys.argv[1]
H = ['id', 'design_layer', 'code_layer', 'kind', 'description', 'severity', 'likely_intentional', 'note', 'properties']

CV = '0/0/0/1/1/0/0/0'

# Rows shared by the two "track open" states (same design board). {cv} = code flow canvas content.
def track_open(prefix, cv, live):
    rows = [
        ('detail', '0/0/1/1/1/0', '0/0/0/1/1/0', 'layout',
         'Spine is a compact list of rows (status, kind, title, description) in design; code draws it as a flow graph of node cards on a dotted canvas, so later steps fall below the visible area (Fix findings, Publish preview, Ship it? need scrolling)',
         'high', 'yes', 'Classic TracksPane says it implements a newer "Tracks · Flow View" design; the .fdn board predates it', 'layout'),
        ('right-col', '0/0/1/1/1/1/0', 'none', 'missing',
         'Attached panel (bees on this track with harness/model, status, age, current step, skipped-step note) is missing',
         'high', 'unsure', 'no Classic surface shows per-bee attachment cards; header shows only one bee in the live view', 'subtree'),
        ('exceptions', '0/0/1/1/1/0/10', 'none', 'missing',
         'Exceptions section under the spine (bee, step, note, age) is missing; code only shows a "1 exception" count in the footer' if live else
         'Exceptions section under the spine is missing in the proposal view',
         'medium', 'unsure', '', 'subtree'),
        ('help-note', '0/0/1/1/1/0/11', f'{cv}/1' if live else 'none', 'text',
         'Help note "Steps are the agent\'s own to mark..." under the spine is missing' + ('; code shows a different note above the flow ("read-only while attached — edits fork the definition for the next run")' if live else ''),
         'low', 'yes', '', 'text'),
        ('pane-header', '0/0/0', '0/0/0/0/0', 'layout',
         'Pane title bar ("Tracks" 15px semibold + "7 defined · 5 attached · 3 queued" + more menu, full width) is replaced by a rail-only header: "TRACKS" 10px spaced caps label, bare count "7" and a + button',
         'medium', 'yes', '', 'text;font-size;letter-spacing;color;layout'),
        ('filter-tabs', '0/0/1/0/0', 'none', 'missing',
         'Filter tabs above the track list (All 7 / Attached 5 / Idle 2) are missing', 'medium', 'unsure', '', 'subtree'),
        ('rail-width', '0/0/1/0', '0/0/0/0', 'layout',
         'Track list column is 317px wide in design, 232px in code', 'medium', 'unsure', '', 'width'),
        ('row-meta', '0/0/1/0/1/*/0/1', '0/0/0/0/1/*/1/1', 'text',
         'Track rows show version, last-activity time and live status counts (2 running · 1 review · 1 exception / no attachments) in design; code shows a static step summary ("7 steps · action ×3 · orch…") and no version or time',
         'high', 'yes', 'code rail is an authoring list; design rail is a live overview', 'text;subtree'),
        ('row-title', '0/0/1/0/1/*/0/0/1', '0/0/0/0/1/*/1/0', 'style',
         'Track row title is 13px (semibold when selected, medium otherwise) in design, 12.5px medium for every row in code; rows are 45px tall in design, 48px in code',
         'low', 'unsure', '', 'font-size;font-weight;height'),
        ('row-selected-bg', '0/0/1/0/1/0/0', '0/0/0/0/1/0', 'token',
         'Selected track row background is warm grey #EEEDE9 in design, light blue #DCE8F8 in code',
         'medium', 'unsure', 'code uses the app-wide railSelection token', 'background-color'),
        ('row-idle-dim', '0/0/1/0/1/5/0;0/0/1/0/1/6/0', '0/0/0/0/1/5;0/0/0/0/1/6', 'style',
         'Idle tracks (dep-bump, nectar-preview) are dimmed in design (muted name #8A877F, faint glyph); code shows them like every other row',
         'low', 'unsure', '', 'color'),
        ('row-glyph', '0/0/1/0/1/*/0/0/0', '0/0/0/0/1/*/0/0', 'style',
         'Track glyph is a small list/spine icon in design, a vertical chain of rings in code', 'low', 'yes', '', 'icon'),
        ('header-meta', '0/0/1/1/0/0;0/0/1/1/0/2;0/0/1/1/0/3', '0/0/0/1/0/1', 'text',
         'Detail header shows track glyph, version badge "v3" and the description in design; code shows only the name plus a status line ' +
         ('("● attached · drone-12 · step 4 of 7")' if live else '("● proposal · 3 changes" in violet)'),
         'medium', 'yes', '', 'text;subtree'),
        ('header-actions-missing', '0/0/1/1/0/4', '0/0/0/1/0/4' if not live else 'none', 'missing',
         'Header actions "Attach a bee (a)", "Edit spine (e)" and the more menu are missing' + ('' if live else '; code offers a greyed "Attach to agent" instead'),
         'medium', 'yes' if live else 'unsure', 'live view is read-only in code' if live else '', 'subtree'),
        ('header-actions-extra', 'none', '0/0/0/1/0/3' + (';0/0/0/1/0/4' if live else ''), 'extra',
         'Code adds a Flow / Code view toggle' + (' and an "Open agent" button' if live else '') + ' to the header', 'low', 'yes', '', 'subtree'),
        ('header-size', '0/0/1/1/0;0/0/1/1/0/1', '0/0/0/1/0;0/0/0/1/0/0', 'style',
         'Detail header is 45px tall with a 14.5px title in design, 40px with a 14px title in code', 'low', 'unsure', '', 'height;font-size'),
        ('main-bg', '0/0/1/1', '0/0/0/1', 'style',
         'Detail area is white in design; in code it has no surface of its own and shows the warm app background #F5F4F1 with a dot grid',
         'medium', 'yes', 'dot grid is part of the flow canvas design', 'background-color;background-image'),
        ('pane-card', '0/0', '0/0/0', 'style',
         'Pane is a white card with 8px corner radius and drop shadow in design; code pane has square corners and no shadow',
         'low', 'yes', 'likely board presentation; in the app the pane chrome comes from the shell', 'border-radius;box-shadow;background-color'),
        ('sidecar-rail', 'none', '0/0/0/2', 'extra',
         'Code adds a 36px AI sidecar rail on the right edge (hex icon + ⌘⌃B)' + ('' if live else ' with a violet proposal dot'), 'medium', 'yes', '', 'subtree'),
        ('footer-text', '0/0/1/1/2', '0/0/0/1/2', 'text',
         'Footer shows key hints "a attach · q queue behind · e edit spine · x exceptions" and "defined 4d ago · 3 versions · promoted on edit" in design; code shows ' +
         ('"hover a step for timestamps · click an exception for the full note" and "● 1 exception"' if live else '"a proposed diff from the sidecar — nothing is real until you accept"'),
         'low', 'yes', '', 'text'),
        ('denied', '0/0/1/1/1/0/7/0/4', f'{cv}/0/1/0', 'style',
         'DENIED marker is an outlined pill on the Fix findings row in brick red #B0512E; code puts "DENIED ↺" on the flow connector in orange #BD6B3C',
         'low', 'unsure', '', 'color;border;position'),
        ('step-kind', '0/0/1/1/1/0/*/0/2;0/0/1/1/1/0/*/0/1', 'none', 'missing',
         'Step rows show a kind icon and kind label (ACTION / ORCHESTRATE / BRANCH / REVIEW / DEPLOY / ASK) in design; ' +
         ('code cards have neither' if live else 'code cards show a generic icon and only some kinds as right-hand meta ("orchestrate", "gate", "blocking")'),
         'medium', 'yes', '', 'subtree;text'),
        ('step-desc', '0/0/1/1/1/0/*/0/4;0/0/1/1/1/0/*/0/5', 'none', 'missing',
         'Step descriptions and LANE A / LANE B tags are missing on the cards' + (' (code shows "done · 11:48" / "upcoming" meta instead)' if live else ''),
         'medium', 'yes', '', 'subtree;text'),
        ('branch-row', '0/0/1/1/1/0/3/0', f'{cv}/6' if live else f'{cv}/5', 'missing',
         'Branch step "Parallel — both lanes must land before the gate" is a titled row in design; code shows only an untitled frame around the two lanes',
         'low', 'yes', '', 'text'),
        ('font-family', '*', '*', 'token',
         'UI text is authored in the system font stack (-apple-system / Helvetica Neue, SF Mono) in design and in Hanken Grotesk / IBM Plex Mono in code',
         'medium', 'yes', 'authored stacks differ, independent of the Linux substitution', 'font-family'),
        ('font-env', '*', 'none', 'environment',
         'Design text renders in Linux substitutes (Liberation/DejaVu) for the Mac system fonts; 500/600 weights snap to 400/700. Not a product defect',
         'low', 'no', 'capture environment only', 'font-family;font-weight(rendered)'),
    ]
    if live:
        rows += [
            ('queue', '0/0/1/1/1/1/1', f'{cv}/14', 'layout',
             'Queued list (bumble-7 behind pr-triage, mite-3 behind spec-round) sits in the right column in design; code shows it as one "up next" line under the flow, below the visible area',
             'medium', 'unsure', '', 'layout;text'),
            ('no-proposal', '0/0/1/1/1/1/2', 'none', 'missing',
             '"no pending proposal" indicator is missing', 'low', 'yes', 'code signals proposals via the sidecar rail dot', 'subtree'),
            ('step-status', '0/0/1/1/1/0/*/0/0', f'{cv}/*/0/0', 'style',
             'Step status markers: done is a filled grey disc with white check (15px) in design, an outlined check-circle (14px) in code; current is a green ring with dot (17px) in design, a plain 8px green dot in code',
             'low', 'unsure', '', 'icon;size;background-color'),
            ('current-step', '0/0/1/1/1/0/5/0', f'{cv}/6/0/1/0/0', 'style',
             'Current step is highlighted by a grey row background in design; code uses a raised white card with semibold title and green "current" label',
             'low', 'yes', '', 'background-color;font-weight;box-shadow'),
            ('upcoming-title', '0/0/1/1/1/0/6/0/3;0/0/1/1/1/0/7/0/3;0/0/1/1/1/0/8/0/3;0/0/1/1/1/0/9/0/3', f'{cv}/8/0/1', 'style',
             'Upcoming step titles are full-ink #2E2B27 in design, muted #8A877F in code', 'low', 'unsure', '', 'color'),
        ]
    else:
        rows += [
            ('proposal-placement', '0/0/1/1/1/1/2', f'{cv}', 'layout',
             'Proposed edit is a card in the right column listing three change rows (+ Publish preview, ~ Verdict gate, − Manual smoke test) in design; code renders the proposal inline on the flow as violet dashed ghost cards and a removed card',
             'high', 'yes', 'TracksProposalOverlay: "violet diff — ghost added cards ... dimmed removals"', 'layout;subtree'),
            ('proposal-actions-hidden', '0/0/1/1/1/1/2/5', f'{cv}/15', 'layout',
             'Accept / discard controls are visible in the proposal card in design; in code the action bar sits at the end of the flow (y≈1030) far below the visible area, so the user must scroll to accept',
             'high', 'no', '', 'position'),
            ('proposal-buttons', '0/0/1/1/1/1/2/5/1/0;0/0/1/1/1/1/2/5/2/0', f'{cv}/15/2;{cv}/15/4', 'style',
             'Proposal buttons: design is bordered "discard" then filled "accept ⌘↵" (accept on the right); code is filled "Accept ⌘↵", bordered "Refine", text-only "Discard ⌘⌫" (accept on the left), labels capitalised',
             'low', 'unsure', '', 'order;border;text-transform;font-weight'),
            ('proposal-refine', 'none', f'{cv}/15/3', 'extra', 'Code adds a "Refine" action for the proposal', 'low', 'yes', '', 'subtree'),
            ('proposal-meta', '0/0/1/1/1/1/2/0/0;0/0/1/1/1/1/2/5/0', '0/0/0/1/0/1', 'missing',
             'Proposal author/age ("sidecar-1 · 2m"), "PROPOSED EDIT" label and the "v3 → v4 · one pending at a time" note are missing',
             'low', 'unsure', '', 'text;subtree'),
            ('proposal-rationale', '0/0/1/1/1/1/2/1', f'{cv}/16', 'text',
             'Proposal rationale reads "The suite passes but nothing publishes a preview for the human — add the deploy the review desk expects." in design; code shows a different summary ("Publish preview after the gate; add Fix findings on denial; replace Ma…") with a violet dot, below the visible area',
             'low', 'unsure', 'may be fixture wording rather than product copy', 'text'),
            ('proposal-ids', 'none', f'{cv}/8/1/1/0/0/2;{cv}/10/2;{cv}/12/0/2;{cv}/15/1', 'extra',
             'Code exposes internal node ids to the user ("n4d · proposed", "n5old · removed", "+n4d · +n5 · −n5old"); design never shows ids',
             'low', 'unsure', '', 'text'),
            ('proposal-no-status', '0/0/1/1/1/0/*/0/0', 'none', 'missing',
             'While a proposal is pending, design keeps the live spine (done/current/upcoming markers), attached bees and queue; code switches to the editing view with no step status, attachments or queue',
             'medium', 'yes', 'code renders proposals in the editing register', 'subtree'),
            ('proposal-change-sign', '0/0/1/1/1/1/2/*/0/0', 'none', 'missing',
             'Change rows are marked + / ~ / − in green / grey / red in design; code marks additions with dashed violet cards and removals with a "removed" label, and the "~ changed" Verdict gate has no marker',
             'low', 'yes', '', 'text;color'),
        ]
    # Added after the blind comparison; appended so earlier ids stay stable.
    rows.append(('spine-header', '0/0/1/1/1/0/0/0', 'none', 'missing',
                 'SPINE section header with the summary "6 items · 1 branch · 9 nodes" above the steps is missing',
                 'low', 'yes', 'added after blind comparison: found by the second labeller (their D17), missed in my first pass', 'subtree'))
    return [(f'{prefix}-{i + 1:02d}',) + r[1:] + (r[0],) for i, r in enumerate(rows)]


def empty():
    rows = [
        ('E-01', '0/0', '0/0/0', 'layout',
         'Empty state is a single full-width pane (title bar, centred message, footer) in design; code keeps the 232px track rail and the 36px sidecar rail, so the message is centred in the middle column only',
         'high', 'yes', 'code always mounts TracksRail and TracksSidecarRail', 'layout;subtree'),
        ('E-02', '0/0/0', '0/0/0/0/0', 'layout',
         'Title bar "Tracks" (15px semibold) + "none defined" + more menu is replaced by the rail header "TRACKS" (10px spaced caps) + "0" + a + button',
         'medium', 'yes', '', 'text;font-size;letter-spacing;color;layout'),
        ('E-03', '0/0/1/0/0', '0/0/0/1/0/0', 'style',
         'Illustration is a 60×40 sideways flying bee (5px pixels, honey/brown with pale wings) in design; code draws a 44×56 upright bee with antennae (4px pixels, dark body with honey stripes)',
         'medium', 'unsure', 'both are called PixelBee; the sprite grid differs', 'icon;size'),
        ('E-04', '0/0/1/1', '0/0/0/1/0/1', 'text',
         'Heading reads "No tracks yet" in design, "Write down how you’d want it done." in code', 'medium', 'yes', '', 'text'),
        ('E-05', '0/0/1/2', '0/0/0/1/0/2', 'text',
         'Explanation copy differs: design "A track is an expected sequence of steps you clip onto one agent. Attaching it injects a standing prompt…" (4 lines, 420px); code "A track is a short list of steps an agent follows and checks off as it works." (2 lines, 380px)',
         'medium', 'yes', '', 'text;width'),
        ('E-06', '0/0/1/2', '0/0/0/1/0/2', 'token',
         'Explanation copy colour is text-muted #8A877F in design, darker #6F6B63 (chipInk) in code', 'low', 'unsure', '', 'color'),
        ('E-07', '0/0/1/3/0/0', '0/0/0/1/0/3', 'text',
         'Primary button reads "Define a track" with shortcut "n" in design, "New track" with shortcut "c" in code', 'medium', 'unsure', 'shortcut letter differs too', 'text'),
        ('E-08', '0/0/1/3/0/0', '0/0/0/1/0/3', 'style',
         'Primary button label is 12px medium white in design, 12.5px semibold cream #FFFDF8 in code; shortcut hint 9.5px at 62% white vs 10px at 80%',
         'low', 'unsure', '', 'font-size;font-weight;color;opacity'),
        ('E-09', '0/0/1/4', 'none', 'missing',
         'Secondary hint "or ask a sidecar agent to draft one — it arrives as a proposal you accept, refine, or discard" is missing',
         'medium', 'unsure', '', 'subtree'),
        ('E-10', '0/0/2', 'none', 'missing',
         'Footer ("n define" · "hive track define · schema v2") is missing', 'low', 'unsure', '', 'subtree'),
        ('E-11', '0/0', '0/0/0/1', 'style',
         'Pane is a white card (8px radius, shadow) in design; code main column has no surface and shows the warm app background #F5F4F1 (rail stays white)',
         'medium', 'yes', '', 'background-color;border-radius;box-shadow'),
        ('E-12', 'none', '0/0/0/2', 'extra', 'Code adds the 36px AI sidecar rail (hex icon + ⌘⌃B) on the right', 'medium', 'yes', '', 'subtree'),
        ('E-13', '0/0/1/1;0/0/1/2;0/0/1/3', '0/0/0/1/0/1;0/0/0/1/0/2;0/0/0/1/0/3', 'layout',
         'Vertical rhythm differs: heading-to-copy gap 16px in design vs 5px in code; illustration-to-heading 20px vs 18px; block sits 39px lower in code',
         'low', 'unsure', '', 'margin'),
        ('E-14', '*', '*', 'token',
         'UI text is authored in the system font stack (-apple-system / Helvetica Neue, SF Mono) in design and in Hanken Grotesk / IBM Plex Mono in code',
         'medium', 'yes', 'authored stacks differ, independent of the Linux substitution', 'font-family'),
        ('E-15', '*', 'none', 'environment',
         'Design text renders in Linux substitutes (Liberation/DejaVu) for the Mac system fonts; 500/600 weights snap to 400/700. Not a product defect',
         'low', 'no', 'capture environment only', 'font-family;font-weight(rendered)'),
    ]
    return [r[:8] + (r[8],) for r in rows]


def write(name, rows):
    with open(f'{OUT}/{name}.defects.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(H)
        for r in rows:
            assert len(r) == len(H), r
            w.writerow(r)
    print(name, len(rows), 'defects;', sum(r[3] != 'environment' for r in rows), 'product')


# track-selected: id S-xx, proposal-pending: id P-xx. The trailing slug is kept in note-free 'properties' order: append as last col.
def finish(rows):
    out = []
    for r in rows:
        rid, dl, cl, kind, d, sev, intent, note, props, slug = r
        out.append((rid, dl, cl, kind, d, sev, intent, (f'[{slug}] ' + note).strip(), props))
    return out


write('track-selected', finish(track_open('S', CV, True)))
write('proposal-pending', finish(track_open('P', CV, False)))
write('empty', empty())
