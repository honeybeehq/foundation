import json,sys
d=json.load(open(sys.argv[1]))
for n in d['nodes']:
    s=n['style']; p=n['path']; depth=p.count('.')
    if s.get('display')=='none' or s.get('visibility')=='hidden': continue
    b=[round(v) for v in n['box']]
    if b[2]==0 or b[3]==0: continue
    bits=[]
    if s['background-color'] not in ('rgba(0, 0, 0, 0)',): bits.append('bg='+s['background-color'])
    if any(s[f'border-{x}-width']!='0px' for x in ('top','right','bottom','left')):
        side=[x for x in ('top','right','bottom','left') if s[f'border-{x}-width']!='0px'][0]
        bits.append('bd='+'/'.join(s[f'border-{x}-width'] for x in ('top','right','bottom','left'))+' '+s[f'border-{side}-color']+' '+s[f'border-{side}-style'])
    if s['border-top-left-radius']!='0px': bits.append('r='+s['border-top-left-radius'])
    if s['box-shadow']!='none': bits.append('shadow')
    t=(n.get('text') or '').strip().replace('\n',' ')
    if t: bits.append(f"fs={s['font-size']} fw={s['font-weight']} c={s['color']} ff={n.get('authoredFontFamily','')[:30]} ls={s['letter-spacing']} tt={s['text-transform']}")
    tag=n['tag']+(('#'+n['fdnId']) if n.get('fdnId') else '')
    print(f"{'  '*depth}{p} {tag} {b} {' '.join(bits)} {('«'+t[:70]+'»') if t else ''}")
