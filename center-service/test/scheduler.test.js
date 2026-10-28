import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledOnce } from '../../shared/center-scheduler.mjs';
test('two scheduler instances execute a scheduled occurrence only once', async () => {
  const claims = new Set(); let executed = 0;
  const pool = {execute:async(sql,args)=>{
    if (!sql.startsWith('INSERT')) return [{}];
    const key=args.slice(0,2).join(':');const inserted=!claims.has(key);claims.add(key);return [{affectedRows:Number(inserted)}];
  }};
  const date=new Date('2026-10-28T15:00:00Z');
  await Promise.all([runScheduledOnce(pool,'check',async()=>executed++,date),runScheduledOnce(pool,'check',async()=>executed++,date)]);
  assert.equal(executed,1);
});
