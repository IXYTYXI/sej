import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/sqlite.ts';
import { createLearningService } from '../lib/server-core.ts';

const DAY = 86400000;
const start = Date.parse('2026-10-12T09:00:00Z');
const words = ['en','ja'].flatMap(language=>Array.from({length:260},(_,i)=>({id:`${language}-${i}`,language,word:`${language} word ${i}`,reading:'',meaning:`释义 ${i}`,tags:[],source:'test'})));
const catalog = {courses:[],sources:[],words,stages:['en','ja'].map(language=>({id:`${language}-stage`,courseId:language,language,title:language,index:1,prerequisiteId:null,wordIds:words.filter(word=>word.language===language).map(word=>word.id)}))};
function setup(t,hooks={}) {
  const db = openDatabase(':memory:');
  t.after(()=>db.close());
  if(hooks.afterFirst) {
    const originalPrepare=db.prepare;
    db.prepare=query=>{
      const decorate=statement=>{
        const bind=statement.bind;
        const first=statement.first;
        statement.bind=(...values)=>decorate(bind(...values));
        statement.first=async()=>{const row=await first();await hooks.afterFirst(query,row);return row};
        return statement;
      };
      return decorate(originalPrepare(query));
    };
  }
  let now=start;
  const service=(userId='u1')=>createLearningService(db,catalog,{userId,displayName:'Learner'},()=>now);
  return {db,service:service(),forUser:service,setTime:value=>{now=value}};
}
const quota=async(service,language='en')=>(await service.state(language)).quota;
const command=(q,action='boost',amount=10,other={})=>({language:'en',action,...(action==='boost'?{amount}:{}),day:q.day,version:q.version,requestId:crypto.randomUUID(),...other});
const review=(wordId,version=0,requestId=crypto.randomUUID())=>({wordId,version,requestId,rating:3});
const count=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;

test('quota initializes per user and language with the configured baseline and three chances',async t=>{
  const {service,forUser,db}=setup(t);
  const first=await quota(service);
  assert.deepEqual(first,{day:'2026-10-12',baseLimit:10,limit:10,boostsUsed:0,boostsRemaining:3,needsDecision:false,previousDay:null,previousLimit:null,version:1,boosts:[]});
  assert.deepEqual(await quota(service,'ja'),first);
  await service.settings({dailyNewLimit:15});
  assert.equal((await quota(service)).limit,15);
  assert.equal((await quota(forUser('u2'))).limit,10);
  assert.equal(await count(db,'SELECT COUNT(*) n FROM daily_quotas'),3);
});

test('three boosts add 10 then 1 through 100, and request replay preserves the original response',async t=>{
  const {service,db}=setup(t);
  let q=await quota(service);
  const first=command(q);
  const firstResult=await service.adjustQuota(first);
  assert.equal(firstResult.quota.limit,20);
  q=(await service.adjustQuota(command(firstResult.quota,'boost',1))).quota;
  q=(await service.adjustQuota(command(q,'boost',100))).quota;
  assert.equal(q.limit,121);
  assert.deepEqual(q.boosts,[10,1,100]);
  assert.equal(q.boostsUsed,3);
  assert.equal(q.boostsRemaining,0);
  assert.equal(q.version,4);
  await assert.rejects(service.adjustQuota(command(q,'boost',1)),{status:409});
  assert.deepEqual(await service.adjustQuota(first),firstResult);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action='boost'"),3);
  const event=await db.prepare("SELECT before_state,result FROM quota_events WHERE user_id='u1' AND request_id=?").bind(first.requestId).first();
  assert.equal(JSON.parse(event.before_state).limit,10);
  assert.deepEqual(JSON.parse(event.result),firstResult);
});

test('boosts and receipts are independent by language and learner',async t=>{
  const {service,forUser}=setup(t);
  const request=command(await quota(service));
  await service.adjustQuota(request);
  const japanese=await quota(service,'ja');
  assert.equal(japanese.boostsUsed,0);
  assert.equal((await service.adjustQuota(command(japanese,'boost',10,{language:'ja'}))).quota.limit,20);
  assert.equal((await forUser('u2').adjustQuota(request)).quota.limit,20);
  assert.equal((await quota(service)).boostsUsed,1);
});

