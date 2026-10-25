import {test,expect} from 'vitest';
import {makeAcceptance,emptyList,bindAccepted,evaluateAccepted,parseList,hasUnacceptedDrift} from './index.ts';
const report=()=>({provable:true,artboard:'tracks',state:'empty',viewport:{width:100,height:100,dpr:1},design:{htmlSha256:'a'.repeat(64),head:'b'.repeat(64)},drifts:[{id:'d1',kind:'text',property:'text',designNode:'title',codeNode:'title',design:'Create track',code:'New track'}],defects:[{id:'f1',layer:{design:'title',code:'title'},kind:'text',cause:'text',classification:'product',findings:['d1'],summary:'button label'}],pixels:{diffRatio:.1},tolerances:{pixelRatio:.001}});
const accepted=()=>({schema:'fdn-accepted/0' as const,entries:[makeAcceptance(report(),'f1','Keep the existing Classic label','Reviewer')]});
test('acceptance records reviewer, exact values and design revision in hashed proof',()=>{
 const r=bindAccepted(report(),accepted()); expect(r.defects[0].accepted.reason).toContain('Classic'); expect(evaluateAccepted(r,accepted()).accepted).toEqual(['f1']); expect(r.acceptedListHash).toHaveLength(64); expect(hasUnacceptedDrift(r,accepted())).toBe(false);
});
test('changed design is stale with actionable message',()=>{const r=report();r.design.head='c'.repeat(64);expect(evaluateAccepted(r,accepted()).errors[0]).toContain('design changed since this difference was accepted; re-review or update the design');});
test('changed code value is stale',()=>{const r=report();r.drifts[0]!.code='Make track';expect(evaluateAccepted(r,accepted()).errors[0]).toContain('code or measured value changed');});
test('raw finding sequence changes do not invalidate acceptance',()=>{const r=report();r.drifts[0]!.id='d9';r.defects[0]!.findings=['d9'];expect(evaluateAccepted(r,accepted()).errors).toEqual([]);});
test('unknown entry fails instead of silently disappearing',()=>{const r=report();r.defects=[];expect(evaluateAccepted(r,accepted()).errors[0]).toContain('unknown accepted difference');});
test('acceptance cannot cross state scope',()=>{const r=report();r.state='selected';expect(evaluateAccepted(r,accepted()).accepted).toEqual([]);expect(hasUnacceptedDrift(r,accepted())).toBe(true);});
test('environment and uncertain findings cannot be accepted',()=>{for(const classification of ['environment','uncertain']) {const r=report();r.defects[0]!.classification=classification;expect(()=>makeAcceptance(r,'f1','reason','reviewer')).toThrow('Only product');}});
test('invalid metadata and duplicate entries fail',()=>{const l=accepted();l.entries.push(l.entries[0]!);expect(()=>parseList(l)).toThrow('Duplicate');expect(()=>makeAcceptance(report(),'f1','','')).toThrow();expect(hasUnacceptedDrift(report(),emptyList())).toBe(true);});
