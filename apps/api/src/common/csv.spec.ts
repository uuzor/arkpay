import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, csvDocument } from './csv';

test('csvCell leaves plain values alone, empties nullish', () => {
  assert.equal(csvCell('Ada'), 'Ada');
  assert.equal(csvCell(450), '450');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('csvCell quotes commas, quotes and newlines (RFC 4180)', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
});

test('csvCell stringifies dates and objects', () => {
  assert.equal(csvCell(new Date('2026-11-01T00:00:00Z')), '2026-11-01T00:00:00.000Z');
  assert.equal(csvCell(['A', 'B']), '"[""A"",""B""]"');
});

test('csvDocument joins header + rows with a BOM', () => {
  const doc = csvDocument(['a', 'b'], [[1, 'x,y'], [2, null]]);
  assert.ok(doc.startsWith('\uFEFF'), 'BOM first');
  assert.equal(doc, '\uFEFFa,b\n1,"x,y"\n2,\n');
});
