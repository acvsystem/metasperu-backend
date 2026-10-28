import test from 'node:test';
import assert from 'node:assert/strict';
import { validSpreadsheetHeader } from '../../shared/center-uploads.mjs';
test('uploads reject disguised binaries, traversal filenames and invalid UTF-8',()=>{
  assert.equal(validSpreadsheetHeader('stock.xlsx',Buffer.from('MZ executable')),false);
  assert.equal(validSpreadsheetHeader('../stock.xlsx',Buffer.from([80,75,3,4])),false);
  assert.equal(validSpreadsheetHeader('stock.csv',Buffer.from([0xff,0x00])),false);
  assert.equal(validSpreadsheetHeader('stock.xlsx',Buffer.from([80,75,3,4])),true);
  assert.equal(validSpreadsheetHeader('stock.csv',Buffer.from('codigo,cantidad\n123,10')),true);
});