test('quota input rejects invalid values, ambiguous payloads and reused request identifiers',async t=>{
  const {service}=setup(t);
  const q=await quota(service);
  const request=command(q);
  for(const change of [{language:'fr'},{action:'unlock'},{amount:undefined},{amount:0},{amount:101},{amount:1.5},{amount:'10'},{amount:11},{version:0},{version:1.5},{version:Number.MAX_SAFE_INTEGER+1},{day:'2026-1-1'},{day:'2026-02-30'},{requestId:'bad'},{unknown:true}]) {
    await assert.rejects(service.adjustQuota({...request,...change}),{status:400});
  }
  const result=await service.adjustQuota(request);
  await assert.rejects(service.adjustQuota({...request,language:'ja'}),{status:409});
  await assert.rejects(service.adjustQuota(command(result.quota,'keep',undefined,{amount:1})),{status:400});
  await assert.rejects(service.adjustQuota(command(result.quota,'keep')),{status:409});
});

test('Shanghai day rollover asks to retain increased allowance and resets the three chances',async t=>{
  const {service,setTime}=setup(t);
  let q=(await service.adjustQuota(command(await quota(service)))).quota;
  q=(await service.adjustQuota(command(q,'boost',20))).quota;
  setTime(Date.parse('2026-10-12T15:59:59.999Z'));
  assert.equal((await quota(service)).day,'2026-10-12');
  setTime(Date.parse('2026-10-12T16:00:00Z'));
  q=await quota(service);
  assert.equal(q.day,'2026-10-13');
  assert.equal(q.limit,40);
  assert.equal(q.needsDecision,true);
  assert.equal(q.previousDay,'2026-10-12');
  assert.equal(q.previousLimit,40);
  assert.equal(q.boostsUsed,0);
  assert.deepEqual(q.boosts,[]);
  await assert.rejects(service.adjustQuota(command(q)),{status:409});
  q=(await service.adjustQuota(command(q,'keep'))).quota;
  assert.equal(q.needsDecision,false);
  assert.equal(q.limit,40);
  assert.equal(q.boostsRemaining,3);
  q=(await service.adjustQuota(command(q))).quota;
  assert.equal(q.limit,50);
  assert.deepEqual(q.boosts,[10]);
});

test('returning after several days inherits additions and days without additions never ask',async t=>{
  const {service,setTime}=setup(t);
  await quota(service,'ja');
  await service.adjustQuota(command(await quota(service)));
  setTime(start+5*DAY);
  const english=await quota(service);
  const japanese=await quota(service,'ja');
  assert.equal(english.needsDecision,true);
  assert.equal(english.previousDay,'2026-10-12');
  assert.equal(english.limit,20);
  assert.equal(japanese.needsDecision,false);
  assert.equal(japanese.limit,10);
  assert.equal(japanese.boostsRemaining,3);
});

test('pending decision serves due reviews but blocks cached and directly submitted new words',async t=>{
  const {service,setTime}=setup(t);
  const oldQueue=await service.study('en');
  await service.review(review('en-0'));
  await service.adjustQuota(command(await quota(service)));
  setTime(start+DAY);
  const pending=await service.study('en');
  assert.equal(pending.quota.needsDecision,true);
  assert.equal(pending.newRemaining,0);
  assert.equal(pending.cards.length,1);
  assert.equal(pending.cards[0].isNew,false);
  assert.ok(oldQueue.cards.some(word=>word.id==='en-1'));
  await assert.rejects(service.review(review('en-1')),{status:409});
  await service.review(review('en-0',1));
  const q=(await service.adjustQuota(command(pending.quota,'keep'))).quota;
  assert.equal(q.needsDecision,false);
  await service.review(review('en-1'));
});

