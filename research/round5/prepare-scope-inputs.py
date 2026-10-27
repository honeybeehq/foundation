"""Input-only scope adapter approved by orchestrator after label release.
Does not import or change any frozen comparison/scoring code.
"""
import csv
import hashlib
import json
from pathlib import Path

root = Path('packages/proof/fixtures/ground-truth-r5-big')
out = Path('research/round5/evaluation-inputs')
out.mkdir(exist_ok=True)
cases = [
    ('help-agent', 'help-center', 'agent-run', 'help/help-center/agent-run/1480x830@1'),
    ('help-split', 'help-search-split', 'split', 'search/help-search-split/split/980x638@1'),
    ('tracks-selected', 'tracks', 'track-selected', 'tracks/tracks-pane/track-selected/1416x720@1'),
    ('tracks-proposal', 'tracks', 'proposal-pending', 'tracks/tracks-pane/proposal-pending/1416x720@1'),
    ('tracks-empty', 'tracks', 'empty', 'tracks/tracks-pane/empty/1416x720@1'),
]
trace = []
manifest = {'frozenRules': 'ac58c1ad1cc69f6ba6d4671dd933441bb996ef63', 'cases': []}
for name, component, state, pair in cases:
    source = root / component / (state + '.defects.csv')
    scope_file = root / component / (state + '.layout-scope.csv')
    with source.open() as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    with scope_file.open() as f:
        scope = {r['id']: r for r in csv.DictReader(f)}
    assert len({r['id'] for r in rows}) == len(rows)
    assert set(scope) == {r['id'] for r in rows}
    derived = []
    for row in rows:
        flag = scope[row['id']]['in_layout_check']
        assert flag in ('yes', 'no')
        kind = 'environment' if row['kind'] == 'environment' else 'layout' if flag == 'yes' else 'non-layout'
        result = {**row, 'kind': kind, 'original_kind': row['kind'], 'in_layout_check': flag}
        assert all(result[k] == row[k] for k in fields if k != 'kind')
        derived.append(result)
    target = out / (name + '-scope.defects.csv')
    with target.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[*fields, 'original_kind', 'in_layout_check'])
        writer.writeheader()
        writer.writerows(derived)
    trace.append({'case': name, 'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'scope': str(scope_file), 'scopeSha256': hashlib.sha256(scope_file.read_bytes()).hexdigest(), 'derived': str(target), 'derivedSha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'rows': [{'id': r['id'], 'originalKind': r['original_kind'], 'scope': r['in_layout_check'], 'evaluationKind': r['kind']} for r in derived]})
    for population, labels in [('kind', source), ('scope', target)]:
        manifest['cases'].append({'name': name + '-' + population, 'pair': 'packages/proof/fixtures/round5-big-panels/captures/' + pair, 'labels': str(labels)})
(out / 'adapter-trace.json').write_text(json.dumps(trace, indent=2) + '\n')
Path('research/round5/scoring-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
