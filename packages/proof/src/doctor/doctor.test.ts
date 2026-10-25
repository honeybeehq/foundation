import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan, probe } from './check.ts';
import { createServer } from 'node:http';

test('scan follows a relative closure and exposes unresolved aliases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'doctor-'));
 try {
  writeFileSync(join(dir,'View.tsx'),"import {x} from './dependency'; import {y} from '@/store'; export const View=()=>x+y");
  writeFileSync(join(dir,'dependency.ts'),"import 'electron'; export const x=Date.now();");
  const result=scan(dir,'View.tsx#View');
  expect(result.files).toBe(2); expect(result.findings.map(x=>x.kind)).toContain('forbidden-import');
  expect(result.findings.some(x=>x.detail==='Date.now(')).toBe(true); expect(result.externalOrUnresolved).toContain('@/store');
 } finally {rmSync(dir,{recursive:true});}
});

test('runtime distinguishes stable, blocked I/O, provider errors and nondeterminism',async()=>{
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<div id="root">fixture</div><script>${req.url==='/io'?"fetch('/api').catch(()=>{})":req.url==='/error'?"setTimeout(()=>{throw Error('Provider missing')},0)":req.url==='/random'?"document.querySelector('#root').textContent=crypto.randomUUID()":""};setTimeout(()=>{window.__foundationReady=true},20)</script>`);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address(); if (!address || typeof address==='string') throw Error('No server address');
 const url=`http://127.0.0.1:${address.port}`;
 try {
  expect((await probe(url)).verdict).toBe('probe-passed');
  const io=await probe(url+'/io'); expect(io.verdict).toBe('not-provable'); expect(io.runs[0]?.events.some(e=>e.includes('blocked-network'))).toBe(true);
  expect((await probe(url+'/error')).verdict).toBe('not-provable');
  expect((await probe(url+'/random')).deterministic).toBe(false);
 } finally {server.close();}
},60000);
