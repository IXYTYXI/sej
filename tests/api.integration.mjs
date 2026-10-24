// Starts an isolated local server and temporary database. Never targets production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {hashPassword} from '../lib/auth-password.ts';
import {recordReview} from '../lib/progression.ts';

const port = await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});
const origin=`http://127.0.0.1:${port}`;
const basePath='/study';
const user='owner';
const fixture=fs.mkdtempSync(join(tmpdir(),'wordsteps-api-test-'));
const databasePath=join(fixture,'learning.sqlite');
const username='owner@example.invalid';
const password=crypto.randomUUID()+crypto.randomUUID();
const passwordHash=await hashPassword(password);
let cookie='';let server;let sqlConnection;let serverLog='';
const cleanEnvironment={...process.env,APP_ORIGIN:origin,NEXT_PUBLIC_BASE_PATH:basePath,DATABASE_PATH:databasePath,AUTH_USERNAME:username,AUTH_PASSWORD_HASH:passwordHash,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',NEXT_TELEMETRY_DISABLED:'1'};
for(const name of ['AUTH_PASSWORD_HASH_FILE','REGISTRATION_CODE','REGISTRATION_CODE_FILE','ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_FILE','OPENAI_API_KEY','OPENAI_API_KEY_FILE'])delete cleanEnvironment[name];
// Existing deployments may not yet have the optional invitation file.
cleanEnvironment.REGISTRATION_CODE_FILE=join(fixture,'missing-registration-code');
async function start(){
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:cleanEnvironment,stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
 for(let i=0;i<100;i++){
  if(server.exitCode!==null)throw new Error(`Test server exited: ${serverLog}`);
  try{const r=await fetch(origin+basePath+'/api/health');if(r.ok)return;}catch{}
  await delay(200);
 }
 throw new Error(`Test server did not start: ${serverLog}`);
}
async function stop(){if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}}
async function createAdmin(username,password){
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--experimental-strip-types','scripts/create-admin.mjs','--username',username],{cwd:process.cwd(),env:cleanEnvironment,stdio:['pipe','pipe','pipe']});
  let stdout='';let stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',reject);child.stdin.on('error',reject);
  child.on('close',code=>code===0?resolve(stdout):reject(new Error(`Administrator fixture creation failed (${code}): ${stderr}`)));
  child.stdin.end(password+'\n');
 });
 assert.deepEqual(JSON.parse(output),{created:true,username,role:'admin'});
}

const catalog=JSON.parse(fs.readFileSync('data/catalog.json','utf8'));
const stage=catalog.stages.find(s=>s.language==='en'&&!s.prerequisiteId);
const next=catalog.stages.find(s=>s.prerequisiteId===stage.id);
const words=new Map(catalog.words.map(w=>[w.id,w]));

