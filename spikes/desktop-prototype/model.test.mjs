import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="document-model">([\s\S]*?)<\/script>/)[1];
const model = vm.runInNewContext(`${script}; ({ initialDocument, validNumber, updateNode, createHistory })`, { structuredClone });

test('numeric fields reject missing and nonfinite values and constrain sizes', () => {
  assert.equal(model.validNumber('w', ''), null);
  assert.equal(model.validNumber('x', 'NaN'), null);
  assert.equal(model.validNumber('x', 'Infinity'), null);
  assert.equal(model.validNumber('w', '-8'), 1);
  assert.equal(model.validNumber('opacity', 140), 100);
  assert.equal(model.validNumber('fontSize', 2), 6);
  assert.equal(model.validNumber('x', '-38'), -38);
});
test('a layer edit preserves the original document and other layers', () => {
  const original = model.initialDocument;
  const next = model.updateNode(original, 'heading', { text: 'New heading', x: 42 });
  assert.equal(next.nodes[0].text, 'New heading');
  assert.equal(next.nodes[0].x, 42);
  assert.equal(original.nodes[0].x, 38);
  assert.equal(next.nodes[1], original.nodes[1]);
  assert.equal(next.tokens, original.tokens);
});
test('undo and redo restore whole document edits, including shared tokens', () => {
  const history = model.createHistory(model.initialDocument);
  const next = structuredClone(history.value);
  next.tokens.sage = '#ffffff';
  history.set(next);
  next.tokens.sage = '#000000';
  assert.equal(history.value.tokens.sage, '#ffffff');
  history.undo();
  assert.equal(history.value.tokens.sage, '#dde7c6');
  history.redo();
  assert.equal(history.value.tokens.sage, '#ffffff');
});
test('editing after undo clears redo; no-op updates do not create history', () => {
  const history = model.createHistory({ value: 1 });
  history.set({ value: 1 });
  assert.equal(history.canUndo, false);
  history.set({ value: 2 });
  history.undo();
  history.set({ value: 3 });
  assert.equal(history.canRedo, false);
  history.redo();
  assert.equal(history.value.value, 3);
});
test('history retains at most 80 changes', () => {
  const history = model.createHistory({ value: 0 });
  for (let i = 1; i <= 100; i++) history.set({ value: i });
  for (let i = 0; i < 100; i++) history.undo();
  assert.equal(history.value.value, 20);
});
