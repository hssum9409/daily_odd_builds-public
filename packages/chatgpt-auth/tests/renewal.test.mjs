import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundRenewal,RENEWAL_ALARM,RETRY_KEY,hasOpenChromeWindow} from '../src/renewal.js';
const DAY=86400000;
function setup(){
  let clock=1000000,state={expires:1000000+30*DAY,refreshAt:1000000+20*DAY},alarm,rotations=0,error,readError=false,active=true;
  const saved={},alarms={async get(){return alarm;},async create(name,o){assert.equal(name,RENEWAL_ALARM);alarm={scheduledTime:o.when,periodInMinutes:o.periodInMinutes};},async clear(){alarm=undefined;}};
  const storage={async get(){return structuredClone(saved);},async set(o){Object.assign(saved,structuredClone(o));},async remove(k){delete saved[k];}};
  const connection={async renewalState(){if(readError)throw Error('disk unavailable');return state;},async renew(){rotations++;if(error)throw error;state={expires:clock+30*DAY,refreshAt:clock+20*DAY};}};
  const options={alarms,storage,now:()=>clock,isActive:async()=>active};
  return {renewer:new BackgroundRenewal(connection,options),restart:()=>new BackgroundRenewal(connection,options),saved,alarms,get alarm(){return alarm;},get rotations(){return rotations;},get state(){return state;},set state(v){state=v;},set now(v){clock=v;},get now(){return clock;},set error(v){error=v;},set readError(v){readError=v;},set active(v){active=v;}};
}
test('schedules near expiry, not on every wake; imminent alarm is never postponed',async()=>{
  const q=setup();await q.renewer.sync();assert.equal(q.alarm.scheduledTime,q.state.refreshAt);assert.equal(q.alarm.periodInMinutes,15);
  q.now=q.state.refreshAt-10000;await q.renewer.sync();assert.equal(q.alarm.scheduledTime,q.state.refreshAt);assert.equal(q.rotations,0);
});
test('account inside renewal window restores missing alarm; delayed wake rotates once',async()=>{
  const q=setup();q.now=q.state.refreshAt+100000;await q.renewer.sync();assert.equal(q.alarm.scheduledTime,q.now+60000);
  await q.restart().tick();assert.equal(q.rotations,1);assert.equal(q.alarm.scheduledTime,q.state.refreshAt);await q.renewer.tick();assert.equal(q.rotations,1);
});
test('early and duplicate alarms never rotate a valid token',async()=>{
  const q=setup();await q.renewer.tick();await q.renewer.tick();assert.equal(q.rotations,0);assert.equal(q.alarm.scheduledTime,q.state.refreshAt);
});
test('temporary failures retain account and back off 1/2/4/8/16/30 minutes across owner restarts',async()=>{
  const q=setup();q.now=q.state.refreshAt;q.error=Error('offline');
  for(const delay of [1,2,4,8,16,30,30]){
    await q.restart().tick();const retry=q.saved[RETRY_KEY];assert.equal(retry.retryAt-q.now,delay*60000);assert.equal(q.alarm.scheduledTime,retry.retryAt);
    const count=q.rotations;await q.restart().tick();assert.equal(q.rotations,count);q.now=retry.retryAt;
  }
  q.error=null;await q.renewer.tick();assert.equal(q.saved[RETRY_KEY],undefined);assert.equal(q.alarm.scheduledTime,q.state.refreshAt);
});
test('foreground rotation discards obsolete retry, logout and revocation remove all schedules',async()=>{
  const q=setup();q.now=q.state.refreshAt;q.error=Error('offline');await q.renewer.tick();assert.ok(q.saved[RETRY_KEY]);
  q.state={expires:q.now+30*DAY,refreshAt:q.now+20*DAY};await q.renewer.sync();assert.equal(q.saved[RETRY_KEY],undefined);assert.equal(q.alarm.scheduledTime,q.state.refreshAt);
  q.state=null;await q.renewer.sync();assert.equal(q.alarm,undefined);await q.renewer.tick();assert.equal(q.alarm,undefined);assert.equal(q.rotations,1);
});
test('storage outage preserves a repeating recovery alarm and recovers on next wake',async()=>{
  const q=setup();q.readError=true;await q.renewer.sync();assert.equal(q.alarm.scheduledTime,q.now+60000);assert.equal(q.alarm.periodInMinutes,15);
  q.readError=false;await q.renewer.tick();assert.equal(q.alarm.scheduledTime,q.state.refreshAt);assert.equal(q.rotations,0);
});
test('background-only Chrome does not renew; opening a window restores the deadline',async()=>{
  const q=setup();q.now=q.state.refreshAt;q.active=false;await q.renewer.sync();await q.renewer.tick();assert.equal(q.alarm,undefined);assert.equal(q.rotations,0);
  q.active=true;await q.renewer.sync();assert.equal(q.alarm.scheduledTime,q.now+60000);await q.renewer.tick();assert.equal(q.rotations,1);
});
test('closing Chrome windows preserves backoff but removes wakeups until opened again',async()=>{
  const q=setup();q.now=q.state.refreshAt;q.error=Error('offline');await q.renewer.tick();const retry=q.saved[RETRY_KEY];
  q.active=false;await q.renewer.sync();assert.equal(q.alarm,undefined);assert.deepEqual(q.saved[RETRY_KEY],retry);
  q.active=true;await q.renewer.sync();assert.equal(q.alarm.scheduledTime,retry.retryAt);await q.renewer.tick();assert.equal(q.rotations,1);
});
test('ordinary open Chrome window counts as active without focus; incognito alone does not',async()=>{
  for(const [windows,expected] of [[[],false],[[{incognito:true}],false],[[{incognito:false,focused:false}],true]]){
    globalThis.chrome={windows:{async getAll(options){assert.deepEqual(options.windowTypes,['normal','popup']);return windows;}}};assert.equal(await hasOpenChromeWindow(),expected);
  }
});