test('reset clears only the additions and preserves study, exam, unlock and audit history',async t=>{
  const {service,db,setTime}=setup(t);
  await service.review(review('en-0'));
  await service.adjustQuota(command(await quota(service)));
  await db.batch([
    db.prepare('INSERT INTO exams (id,user_id,stage_id,data,created_at,expires_at,result) VALUES (?,?,?,?,?,?,?)').bind('exam','u1','en-stage','{}',start,start+DAY,'{"passed":true}'),
    db.prepare('INSERT INTO passes VALUES (?,?,?)').bind('u1','en-stage',start),
    db.prepare('INSERT INTO unlocks VALUES (?,?,?)').bind('u1','later-stage',start),
  ]);
  setTime(start+DAY);
  const reset=(await service.adjustQuota(command(await quota(service),'reset'))).quota;
  assert.equal(reset.limit,10);
  assert.equal(reset.needsDecision,false);
  assert.equal(reset.boostsRemaining,3);
  for(const table of ['cards','review_events','exams','passes','unlocks'])assert.equal(await count(db,`SELECT COUNT(*) n FROM ${table}`),1);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action IN ('boost','reset')"),2);
  setTime(start+2*DAY);
  assert.equal((await quota(service)).needsDecision,false);
});

test('baseline changes preserve additions, attempts and pending decisions for initialized languages',async t=>{
  const {service,setTime}=setup(t);
  let english=(await service.adjustQuota(command(await quota(service)))).quota;
  const japanese=await quota(service,'ja');
  await service.settings({dailyNewLimit:15});
  english=await quota(service);
  assert.equal(english.baseLimit,15);
  assert.equal(english.limit,25);
  assert.equal(english.boostsUsed,1);
  assert.equal((await quota(service,'ja')).limit,15);
  assert.equal((await quota(service,'ja')).version,japanese.version+1);
  await service.settings({dailyNewLimit:10});
  assert.equal((await quota(service)).limit,20);
  assert.equal((await quota(service)).boostsUsed,1);
  setTime(start+DAY);
  await quota(service);
  await service.settings({dailyNewLimit:5});
  english=await quota(service);
  assert.equal(english.limit,15);
  assert.equal(english.needsDecision,true);
  assert.equal(english.boostsUsed,0);
  assert.equal((await service.state('en')).settings.dailyNewLimit,5);
});

test('changing baseline before first return inherits only the old additions using the new baseline',async t=>{
  const {service,setTime}=setup(t);
  await service.settings({dailyNewLimit:5});
  await service.adjustQuota(command(await quota(service)));
  setTime(start+DAY);
  await service.settings({dailyNewLimit:25});
  const q=await quota(service);
  assert.equal(q.baseLimit,25);
  assert.equal(q.limit,35);
  assert.equal(q.previousLimit,15);
  assert.equal(q.needsDecision,true);
});

test('a boost changes the real review admission limit and simultaneous new words cannot exceed it',async t=>{
  const {service,db}=setup(t);
  await service.settings({dailyNewLimit:5});
  for(let i=0;i<5;i++)await service.review(review(`en-${i}`));
  await assert.rejects(service.review(review('en-5')),{status:409});
  const q=(await service.adjustQuota(command(await quota(service)))).quota;
  assert.equal(q.limit,15);
  const attempts=await Promise.allSettled(Array.from({length:11},(_,i)=>service.review(review(`en-${i+5}`))));
  assert.equal(attempts.filter(attempt=>attempt.status==='fulfilled').length,10);
  assert.equal(await count(db,'SELECT COUNT(*) n FROM review_events WHERE new_word=1'),15);
  assert.equal((await service.study('en')).newRemaining,0);
});

test('concurrent boosts from one version admit once, and identical concurrent retries share one receipt',async t=>{
  const {service,db}=setup(t);
  let q=await quota(service);
  const conflict=await Promise.allSettled([service.adjustQuota(command(q)),service.adjustQuota(command(q))]);
  assert.equal(conflict.filter(result=>result.status==='fulfilled').length,1);
  q=await quota(service);
  const request=command(q,'boost',7);
  const retries=await Promise.all([service.adjustQuota(request),service.adjustQuota(request)]);
  assert.deepEqual(retries[0],retries[1]);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action='boost'"),2);
  assert.deepEqual((await quota(service)).boosts,[10,7]);
});