const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function sql(commands){sqlConnection.exec(commands);}
async function api(path,body,extra={}){
 const res=await fetch(origin+basePath+path,{headers:{Cookie:cookie,Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const text=await res.text(); let json;try{json=JSON.parse(text)}catch{if(res.status===403&&extra.Origin&&extra.Origin!==origin)json={error:text};else throw new Error(`${path}: expected JSON (${res.status}) ${text.slice(0,200)}`)};
 return {status:res.status,body:json,headers:res.headers};
}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
try{
 await start();
 const landing=await fetch(origin+basePath,{redirect:'manual'});assert.equal(landing.status,307);assert.equal(landing.headers.get('location'),basePath+'/login');
 sqlConnection=new DatabaseSync(databasePath);sqlConnection.exec('PRAGMA busy_timeout=5000');
 const anon=await fetch(origin+basePath+'/api/state?language=en');assert.equal(anon.status,401);
 const forged=await fetch(origin+basePath+'/api/state?language=en',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'fake@example.invalid'}});assert.equal(forged.status,401);
 assert.equal((await api('/api/auth/register',{username:'friend',password,inviteCode:'not-configured'})).status,503);
 assert.equal((await api('/api/auth/login',{username,password:'wrong'})).status,401);
 const login=await api('/api/auth/login',{username,password});assert.equal(ok(login).user.role,'admin');
 const setCookie=login.headers.get('set-cookie');assert.ok(setCookie.includes('HttpOnly'));assert.ok(setCookie.includes('Secure'));assert.ok(setCookie.includes('Path=/study'));cookie=setCookie.split(';')[0];
 const page=await fetch(origin+basePath,{headers:{Cookie:cookie}});assert.equal(page.status,200);
 const loginRedirect=await fetch(origin+basePath+'/login',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(loginRedirect.status,307);assert.equal(loginRedirect.headers.get('location'),basePath+'/');
 assert.equal((await api('/api/ai/status')).status,200);
 assert.ok(ok(await api('/api/ai/status')).providers.every(p=>p.enabled===false));
 assert.equal((await api('/api/ai',{action:'report',language:'en',requestId:crypto.randomUUID()})).status,503);

 const initial=ok(await api('/api/state?language=en'));
 assert.equal(initial.stats.mastered,0);assert.equal(initial.stats.learning,0,'Local QA database must start empty');
 const ja=ok(await api('/api/state?language=ja'));assert.equal(ja.stats.learning,0);

 assert.equal(initial.stages.filter(s=>s.unlocked).length,1);
 assert.equal((await api('/api/study?language=en&stageId='+next.id)).status,403);
 assert.equal((await api('/api/study?language=en&mode=practice&stageId='+next.id)).status,403);
 for(const mode of ['unknown','','Practice','scheduled%20'])assert.equal((await api('/api/study?language=en&mode='+mode)).status,400);
 assert.equal((await api('/api/exam',{stageId:stage.id})).status,403);
 assert.equal((await api('/api/settings',{dailyNewLimit:0})).status,400);
 assert.equal((await api('/api/settings',{dailyNewLimit:10},{Origin:'https://other.invalid'})).status,403);
 console.log('PASS authentication, origin, validation, initial locks and exam threshold');
 const queue=ok(await api('/api/study?language=en'));
 assert.equal(queue.cards.length,10);assert.equal(new Set(queue.cards.map(c=>c.id)).size,10);
 assert.equal(queue.mode,'scheduled');
 assert.deepEqual(queue.availability,{unseenCount:new Set(stage.wordIds).size,learnedCount:0,nextReviewAt:null,challengeStage:null});
 assert.deepEqual(ok(await api('/api/study?language=en&mode=practice')).cards,[],'Practice cannot introduce unseen vocabulary');
 const first=queue.cards[0];const request={wordId:first.id,rating:4,version:0,requestId:crypto.randomUUID()};
 const reviewed=ok(await api('/api/review',request));assert.equal(reviewed.isMastered,false);
 assert.deepEqual(ok(await api('/api/review',request)),reviewed);
 const after=ok(await api('/api/state?language=en'));assert.equal(after.stats.todayNew,1);assert.equal(after.stats.mastered,0);
 assert.equal((await api('/api/review',{...request,requestId:crypto.randomUUID()})).status,409);
 const lockedWord=next.wordIds.find(id=>!stage.wordIds.includes(id));
 assert.equal((await api('/api/review',{wordId:lockedWord,rating:4,version:0,requestId:crypto.randomUUID()})).status,403);
 assert.equal(ok(await api('/api/state?language=ja')).stats.todayNew,0);
 const snapshotLearning=()=>Object.fromEntries(['cards','review_events','daily_quotas','quota_events','passes','unlocks','exams'].map(table=>[table,sqlConnection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
 const beforePractice=snapshotLearning();
 const practice=ok(await api('/api/study?language=en&mode=practice&stageId='+stage.id));
 assert.equal(practice.mode,'practice');assert.equal(practice.cards.length,1);assert.equal(practice.cards[0].id,first.id);assert.equal(practice.cards[0].isNew,false);
 assert.deepEqual(practice.availability,{unseenCount:new Set(stage.wordIds).size-1,learnedCount:1,nextReviewAt:reviewed.nextDue,challengeStage:null});
 assert.deepEqual(ok(await api('/api/study?language=ja&mode=practice')).cards,[]);
 assert.equal((await api('/api/review',{wordId:first.id,rating:4,version:practice.cards[0].version,requestId:crypto.randomUUID()})).status,409,'Practice must not bypass the scheduled review due time');
 assert.deepEqual(snapshotLearning(),beforePractice,'Practice reads must preserve learning, quota, mastery and unlock records');
 console.log('PASS strict study modes, scoped availability, read-only practice and early-review rejection');
 console.log('PASS repeat request idempotency, optimistic concurrency, locked-word write and language isolation');
 // Twenty concurrent new-word requests must not exceed the daily limit of ten.
 await Promise.all(stage.wordIds.filter(id=>id!==first.id).slice(0,20).map(id=>api('/api/review',{wordId:id,rating:3,version:0,requestId:crypto.randomUUID()})));
 assert.equal(ok(await api('/api/state?language=en')).stats.todayNew,10);
 const exhaustedSchedule=ok(await api('/api/study?language=en'));assert.equal(exhaustedSchedule.newRemaining,0);assert.equal(exhaustedSchedule.availability.unseenCount,new Set(stage.wordIds).size-10);
 console.log('PASS atomic daily new-word quota under concurrency');

 // Exercise quota changes only after proving the original ten-word cap above.
 const capped=ok(await api('/api/state?language=en'));
 let quota=capped.quota;
 assert.ok(quota,'Learning state must expose the current daily quota');
 assert.match(quota.day,/^\d{4}-\d{2}-\d{2}$/);
 assert.ok(Number.isSafeInteger(quota.version));
 assert.equal(quota.baseLimit,10);assert.equal(quota.limit,10);
 assert.equal(quota.boostsUsed,0);assert.equal(quota.boostsRemaining,3);
 assert.equal(quota.needsDecision,false);assert.deepEqual(quota.boosts,[]);
 const japaneseQuota=ok(await api('/api/state?language=ja')).quota;
 const firstBoost={language:'en',action:'boost',amount:10,day:quota.day,version:quota.version,requestId:crypto.randomUUID()};
 assert.equal((await api('/api/quota',firstBoost,{Cookie:''})).status,401);
 assert.equal((await api('/api/quota',firstBoost,{Origin:'https://other.invalid'})).status,403);
 assert.equal((await api('/api/quota',firstBoost,{'Content-Type':'text/plain'})).status,415);
 const malformed=await fetch(origin+basePath+'/api/quota',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:'{'});
 assert.equal(malformed.status,400);
 const invalidQuotaBodies=[
  [],
  {...firstBoost,language:'fr'},
  {...firstBoost,action:'invented'},
  {...firstBoost,amount:undefined},
  {...firstBoost,amount:1},
  {...firstBoost,version:-1},
  {...firstBoost,version:1.5},
  {...firstBoost,requestId:'not-a-uuid'},
  {...firstBoost,unexpected:true},
 ];
 for(const body of invalidQuotaBodies)assert.equal((await api('/api/quota',body)).status,400,JSON.stringify(body));
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,quota,'Rejected quota requests must not consume a boost');

 const firstBoostResult=ok(await api('/api/quota',firstBoost));
 quota=firstBoostResult.quota;
 assert.equal(quota.limit,20);assert.equal(quota.baseLimit,10);
 assert.equal(quota.boostsUsed,1);assert.equal(quota.boostsRemaining,2);
 assert.deepEqual(quota.boosts,[10]);assert.ok(quota.version>firstBoost.version);
 assert.deepEqual(ok(await api('/api/quota',firstBoost)),firstBoostResult);
 assert.equal((await api('/api/quota',{...firstBoost,requestId:crypto.randomUUID()})).status,409,'A stale quota version must not grant another boost');
 assert.deepEqual(ok(await api('/api/state?language=ja')).quota,japaneseQuota,'English boosts must not change Japanese quota');
 const boostedQueue=ok(await api('/api/study?language=en'));
 assert.equal(boostedQueue.newRemaining,10);
 const extraNewWord=boostedQueue.cards.find(card=>card.isNew);
 assert.ok(extraNewWord,'A successful boost must make additional new words available');
 ok(await api('/api/review',{wordId:extraNewWord.id,rating:3,version:extraNewWord.version,requestId:crypto.randomUUID()}));
 assert.equal(ok(await api('/api/state?language=en')).stats.todayNew,11);
 assert.equal(ok(await api('/api/state?language=ja')).stats.todayNew,0);

 const secondBoost={language:'en',action:'boost',amount:1,day:quota.day,version:quota.version,requestId:crypto.randomUUID()};
 for(const amount of [0,101,1.5,'2'])assert.equal((await api('/api/quota',{...secondBoost,amount})).status,400);
 const secondBoostResult=ok(await api('/api/quota',secondBoost));
 quota=secondBoostResult.quota;
 assert.equal(quota.limit,21);assert.equal(quota.boostsUsed,2);assert.equal(quota.boostsRemaining,1);assert.deepEqual(quota.boosts,[10,1]);
 assert.equal((await api('/api/quota',{...secondBoost,amount:2})).status,409,'A request ID cannot be reused for a different amount');
 assert.deepEqual(ok(await api('/api/quota',firstBoost)),firstBoostResult,'Replaying an earlier boost must return its original receipt');
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,quota,'Replaying an earlier boost must not roll back current quota');
 const thirdBoost={language:'en',action:'boost',amount:100,day:quota.day,version:quota.version,requestId:crypto.randomUUID()};
 quota=ok(await api('/api/quota',thirdBoost)).quota;
 assert.equal(quota.limit,121);assert.equal(quota.boostsUsed,3);assert.equal(quota.boostsRemaining,0);assert.deepEqual(quota.boosts,[10,1,100]);
 assert.equal((await api('/api/quota',{...thirdBoost,amount:1,version:quota.version,requestId:crypto.randomUUID()})).status,409);
 assert.deepEqual(ok(await api('/api/state?language=ja')).quota,japaneseQuota);
 console.log('PASS quota authentication, CSRF, validation, additional new-word admission, three-boost cap, language isolation and idempotency');

 // Changing the ordinary daily target adjusts the base; it never replenishes boosts.
 ok(await api('/api/settings',{dailyNewLimit:15}));
 const raisedBaseline=ok(await api('/api/state?language=en')).quota;
 assert.equal(raisedBaseline.baseLimit,15);assert.equal(raisedBaseline.limit,126);
 assert.equal(raisedBaseline.boostsUsed,3);assert.equal(raisedBaseline.boostsRemaining,0);
 assert.deepEqual(raisedBaseline.boosts,[10,1,100]);assert.ok(raisedBaseline.version>quota.version);
 ok(await api('/api/settings',{dailyNewLimit:10}));
 const persistentQuota=ok(await api('/api/state?language=en')).quota;
 assert.equal(persistentQuota.baseLimit,10);assert.equal(persistentQuota.limit,121);
 assert.equal(persistentQuota.boostsUsed,3);assert.equal(persistentQuota.boostsRemaining,0);
 assert.deepEqual(persistentQuota.boosts,[10,1,100]);
 assert.equal((await api('/api/quota',{...thirdBoost,amount:1,version:persistentQuota.version,requestId:crypto.randomUUID()})).status,409);
 const untouchedJapaneseQuota=ok(await api('/api/state?language=ja')).quota;
 assert.equal(untouchedJapaneseQuota.limit,10);assert.equal(untouchedJapaneseQuota.boostsUsed,0);assert.equal(untouchedJapaneseQuota.boostsRemaining,3);
 const japaneseBoost={language:'ja',action:'boost',amount:10,day:untouchedJapaneseQuota.day,version:untouchedJapaneseQuota.version,requestId:crypto.randomUUID()};
 const persistentJapaneseQuota=ok(await api('/api/quota',japaneseBoost)).quota;
 assert.equal(persistentJapaneseQuota.limit,20);assert.equal(persistentJapaneseQuota.boostsUsed,1);assert.equal(persistentJapaneseQuota.boostsRemaining,2);
 assert.deepEqual(persistentJapaneseQuota.boosts,[10]);
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,persistentQuota,'Japanese boosts remain available after all three English boosts are used');
 console.log('PASS baseline changes preserve daily boost history and the exhausted boost allowance');

 const now=Date.now();
 function seedLearned(count){
  const commands=[];
  for(const [i,id] of stage.wordIds.slice(0,count).entries()){
   const p=recordReview(null,words.get(id),i%4+1,now,'fixture');
   commands.push(`INSERT INTO cards(user_id,word_id,language,data,version,due,last_request) VALUES (${quote(user)},${quote(id)},'en',${quote(JSON.stringify(p))},1,${p.due},'fixture') ON CONFLICT(user_id,word_id) DO UPDATE SET data=excluded.data,version=1,due=excluded.due,last_request='fixture';`);
  }
  sql(commands.join('\n'));
 }
 assert.equal(stage.wordIds.length,100,'The first-stage acceptance fixture must contain 100 words');
 seedLearned(99);assert.equal((await api('/api/exam',{stageId:stage.id})).status,403);
 const almostLearned=ok(await api('/api/state?language=en')).stages.find(s=>s.id===stage.id);
 assert.equal(almostLearned.learned,99);assert.equal(almostLearned.mastered,0);assert.equal(almostLearned.canTest,false);
 assert.equal(ok(await api('/api/study?language=en')).availability.challengeStage,null);
 seedLearned(100);
 const allLearned=ok(await api('/api/state?language=en')).stages.find(s=>s.id===stage.id);
 assert.equal(allLearned.learned,100);assert.equal(allLearned.mastered,0);assert.equal(allLearned.percent,0);assert.equal(allLearned.canTest,true);
 assert.deepEqual(ok(await api('/api/study?language=en')).availability.challengeStage,{id:stage.id,title:stage.title});
 const beforeEligiblePractice=snapshotLearning();
 const eligiblePractice=ok(await api('/api/study?language=en&mode=practice&stageId='+stage.id));
 assert.equal(eligiblePractice.cards.length,50);assert.ok(eligiblePractice.cards.every(card=>card.isNew===false));
 assert.deepEqual(eligiblePractice.availability.challengeStage,{id:stage.id,title:stage.title});
 assert.deepEqual(snapshotLearning(),beforeEligiblePractice,'Practice must preserve learned exam eligibility and all learning records');
 assert.equal(ok(await api('/api/state?language=en')).stages.find(s=>s.id===stage.id).canTest,true);
 const exam=ok(await api('/api/exam',{stageId:stage.id}));assert.equal(exam.questions.length,20);assert.ok(!('answerKey' in exam));
 assert.equal(ok(await api('/api/exam',{stageId:stage.id})).id,exam.id);
 // Ground truth comes from the local fixture catalog, not from a server-exposed answer key.
 const answers={};
 for(const q of exam.questions){
  const source=stage.wordIds.map(id=>words.get(id)).find(w=>q.prompt===w.word||q.prompt.startsWith(w.word+' '));
  assert.ok(source,`Unexpected question format: ${q.prompt}`);
  const correct=q.choices.find(c=>c.text===source.meaning);assert.ok(correct,'Exam choices should preserve dictionary meanings');answers[q.id]=correct.id;
 }
 for(const q of exam.questions.slice(0,4))answers[q.id]=q.choices.find(choice=>choice.id!==answers[q.id]).id;
 const passed=ok(await api('/api/exam/submit',{id:exam.id,answers}));assert.equal(passed.passed,true);assert.equal(passed.score,16);assert.ok(passed.unlockedStageIds.includes(next.id));
 assert.deepEqual(ok(await api('/api/exam/submit',{id:exam.id,answers})),passed);
 assert.equal(ok(await api('/api/state?language=en')).stages.find(s=>s.id===next.id).unlocked,true);
 assert.equal(ok(await api('/api/study?language=en&stageId='+stage.id)).availability.challengeStage,null,'Passed stages are no longer offered as the next challenge');
 console.log('PASS 99/100 learned boundary, zero mastery on day one, read-only practice, private answers, session reuse, 80 percent score and permanent next-stage grant');
 // Later forgetting must preserve learned status and the earned unlock.
 const id=stage.wordIds[0];const p=recordReview(null,words.get(id),1,now,'forget-fixture');
 sql(`UPDATE cards SET data=${quote(JSON.stringify(p))},due=${p.due} WHERE user_id=${quote(user)} AND word_id=${quote(id)};`);
 const forgotten=ok(await api('/api/state?language=en'));const forgottenStage=forgotten.stages.find(s=>s.id===stage.id);
 assert.equal(forgottenStage.mastered,0);assert.equal(forgottenStage.learned,100);assert.equal(forgottenStage.canTest,true);assert.equal(forgotten.stages.find(s=>s.id===next.id).unlocked,true);
 assert.equal((await api('/api/study?language=en&stageId='+next.id)).status,200);
 console.log('PASS forgetting preserves learned exam eligibility and earned unlock');
 await stop();await start();
 const restored=ok(await api('/api/state?language=en'));assert.equal(restored.stages.find(s=>s.id===next.id).unlocked,true);assert.equal(restored.stats.todayNew,11);
 assert.deepEqual(restored.quota,persistentQuota,'Daily quota must survive a process restart');
 assert.deepEqual(ok(await api('/api/state?language=ja')).quota,persistentJapaneseQuota);
 assert.deepEqual(ok(await api('/api/quota',secondBoost)),secondBoostResult,'Quota receipts must survive a process restart');
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,persistentQuota);
 assert.equal((await api('/api/quota',{...thirdBoost,amount:1,version:persistentQuota.version,requestId:crypto.randomUUID()})).status,409,'Restarting must not replenish the daily boost allowance');
 ok(await api('/api/auth/logout',{}));assert.equal((await api('/api/state?language=en')).status,401);
 console.log('PASS process restart preserves sessions, learning records, earned unlocks, quota and receipts; logout revokes session');

 // Enabling invitations must leave the existing owner's data and quota untouched.
 await stop();
 delete cleanEnvironment.REGISTRATION_CODE_FILE;
 const inviteCode=crypto.randomUUID();
 cleanEnvironment.REGISTRATION_CODE=inviteCode;
 await start();
 const ownerLogin=await api('/api/auth/login',{username,password});ok(ownerLogin);
 const ownerCookie=ownerLogin.headers.get('set-cookie').split(';')[0];
 assert.equal((await api('/api/auth/register',{username:'friend',password,inviteCode,role:'admin'})).status,400);
 const registration=await api('/api/auth/register',{username:'friend',password,inviteCode});
 const registered=ok(registration);assert.notEqual(registered.user.userId,'owner');assert.equal(registered.user.role,'user');
 cookie=registration.headers.get('set-cookie').split(';')[0];
 assert.equal(ok(await api('/api/ai/status')).dailyLimit,30);
 const friendInitial=ok(await api('/api/state?language=en'));
 assert.equal(friendInitial.stats.todayNew,0);assert.equal(friendInitial.stats.learning,0);
 assert.equal(friendInitial.quota.limit,10);assert.equal(friendInitial.quota.boostsUsed,0);
 assert.equal(friendInitial.stages.find(s=>s.id===next.id).unlocked,false);
 const friendBoost={language:'en',action:'boost',amount:10,day:friendInitial.quota.day,version:friendInitial.quota.version,requestId:crypto.randomUUID()};
 assert.equal(ok(await api('/api/quota',friendBoost)).quota.limit,20);
 cookie=ownerCookie;
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,persistentQuota);
 assert.equal(ok(await api('/api/state?language=en')).stats.todayNew,11);

 // Provision a separate administrator through the deployed CLI after migrations.
 const adminUsername='study-admin';const adminPassword=crypto.randomUUID()+crypto.randomUUID();
 await createAdmin(adminUsername,adminPassword);
 try{
  const adminLogin=await api('/api/auth/login',{username:adminUsername,password:adminPassword});
  const admin=ok(adminLogin).user;
  assert.equal(admin.role,'admin');assert.equal(admin.displayName,adminUsername);
  assert.notEqual(admin.userId,'owner');assert.notEqual(admin.userId,registered.user.userId);
  cookie=adminLogin.headers.get('set-cookie').split(';')[0];
  const adminAi=ok(await api('/api/ai/status'));assert.equal(adminAi.dailyLimit,null);assert.equal(adminAi.usedToday,0);
  const adminState=ok(await api('/api/state?language=en'));
  assert.equal(adminState.stats.todayNew,0);assert.equal(adminState.stats.learning,0);assert.equal(adminState.stats.mastered,0);
  assert.equal(adminState.quota.limit,10);assert.equal(adminState.quota.boostsUsed,0);
  assert.equal(adminState.stages.find(s=>s.id===stage.id).learned,0);
  assert.equal(adminState.stages.find(s=>s.id===next.id).unlocked,false);
  assert.deepEqual(ok(await api('/api/study?language=en&mode=practice')).cards,[]);
  assert.equal((await api('/api/study?language=en&stageId='+next.id)).status,403);
  assert.equal((await api('/api/study?language=en&mode=practice&stageId='+next.id)).status,403);
  assert.equal((await api('/api/review',{wordId:lockedWord,rating:4,version:0,requestId:crypto.randomUUID()})).status,403);
  assert.equal((await api('/api/exam',{stageId:stage.id})).status,403);
 }finally{cookie=ownerCookie;}
 const ownerAfterAdmin=ok(await api('/api/state?language=en'));
 assert.equal(ownerAfterAdmin.stats.todayNew,11);assert.equal(ownerAfterAdmin.stages.find(s=>s.id===next.id).unlocked,true);
 assert.deepEqual(ownerAfterAdmin.quota,persistentQuota);
 console.log('PASS CLI-created administrator login and unlimited AI, ordinary-user allowance, role injection rejection, isolated learning and unchanged stage gates');

 // A successful login by another account cannot clear the owner's failure count.
 for(let i=0;i<10;i++){
  assert.equal((await api('/api/auth/login',{username:i%2?username.toUpperCase():username,password:'wrong'})).status,401);
  ok(await api('/api/auth/login',{username:'friend',password}));
 }
 const blocked=await api('/api/auth/login',{username,password:'wrong'});
 assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'900');
 const friendLogin=await api('/api/auth/login',{username:'FRIEND',password});ok(friendLogin);
 cookie=friendLogin.headers.get('set-cookie').split(';')[0];
 assert.equal(ok(await api('/api/state?language=en')).quota.limit,20);
 cookie=ownerCookie;
 assert.deepEqual(ok(await api('/api/state?language=en')).quota,persistentQuota,'Rate limiting must not revoke existing owner sessions or data');
 console.log('PASS optional invitation upgrade, legacy owner login, registration and account-isolated learning, quotas and login limits');
 console.log('ALL NATIVE-RUNTIME API ACCEPTANCE CHECKS PASSED');
}finally{
 await stop();sqlConnection?.close();fs.rmSync(fixture,{recursive:true,force:true});
 console.log('Removed only this run’s isolated temporary database.');
}
