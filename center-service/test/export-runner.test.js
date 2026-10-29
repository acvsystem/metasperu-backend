import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runExportThread} from '../../shared/center-export-runner.mjs';
test('an export worker exiting cleanly without a result rejects rather than hanging',async()=>{
  const worker=Object.assign(new EventEmitter(),{terminate:async()=>0});
  const result=runExportThread({},'unused',{createWorker:()=>worker});worker.emit('exit',0);
  await assert.rejects(result,/without a result/);
});
test('shutdown aborts the thread and releases the request without a false success',async()=>{
  let terminated=false;const worker=Object.assign(new EventEmitter(),{terminate:async()=>{terminated=true;return 1;}}),abort=new AbortController();
  const result=runExportThread({},'unused',{createWorker:()=>worker,signal:abort.signal});abort.abort();
  await assert.rejects(result,/interrupted/);assert.ok(terminated);
});