test('keep and reset race admits one decision and the loser cannot overwrite it',async t=>{
  const {service,db,setTime}=setup(t);
  await service.adjustQuota(command(await quota(service)));
  setTime(start+DAY);
  const q=await quota(service);
  const results=await Promise.allSettled([service.adjustQuota(command(q,'keep')),service.adjustQuota(command(q,'reset'))]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const current=await quota(service);
  assert.equal(current.needsDecision,false);
  assert.equal(current.version,2);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action IN ('keep','reset')"),1);
  await assert.rejects(service.adjustQuota(command(current,'reset')),{status:409});
});

test('day rollover rejects stale actions, while replay returns yesterday receipt without mutating today',async t=>{
  const {service,db,setTime}=setup(t);
  const q=await quota(service);
  const accepted=command(q);
  const result=await service.adjustQuota(accepted);
  const stale=command(result.quota,'boost',9);
  setTime(start+DAY);
  await assert.rejects(service.adjustQuota(stale),{status:409});
  assert.deepEqual(await service.adjustQuota(accepted),result);
  const today=await quota(service);
  assert.equal(today.boostsUsed,0);
  assert.equal(today.needsDecision,true);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action='boost'"),1);
});

test('a settings change makes an older quota version stale without returning boost chances',async t=>{
  const {service}=setup(t);
  let q=await quota(service);
  for(const amount of [10,2,3])q=(await service.adjustQuota(command(q,'boost',amount))).quota;
  await service.settings({dailyNewLimit:15});
  await assert.rejects(service.adjustQuota(command(q,'boost',1)),{status:409});
  const updated=await quota(service);
  assert.equal(updated.boostsUsed,3);
  assert.equal(updated.limit,30);
  await service.settings({dailyNewLimit:10});
  assert.equal((await quota(service)).boostsRemaining,0);
});

test('quota initialization and settings cannot leave a row using a stale baseline',async t=>{
  const {service}=setup(t);
  const [english,japanese]=await Promise.all([service.state('en'),service.state('ja'),service.settings({dailyNewLimit:35})]);
  assert.equal(english.settings.dailyNewLimit,english.quota.baseLimit);
  assert.equal(japanese.settings.dailyNewLimit,japanese.quota.baseLimit);
  for(const language of ['en','ja']) {
    const q=await quota(service,language);
    assert.equal(q.baseLimit,35);
    assert.equal(q.limit,35);
  }
});

test('limit overflow rejects the entire mutation and cannot partially change settings',async t=>{
  const {service,db}=setup(t);
  await quota(service);
  await db.prepare("UPDATE daily_quotas SET quota_limit=2147483647 WHERE user_id='u1' AND language='en'").run();
  const q=await quota(service);
  await assert.rejects(service.adjustQuota(command(q)),{status:409});
  await assert.rejects(service.settings({dailyNewLimit:50}),{status:409});
  const state=await service.state('en');
  assert.equal(state.settings.dailyNewLimit,10);
  assert.equal(state.quota.limit,2147483647);
  assert.equal(state.quota.boostsUsed,0);
});

test('quota decisions, chances and original receipts persist across independent SQLite connections and restart',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'wordsteps-quota-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'learning.sqlite');
  const first=openDatabase(filename),second=openDatabase(filename);
  let request,result;
  try {
    const a=createLearningService(first,catalog,{userId:'u1',displayName:'Learner'},()=>start);
    const b=createLearningService(second,catalog,{userId:'u1',displayName:'Learner'},()=>start);
    request=command(await quota(a));
    const results=await Promise.all([a.adjustQuota(request),b.adjustQuota(request)]);
    assert.deepEqual(results[0],results[1]);result=results[0];
    assert.equal((await quota(b)).boostsUsed,1);
  } finally {first.close();second.close()}
  const reopened=openDatabase(filename);
  try {
    const service=createLearningService(reopened,catalog,{userId:'u1',displayName:'Learner'},()=>start+DAY);
    assert.deepEqual(await service.adjustQuota(request),result);
    const q=await quota(service);
    assert.equal(q.needsDecision,true);
    const kept=(await service.adjustQuota(command(q,'keep'))).quota;
    assert.equal(kept.limit,20);
    assert.equal(kept.boostsRemaining,3);
  } finally {reopened.close()}
});

