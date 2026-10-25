"""TracksPane component: one skeleton per mode (rest / selected / empty).

Selected and empty keep the node ids the Classic code already anchors with
data-fdn-id (n136 n142 n143 n148 n150 n151 n153; n265 n271 n273 n274 n276)."""

def live_root(root_id, ids, height, extra_when):
    i = ids
    return f'''    <div data-fdn-id="{root_id}" when="{extra_when}" data-fdn-style="flow-pane" style="height:{height};width:1416px">
      <div{i('row')} data-fdn-style="fill-row">
        <aside{i('rail')} data-fdn-style="rail">
          <div data-fdn-style="rail-header">
            <span data-fdn-style="rail-label">TRACKS</span>
            <span data-fdn-style="meta-10">7</span>
            <button data-fdn-style="icon-btn" style="color:var(--color-icon-muted)">
              <fdn-use component="FlowGlyph" data-fdn-prop-name="plus" data-fdn-prop-size="12" data-fdn-prop-color="var(--color-icon-muted)"></fdn-use>
            </button>
          </div>
          <div{i('list')} data-fdn-style="rail-list">
            <fdn-use component="RailRow" each="track in data.tracks" data-fdn-prop-name="{{{{ track.name }}}}" data-fdn-prop-meta="{{{{ param.proposalstate == 'pending' ? track.proposalmeta : track.meta }}}}" data-fdn-prop-selected="{{{{ track.id == param.selectedtrack ? 'yes' : 'no' }}}}" data-fdn-prop-attached="{{{{ track.attached }}}}"></fdn-use>
          </div>
        </aside>
        <main{i('main')} data-fdn-style="fill-column">
          <div{i('header')} data-fdn-style="flow-header">
            <span{i('name')} data-fdn-style="flow-header-name">review-and-ship</span>
            <span when="param.proposalstate == 'none'" data-fdn-style="flow-header-status" style="color:var(--color-mono-meta)">
              <fdn-use component="StatusDot" data-fdn-prop-state="running"></fdn-use>
              <span>attached · drone-12 · step 4 of 7</span>
            </span>
            <span when="param.proposalstate == 'pending'" data-fdn-style="flow-header-status" style="color:var(--color-status-merged)">
              <fdn-use component="StatusDot" data-fdn-prop-state="merged" data-fdn-prop-size="6px"></fdn-use>
              <span>proposal · 3 changes</span>
            </span>
            <span style="flex-grow:1;min-width:0"></span>
            <fdn-use component="SegmentedView" data-fdn-prop-code="{{{{ param.proposalstate == 'pending' ? 'disabled' : 'enabled' }}}}"></fdn-use>
            <fdn-use when="param.proposalstate == 'none'" component="ActionButton" data-fdn-prop-label="Open agent"></fdn-use>
            <fdn-use when="param.proposalstate == 'pending'" component="ActionButton" data-fdn-prop-label="Attach to agent" data-fdn-prop-disabled="yes"></fdn-use>
          </div>
          <fdn-use when="param.proposalstate == 'none'" component="LiveFlow"></fdn-use>
          <fdn-use when="param.proposalstate == 'pending'" component="ProposalFlow"></fdn-use>
          <div data-fdn-style="flow-footer">
            <span when="param.proposalstate == 'none'">hover a step for timestamps · click an exception for the full note</span>
            <span when="param.proposalstate == 'none'" style="align-items:center;column-gap:6px;display:flex;margin-left:auto;white-space:nowrap">
              <fdn-use component="StatusDot" data-fdn-prop-state="waiting" data-fdn-prop-size="6px"></fdn-use>
              <span>1 exception</span>
            </span>
            <span when="param.proposalstate == 'pending'">a proposed diff from the sidecar — nothing is real until you accept</span>
          </div>
        </main>
        <fdn-use component="SidecarRail" data-fdn-prop-pending="{{{{ param.proposalstate }}}}"></fdn-use>
      </div>
    </div>
'''

def ids_for(mapping):
    return lambda key: f' data-fdn-id="{mapping[key]}"' if key in mapping else ''

selected = ids_for({'row': 'n142', 'rail': 'n143', 'list': 'n148', 'main': 'n150', 'header': 'n151', 'name': 'n153'})
rest = ids_for({})

EMPTY = '''    <div data-fdn-id="n265" when="prop.mode == 'empty'" data-fdn-style="flow-pane" style="height:468px;width:724px">
      <div data-fdn-style="fill-row">
        <aside data-fdn-style="rail">
          <div data-fdn-style="rail-header">
            <span data-fdn-style="rail-label">TRACKS</span>
            <span data-fdn-style="meta-10">0</span>
            <button data-fdn-style="icon-btn" style="color:var(--color-icon-muted)">
              <fdn-use component="FlowGlyph" data-fdn-prop-name="plus" data-fdn-prop-size="12" data-fdn-prop-color="var(--color-icon-muted)"></fdn-use>
            </button>
          </div>
          <div data-fdn-style="rail-list"></div>
        </aside>
        <main data-fdn-style="fill-column">
          <div data-fdn-id="n271" style="align-items:center;display:flex;flex:1;flex-direction:column;justify-content:center">
            <fdn-use data-fdn-id="n272" component="PixelBee"></fdn-use>
            <div data-fdn-id="n273" style="color:var(--color-text-primary);font-family:var(--font-sans);font-size:var(--font-size-xl);font-weight:var(--font-weight-semibold);margin-top:18px">Write down how you’d want it done.</div>
            <div data-fdn-id="n274" style="color:var(--color-chip-ink);font-family:var(--font-sans);font-size:var(--font-size-md);line-height:1.5;margin-top:6px;max-width:380px;text-align:center">A track is a short list of steps an agent follows and checks off as it works.</div>
            <div style="margin-top:18px">
              <fdn-use data-fdn-id="n276" component="ActionButton" data-fdn-prop-hint="c" data-fdn-prop-label="New track" data-fdn-prop-variant="accent"></fdn-use>
            </div>
          </div>
        </main>
        <fdn-use component="SidecarRail"></fdn-use>
      </div>
    </div>
'''

def tracks_pane():
    return ('  <fdn-component name="TracksPane" hidden>\n    <fdn-props>\n      <fdn-prop name="mode" type="enum" required="true" values="rest,selected,empty"></fdn-prop>\n    </fdn-props>\n'
            + live_root('n71', rest, '525.5px', "prop.mode == 'rest'")
            + live_root('n136', selected, "{{ paneheight[param.proposalstate] }}", "prop.mode == 'selected'")
            + EMPTY + '  </fdn-component>\n')

if __name__ == '__main__':
    print(tracks_pane())
