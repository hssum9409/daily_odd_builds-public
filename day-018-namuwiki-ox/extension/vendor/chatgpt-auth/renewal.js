export const RENEWAL_ALARM='chatgpt-renewal';
export const RETRY_KEY='chatgptRenewalRetry';
const MINUTE=60000,WATCHDOG_MINUTES=15;
export const hasOpenChromeWindow=async()=>(await chrome.windows.getAll({windowTypes:['normal','popup']})).some(w=>!w.incognito);
// Called only on the background owner's queue. Persist timings, never tokens.
export class BackgroundRenewal {
  constructor(connection,{alarms=chrome.alarms,storage=chrome.storage.local,now=()=>Date.now(),isActive=hasOpenChromeWindow}={}){
    this.connection=connection;this.alarms=alarms;this.storage=storage;this.now=now;this.isActive=isActive;
  }
  async retry(state){
    const saved=(await this.storage.get(RETRY_KEY))[RETRY_KEY];
    return saved && saved.expires===state?.expires && Number.isFinite(saved.retryAt) && Number.isInteger(saved.failures) && saved.failures>0 ? saved : null;
  }
  async schedule(due){
    const now=this.now(),when=Math.max(now+MINUTE,due),alarm=await this.alarms.get(RENEWAL_ALARM);
    // Do not postpone an imminent alarm on every worker wake or panel request.
    if(alarm?.periodInMinutes===WATCHDOG_MINUTES && alarm.scheduledTime>=due && alarm.scheduledTime<=when+1000)return;
    // The repeating fallback survives interruption between rotation and rescheduling.
    await this.alarms.create(RENEWAL_ALARM,{when,periodInMinutes:WATCHDOG_MINUTES});
  }
  async clear(){await this.alarms.clear(RENEWAL_ALARM);await this.storage.remove(RETRY_KEY);}
  async sync(){
    try{
      const state=await this.connection.renewalState();
      if(!state){await this.clear();return;}
      if(!await this.isActive()){await this.alarms.clear(RENEWAL_ALARM);return;}
      const retry=await this.retry(state);
      if(!retry)await this.storage.remove(RETRY_KEY);
      await this.schedule(Math.max(state.refreshAt,retry?.retryAt || 0));
    }catch{
      // Temporary storage failure must neither forget the account nor stop recovery.
      await this.schedule(this.now()+MINUTE);
    }
  }
  async failed(){
    let state;try{state=await this.connection.renewalState();}catch{state=undefined;}
    if(state===null){await this.clear();return;}
    let previous;try{previous=await this.retry(state);}catch{}
    const failures=Math.min((previous?.failures || 0)+1,6);
    const retryAt=this.now()+Math.min(2**(failures-1),30)*MINUTE;
    try{await this.storage.set({[RETRY_KEY]:{expires:state?.expires,failures,retryAt}});}
    finally{await this.schedule(retryAt);}
  }
  async tick(){
    try{
      const state=await this.connection.renewalState();
      const retry=state?await this.retry(state):null;
      if(state && Math.max(state.refreshAt,retry?.retryAt || 0)<=this.now() && await this.isActive())await this.connection.renew();
    }catch{await this.failed();}
    finally{await this.sync();}
  }
}