test('an in-flight boost that crosses midnight is rejected before committing any increase',async t=>{
  let rollover=false,fixture;
  fixture=setup(t,{afterFirst:async query=>{
    if(rollover&&query.includes('AS snapshot FROM daily_quotas')){rollover=false;fixture.setTime(start+DAY)}
  }});
  const request=command(await quota(fixture.service));
  rollover=true;
  await assert.rejects(fixture.service.adjustQuota(request),{status:409});
  assert.equal(await count(fixture.db,"SELECT COUNT(*) n FROM quota_events WHERE action='boost'"),0);
  const today=await quota(fixture.service);
  assert.equal(today.limit,10);
  assert.equal(today.needsDecision,false);
  assert.equal(today.boostsUsed,0);
});

test('new-word review crossing midnight does not use the prior day allowance',async t=>{
  let rollover=false,fixture;
  fixture=setup(t,{afterFirst:async query=>{
    if(rollover&&query.startsWith('SELECT COUNT(*) AS n FROM review_events')){rollover=false;fixture.setTime(start+DAY)}
  }});
  await fixture.service.adjustQuota(command(await quota(fixture.service)));
  rollover=true;
  await assert.rejects(fixture.service.review(review('en-0')),{status:409});
  assert.equal(await count(fixture.db,'SELECT COUNT(*) n FROM cards'),0);
  assert.equal(await count(fixture.db,'SELECT COUNT(*) n FROM review_events'),0);
  assert.equal((await quota(fixture.service)).needsDecision,true);
});

test('the final review transaction sees a concurrently lowered baseline instead of a stale queue limit',async t=>{
  let changeSetting=false,fixture;
  fixture=setup(t,{afterFirst:async query=>{
    if(changeSetting&&query.startsWith('SELECT COUNT(*) AS n FROM review_events')){changeSetting=false;await fixture.service.settings({dailyNewLimit:5})}
  }});
  for(let i=0;i<5;i++)await fixture.service.review(review(`en-${i}`));
  changeSetting=true;
  await assert.rejects(fixture.service.review(review('en-5')),{status:409});
  assert.equal(await count(fixture.db,'SELECT COUNT(*) n FROM review_events WHERE new_word=1'),5);
  assert.equal((await quota(fixture.service)).limit,5);
  assert.equal((await fixture.service.study('en')).newRemaining,0);
});

test('a settings write between quota read and mutation invalidates that in-flight boost',async t=>{
  let changeSetting=false,fixture;
  fixture=setup(t,{afterFirst:async query=>{
    if(changeSetting&&query.includes('AS snapshot FROM daily_quotas')){changeSetting=false;await fixture.service.settings({dailyNewLimit:25})}
  }});
  const request=command(await quota(fixture.service));
  changeSetting=true;
  await assert.rejects(fixture.service.adjustQuota(request),{status:409});
  const updated=await quota(fixture.service);
  assert.equal(updated.baseLimit,25);
  assert.equal(updated.limit,25);
  assert.equal(updated.boostsUsed,0);
});

test('a duplicate paused before its receipt lookup returns the result committed by another copy',async t=>{
  let pause=false,release,entered;
  const gate=new Promise(resolve=>{release=resolve});
  const started=new Promise(resolve=>{entered=resolve});
  const {service,db}=setup(t,{afterFirst:async query=>{
    if(pause&&query.startsWith('SELECT fingerprint,result FROM quota_events')){pause=false;entered();await gate}
  }});
  const request=command(await quota(service));
  pause=true;
  const duplicate=service.adjustQuota(request);
  await started;
  const first=await service.adjustQuota(request);
  release();
  assert.deepEqual(await duplicate,first);
  assert.equal(await count(db,"SELECT COUNT(*) n FROM quota_events WHERE action='boost'"),1);
  assert.deepEqual((await quota(service)).boosts,[10]);
});
