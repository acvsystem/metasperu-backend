import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { csvCell,artifactPath } from '../../shared/center-export-files.mjs';
import { validateExport } from '../../shared/center-export-jobs.mjs';
import { createExportController } from '../../shared/center-export-controller.mjs';
test('exports escape spreadsheet formulas, quotes and newlines',()=>{
  assert.equal(csvCell(' =HYPERLINK("bad")'), '"\' =HYPERLINK(""bad"")"');
  assert.equal(csvCell('a\nb'), '"a\nb"');assert.equal(csvCell(-3),'-3');
});
test('artifact paths require generated UUIDs and never accept traversal',()=>{
  const root=path.resolve('private-qa-exports');
  assert.throws(()=>artifactPath(root,'../../secret','x'));
  assert.ok(artifactPath(root,'12345678-1234-4234-8234-123456789012','12345678-1234-4234-8234-123456789012').endsWith('.csv'));
});
test('nonadministrators cannot create, read, cancel or download these exports',async()=>{
  const controller=createExportController({pool:{execute:()=>{throw Error('must not query');}},root:path.resolve('private-qa-exports'),enabled:true});
  for(const method of ['create','get','cancel','download']){
    const res={status(code){this.code=code;return this;},json(){}};
    await controller[method]({user:{id:1,role:'TIENDA'}},res);assert.equal(res.code,403);
  }
});
test('export contracts reject arbitrary SQL resources and excessive filters',()=>{
  assert.throws(()=>validateExport({kind:'tb_login'}));
  assert.throws(()=>validateExport({kind:'transfers',q:'x'.repeat(121)}));
  assert.deepEqual(validateExport({kind:'transfers',q:' QA '}),{kind:'transfers',parameters:{q:'QA'}});
});
