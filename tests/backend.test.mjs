import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { createLearningService } from '../lib/server-core.ts';
import { createExam, gradeExam } from '../lib/exams.ts';
import { readBody } from '../lib/server-http.ts';

const time = Date.parse('2026-10-10T09:00:00Z');
const words = Array.from({length:45}, (_, i) => ({id:`w${i}`,language:i<25?'en':'ja',word:`word${i}`,reading:'',meaning:`释义${i}`,tags:[],source:'test'}));
const catalog={courses:[],sources:[],words,stages:[
  {id:'en-1',courseId:'en',language:'en',title:'one',index:1,prerequisiteId:null,wordIds:words.slice(0,20).map(w=>w.id)},
  {id:'en-2',courseId:'en',language:'en',title:'two',index:2,prerequisiteId:'en-1',wordIds:words.slice(20,25).map(w=>w.id)},
  {id:'ja-1',courseId:'ja',language:'ja',title:'日本語',index:1,prerequisiteId:null,wordIds:words.slice(25).map(w=>w.id)},
]};
function setup(hooks = {}, testCatalog = catalog) {
  const sql=new DatabaseSync(':memory:');for(const file of ['0000_amazing_old_lace.sql','0003_daily_quota.sql'])sql.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
  const stmt=(query,values=[])=>({query,values,bind(...args){return stmt(query,args)},async all(){return {results:sql.prepare(query).all(...values)}},async first(){const row=sql.prepare(query).get(...values)??null;await hooks.afterFirst?.(query,row);return row},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}}}});
  const db={prepare:stmt,async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts){const changed=sql.prepare(s.query).run(...s.values);r.push({meta:{changes:Number(changed.changes)}});}sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
  let now=time; const service=createLearningService(db,testCatalog,{userId:'u1',displayName:'User'},()=>now);
  function seed(count=20){for(const w of words.slice(0,count)){const data={wordId:w.id,language:w.language,fsrs:{state:2,due:new Date(time),last_review:new Date(time-86400000),stability:20,difficulty:3,elapsed_days:1,scheduled_days:20,reps:4,lapses:0},firstSeen:time-10*86400000,goodDays:['2026-10-01','2026-10-05','2026-10-10'],lastRating:3,version:1,due:time,mastered:true,lastRequest:'seed'};sql.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?)').run('u1',w.id,w.language,JSON.stringify(data),1,time,'seed')}}
  return {service,sql,db,seed,setTime:t=>now=t};
}
const review=(wordId,version=0,requestId=crypto.randomUUID())=>({wordId,version,requestId,rating:3});

async function learnedFirstStage(count=100) {
 const stageWords=Array.from({length:105},(_,i)=>({...words[0],id:`en-word-${String(i).padStart(3,'0')}`,word:`word${i}`,meaning:`释义${i}`}));
 const fixture={...catalog,words:[...stageWords,...words.slice(25)],stages:[
  {...catalog.stages[0],wordIds:stageWords.slice(0,100).map(w=>w.id)},
  {...catalog.stages[1],wordIds:stageWords.slice(100).map(w=>w.id)},
  catalog.stages[2],
 ]};
 const context=setup({},fixture);const {service}=context;
 let quota=(await service.state('en')).quota;
 for(const amount of [10,100,50])quota=(await service.adjustQuota({language:'en',action:'boost',amount,day:quota.day,version:quota.version,requestId:crypto.randomUUID()})).quota;
 assert.equal(quota.limit,170);
 for(const word of stageWords.slice(0,count)){
  const result=await service.review({...review(word.id),rating:4});
  assert.equal(result.nextDue,new Date(time+8*86400000).toISOString());
 }
 return {...context,stageWords};
}

function learningSnapshot(sql) {
 return Object.fromEntries(['cards','review_events','daily_quotas','quota_events','passes','unlocks','exams'].map(table=>[table,sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test('99 of 100 learned words cannot take an exam; learning the last word permits it on day one with zero mastery',async()=>{
 const {service,stageWords}=await learnedFirstStage(99);
 let stage=(await service.state('en')).stages[0];
 assert.equal(stage.learned,99);assert.equal(stage.mastered,0);assert.equal(stage.canTest,false);
 assert.equal((await service.study('en')).availability.challengeStage,null);
 await assert.rejects(service.startExam({stageId:'en-1'}),{status:403});
 await service.review({...review(stageWords[99].id),rating:1});
 stage=(await service.state('en')).stages[0];
 assert.equal(stage.learned,100);assert.equal(stage.mastered,0);assert.equal(stage.percent,0);assert.equal(stage.canTest,true);
 for(const mode of ['scheduled','practice'])assert.deepEqual((await service.study('en','en-1',mode)).availability.challengeStage,{id:'en-1',title:'one'});
 const exam=await service.startExam({stageId:'en-1'});assert.equal(exam.questions.length,20);
 assert.equal((await service.startExam({stageId:'en-1'})).id,exam.id);
});

test('forgotten and difficult first ratings still count as learned without changing mastery',async()=>{
 const {service}=setup();await service.settings({dailyNewLimit:20});
 for(const [i,word] of words.slice(0,20).entries())await service.review({...review(word.id),rating:i%2+1});
 const state=await service.state('en');assert.equal(state.stages[0].learned,20);assert.equal(state.stages[0].mastered,0);assert.equal(state.stages[0].canTest,true);
 assert.equal(state.stats.mastered,0);assert.equal(state.stats.learning,20);
 assert.equal((await service.startExam({stageId:'en-1'})).questions.length,20);
});

test('80 percent mastery does not admit a stage with unlearned words and empty stages never offer exams',async()=>{
 const {service,seed}=setup();seed(16);
 const stage=(await service.state('en')).stages[0];assert.equal(stage.mastered,16);assert.equal(stage.percent,80);assert.equal(stage.learned,16);assert.equal(stage.canTest,false);
 assert.equal((await service.study('en')).availability.challengeStage,null);
 await assert.rejects(service.startExam({stageId:'en-1'}),{status:403});
 const empty=setup({},{...catalog,stages:[{...catalog.stages[0],wordIds:[]}]}).service;
 assert.equal((await empty.state('en')).stages[0].canTest,false);assert.equal((await empty.study('en')).availability.challengeStage,null);
 await assert.rejects(empty.startExam({stageId:'en-1'}),{status:403});
});

test('learning eligibility stays scoped to the user, language and unlocked stage',async()=>{
 const {service,db,sql,seed}=setup();seed(25);
 const state=await service.state('en');assert.equal(state.stages[0].canTest,true);assert.equal(state.stages[1].learned,5);assert.equal(state.stages[1].canTest,false);
 await assert.rejects(service.startExam({stageId:'en-2'}),{status:403});
 assert.equal((await service.state('ja')).stages[0].learned,0);assert.equal((await service.study('ja')).availability.challengeStage,null);
 await assert.rejects(service.startExam({stageId:'ja-1'}),{status:403});
 const other=createLearningService(db,catalog,{userId:'u2',displayName:'Other'},()=>time);
 assert.equal((await other.state('en')).stages[0].learned,0);assert.equal((await other.study('en')).availability.challengeStage,null);
 await assert.rejects(other.startExam({stageId:'en-1'}),{status:403});
 const exam=await service.startExam({stageId:'en-1'});const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
 await assert.rejects(other.submitExam({id:exam.id,answers:stored.answerKey}),{status:404});
});

test('exam insertion atomically rechecks every learned word with user and language scope',async()=>{
 for(const change of ["DELETE FROM cards WHERE word_id='w0'","UPDATE cards SET user_id='u2' WHERE word_id='w0'","UPDATE cards SET language='ja' WHERE word_id='w0'"]){
  let changed=false;
  const {service,sql,seed}=setup({afterFirst:query=>{if(!changed&&query.startsWith('SELECT id,stage_id,data,expires_at,result FROM exams WHERE user_id=')){changed=true;sql.exec(change)}}});
  seed();await assert.rejects(service.startExam({stageId:'en-1'}),{status:409});
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM exams').get().n,0);
 }
});

test('exam submission atomically requires all learned words to retain their user and language scope',async()=>{
 for(const change of ["DELETE FROM cards WHERE word_id='w0'","UPDATE cards SET user_id='u2' WHERE word_id='w0'","UPDATE cards SET language='ja' WHERE word_id='w0'"]){
  let submitting=false;
  const {service,sql,seed}=setup({afterFirst:query=>{if(submitting&&query.startsWith('SELECT id,stage_id,data,expires_at,result FROM exams WHERE id=')){submitting=false;sql.exec(change)}}});
  seed();const exam=await service.startExam({stageId:'en-1'});const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
  submitting=true;const result=await service.submitExam({id:exam.id,answers:stored.answerKey});
  assert.equal(result.score,20);assert.equal(result.passed,false);assert.deepEqual(result.unlockedStageIds,[]);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM passes').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM unlocks').get().n,0);
 }
});

test('next-day empty schedule offers an exam after all words are learned even while quota needs a decision',async()=>{
 const {service,setTime}=await learnedFirstStage();setTime(time+86400000);
 const pending=await service.study('en');
 assert.equal(pending.quota.needsDecision,true);assert.equal(pending.quota.limit,170);
 assert.equal(pending.newRemaining,0);assert.deepEqual(pending.cards,[]);assert.equal(pending.dueCount,0);
 assert.equal(pending.mode,'scheduled');
 const availability={unseenCount:0,learnedCount:100,nextReviewAt:new Date(time+8*86400000).toISOString(),challengeStage:{id:'en-1',title:'one'}};
 assert.deepEqual(pending.availability,availability);
 await service.adjustQuota({language:'en',action:'keep',day:pending.quota.day,version:pending.quota.version,requestId:crypto.randomUUID()});
 const kept=await service.study('en');assert.equal(kept.newRemaining,170);assert.deepEqual(kept.cards,[]);assert.deepEqual(kept.availability,availability);
 const state=await service.state('en');assert.equal(state.stages[0].mastered,0);assert.equal(state.stages[0].canTest,true);assert.equal(state.stages[1].unlocked,false);
});

test('practice permits a stable 50-card browse while quota is pending without mutating learning or admitting early reviews',async()=>{
 const {service,sql,setTime,stageWords}=await learnedFirstStage();setTime(time+86400000);
 await service.state('en');const before=learningSnapshot(sql);
 const practice=await service.study('en',undefined,'practice');
 assert.equal(practice.mode,'practice');assert.equal(practice.quota.needsDecision,true);assert.equal(practice.cards.length,50);
 assert.deepEqual(practice.cards.map(card=>card.id),stageWords.slice(0,50).map(word=>word.id));
 assert.ok(practice.cards.every(card=>card.isNew===false&&card.version===1));
 assert.deepEqual((await service.study('en',undefined,'practice')).cards,practice.cards);
 assert.deepEqual(practice.availability.challengeStage,{id:'en-1',title:'one'});
 assert.equal((await service.state('en')).stages[0].canTest,true);
 await assert.rejects(service.review(review(practice.cards[0].id,1)),{status:409});
 assert.deepEqual(learningSnapshot(sql),before);
});

test('quota-exhausted schedule distinguishes unseen words from a fully learned accessible stage',async()=>{
 const {service}=setup();await service.settings({dailyNewLimit:5});
 for(const word of words.slice(0,5))await service.review({...review(word.id),rating:4});
 const scheduled=await service.study('en');assert.deepEqual(scheduled.cards,[]);assert.equal(scheduled.newRemaining,0);
 assert.deepEqual(scheduled.availability,{unseenCount:15,learnedCount:5,nextReviewAt:new Date(time+8*86400000).toISOString(),challengeStage:null});
 const fresh=await service.study('ja',undefined,'practice');assert.deepEqual(fresh.cards,[]);
 assert.deepEqual(fresh.availability,{unseenCount:20,learnedCount:0,nextReviewAt:null,challengeStage:null});
});

test('availability and practice stay within language and selected unlocked stage, excluding duplicate and invalid words',async()=>{
 const fixture={...catalog,stages:[{...catalog.stages[0],wordIds:[...catalog.stages[0].wordIds,'w0','missing','w25']},...catalog.stages.slice(1)]};
 const {service,sql,seed}=setup({},fixture);seed(25);
 await service.review({...review('w25'),rating:4});
 const locked=await service.study('en',undefined,'practice');
 assert.deepEqual(new Set(locked.cards.map(card=>card.id)),new Set(words.slice(0,20).map(word=>word.id)));
 assert.equal(locked.availability.learnedCount,20);assert.equal(locked.availability.unseenCount,0);assert.equal(locked.availability.nextReviewAt,null);
 await assert.rejects(service.study('en','en-2','practice'),{status:403});
 await assert.rejects(service.study('en','ja-1','practice'),{status:400});
 const japanese=await service.study('ja',undefined,'practice');assert.deepEqual(japanese.cards.map(card=>card.id),['w25']);
 assert.deepEqual(japanese.availability,{unseenCount:19,learnedCount:1,nextReviewAt:new Date(time+8*86400000).toISOString(),challengeStage:null});
 sql.prepare('INSERT INTO unlocks VALUES (?,?,?)').run('u1','en-2',time);
 const selected=await service.study('en','en-2','practice');assert.deepEqual(new Set(selected.cards.map(card=>card.id)),new Set(words.slice(20,25).map(word=>word.id)));
 assert.deepEqual(selected.availability,{unseenCount:0,learnedCount:5,nextReviewAt:null,challengeStage:{id:'en-2',title:'two'}});
});

test('availability identifies the next future review and first unpassed exam-ready accessible stage',async()=>{
 const {service,sql,seed}=setup();seed(25);
 sql.prepare('INSERT INTO unlocks VALUES (?,?,?)').run('u1','en-2',time);
 for(const [wordId,due] of [['w0',time+2*86400000],['w1',time+86400000]])sql.prepare("UPDATE cards SET due=?,data=json_set(data,'$.due',?) WHERE word_id=?").run(due,due,wordId);
 const scheduled=await service.study('en');assert.equal(scheduled.dueCount,23);
 assert.equal(scheduled.availability.nextReviewAt,new Date(time+86400000).toISOString());
 assert.deepEqual(scheduled.availability.challengeStage,{id:'en-1',title:'one'});
 const practice=await service.study('en',undefined,'practice');assert.equal(practice.cards.length,25);assert.equal(practice.cards.at(-2).id,'w1');assert.equal(practice.cards.at(-1).id,'w0');
 sql.prepare('INSERT INTO passes VALUES (?,?,?)').run('u1','en-1',time);
 assert.deepEqual((await service.study('en')).availability.challengeStage,{id:'en-2',title:'two'});
 assert.equal((await service.study('en','en-1')).availability.challengeStage,null);
 sql.prepare('INSERT INTO passes VALUES (?,?,?)').run('u1','en-2',time);
 assert.equal((await service.study('en')).availability.challengeStage,null);
});

test('study HTTP route accepts only explicit scheduled or practice modes and rejects unknown values',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wordsteps-study-http-'));const original={...process.env};
 const {hashPassword}=await import('../lib/auth-password.ts');
 Object.assign(process.env,{DATABASE_PATH:join(directory,'db.sqlite'),AUTH_USERNAME:'study-test',AUTH_PASSWORD_HASH:await hashPassword('study-password-for-tests'),NODE_ENV:'production',APP_ORIGIN:'https://example.test'});
 delete process.env.AUTH_PASSWORD_HASH_FILE;
 // Supply fixture data without importing the catalog's Next-only module guard.
 const catalogHook=registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='./catalog'&&context.parentURL?.endsWith('/lib/server.ts'))return {url:'data:text/javascript,'+encodeURIComponent(`export const catalog = ${JSON.stringify(catalog)};`),shortCircuit:true};
  return nextResolve(specifier,context);
 }});
 try{
  const login=await import('../app/api/auth/login/route.ts');const study=await import('../app/api/study/route.ts');
  const response=await login.POST(new Request('https://example.test/api/auth/login',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({username:'study-test',password:'study-password-for-tests'})}));
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
  const get=query=>study.GET(new Request('https://example.test/api/study?language=en'+query,{headers:{cookie}}));
  for(const mode of ['unknown','','Practice','scheduled%20'])assert.equal((await get('&mode='+mode)).status,400);
  for(const mode of ['scheduled','practice']){const result=await get('&mode='+mode);assert.equal(result.status,200);assert.equal((await result.json()).mode,mode);}
  assert.equal((await (await get('')).json()).mode,'scheduled');
 }finally{
  catalogHook.deregister();
  globalThis.wordstepsDatabase?.close();delete globalThis.wordstepsDatabase;
  for(const name of Object.keys(process.env))if(!(name in original))delete process.env[name];
  Object.assign(process.env,original);rmSync(directory,{recursive:true,force:true});
 }
});

test('exams use opaque unique choice ids, no answer key in questions, and 80% threshold',()=>{
 const exam=createExam(words.slice(0,20),words.slice(0,25));
 assert.equal(exam.questions.length,20);
 for(const q of exam.questions){assert.equal(q.choices.length,4);assert.equal(new Set(q.choices.map(c=>c.text)).size,4);assert.deepEqual(Object.keys(q).sort(),['choices','id','prompt']);assert.ok(q.choices.every(c=>!words.some(w=>w.id===c.id)));}
 const answers=Object.fromEntries(exam.questions.map(q=>[q.id,exam.answerKey[q.id]]));
 assert.equal(gradeExam(exam,answers).score,20);
 assert.throws(()=>gradeExam(exam,{...answers,[exam.questions[0].id]:'invented'}));
 assert.throws(()=>gradeExam(exam,{}));
});
test('state keeps language counts separate and never exposes vocabulary in locked stages',async()=>{
 const {service}=setup();const state=await service.state('en');assert.equal(state.stats.totalWords,25);assert.equal(state.stages[1].unlocked,false);assert.equal('wordIds' in state.stages[1],false);
 assert.equal((await service.study('en')).cards.length,10);await assert.rejects(service.study('en','en-2'),{status:403});
});
test('review is idempotent, rejects early review and stale versions, and retains a single event',async()=>{
 const {service,sql}=setup();const input=review('w0');const result=await service.review(input);assert.deepEqual(await service.review(input),result);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM review_events').get().n,1);
 await assert.rejects(service.review(review('w0')),{status:409});await assert.rejects(service.review(review('w0',1)),{status:409});
 await assert.rejects(service.review({...input,wordId:'w1'}),{status:409});
});
test('locked word reviews are rejected and per-language new word quota is enforced',async()=>{
 const {service}=setup();await assert.rejects(service.review(review('w20')),{status:403});
 await service.settings({dailyNewLimit:5});for(let i=0;i<5;i++)await service.review(review(`w${i}`));
 await assert.rejects(service.review(review('w5')),{status:409});assert.equal((await service.study('en')).newRemaining,0);
 assert.equal((await service.study('ja')).cards.length,5);await service.review(review('w25'));
 assert.equal((await service.state('en')).stats.todayNew,5);assert.equal((await service.state('ja')).stats.todayNew,1);
});
test('exam requires all words learned, reuses active attempt, and permanently unlocks next stage',async()=>{
 const {service,sql,seed}=setup();await assert.rejects(service.startExam({stageId:'en-1'}),{status:403});seed();
 const exam=await service.startExam({stageId:'en-1'});assert.equal((await service.startExam({stageId:'en-1'})).id,exam.id);assert.equal('answerKey' in exam,false);
 const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
 const answers=Object.fromEntries(stored.questions.map(q=>[q.id,stored.answerKey[q.id]]));
 const result=await service.submitExam({id:exam.id,answers});assert.equal(result.passed,true);assert.deepEqual(result.unlockedStageIds,['en-2']);
 assert.deepEqual(await service.submitExam({id:exam.id,answers:{}}),result);
 sql.prepare("UPDATE cards SET data=json_set(data,'$.mastered',json('false'),'$.lastRating',1)").run();
 const forgotten=await service.state('en');assert.equal(forgotten.stages[0].mastered,0);assert.equal(forgotten.stages[0].canTest,true);assert.equal(forgotten.stages[1].unlocked,true);
 assert.equal((await service.study('en','en-1')).availability.challengeStage,null);
});
test('forgetting before submission preserves learned status and perfect exam answers still unlock the next stage',async()=>{
 const {service,sql,seed}=setup();seed();const exam=await service.startExam({stageId:'en-1'});const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
 sql.prepare("UPDATE cards SET data=json_set(data,'$.mastered',json('false'),'$.lastRating',1)").run();
 const result=await service.submitExam({id:exam.id,answers:stored.answerKey});assert.equal(result.score,20);assert.equal(result.passed,true);assert.deepEqual(result.unlockedStageIds,['en-2']);
 const state=await service.state('en');assert.equal(state.stages[0].mastered,0);assert.equal(state.stages[0].learned,20);assert.equal(state.stages[1].unlocked,true);
});
test('learning every word still requires an 80 percent exam score to unlock the next stage',async()=>{
 for(const score of [15,16]){
  const {service,sql}=setup();await service.settings({dailyNewLimit:20});
  for(const word of words.slice(0,20))await service.review({...review(word.id),rating:1});
  const exam=await service.startExam({stageId:'en-1'});const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
  const answers={...stored.answerKey};for(const q of stored.questions.slice(score))answers[q.id]=q.choices.find(choice=>choice.id!==stored.answerKey[q.id]).id;
  const result=await service.submitExam({id:exam.id,answers});assert.equal(result.score,score);assert.equal(result.passed,score===16);
  assert.deepEqual(result.unlockedStageIds,score===16?['en-2']:[]);assert.equal((await service.state('en')).stages[1].unlocked,score===16);
 }
});
test('exam expires and does not accept answers after 30 minutes',async()=>{
 const {service,seed,setTime}=setup();seed();const exam=await service.startExam({stageId:'en-1'});setTime(time+31*60000);await assert.rejects(service.submitExam({id:exam.id,answers:{}}),{status:409});
});
test('POST JSON validation rejects cross-origin, unknown fields, oversized payload and invalid settings',async()=>{
 await assert.rejects(readBody(new Request('https://example.test/api/settings',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'})),{status:403});
 await assert.rejects(readBody(new Request('https://example.test/api/settings',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:'x'.repeat(33000)})),{status:413});
 const {service}=setup();await assert.rejects(service.settings({dailyNewLimit:0}),{status:400});await assert.rejects(service.settings({dailyNewLimit:10,extra:true}),{status:400});
});
test('parallel new-word submissions cannot exceed the daily limit',async()=>{
 const {service,sql}=setup();await service.settings({dailyNewLimit:5});
 const results=await Promise.allSettled(Array.from({length:6},(_,i)=>service.review(review(`w${i}`))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM cards').get().n,5);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM review_events').get().n,5);
});
test('parallel review versions allow one update and simultaneous exam starts reuse one attempt',async()=>{
 const {service,sql,seed}=setup();
 const reviews=await Promise.allSettled([service.review(review('w0')),service.review(review('w0'))]);
 assert.equal(reviews.filter(r=>r.status==='fulfilled').length,1);
 sql.exec('DELETE FROM cards; DELETE FROM review_events;');seed();
 const attempts=await Promise.all([service.startExam({stageId:'en-1'}),service.startExam({stageId:'en-1'})]);
 assert.equal(attempts[0].id,attempts[1].id);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM exams').get().n,1);
});
test('exam accepts exactly 80%, rejects 75%, and supports short final stages',()=>{
 const exam=createExam(words.slice(0,20),words);
 const answers={...exam.answerKey};
 for(const q of exam.questions.slice(0,4))answers[q.id]=q.choices.find(c=>c.id!==exam.answerKey[q.id]).id;
 assert.equal(gradeExam(exam,answers).score,16);
 const q=exam.questions[4];answers[q.id]=q.choices.find(c=>c.id!==exam.answerKey[q.id]).id;
 assert.equal(gradeExam(exam,answers).score,15);
 assert.equal(createExam(words.slice(0,3),words).questions.length,3);
});

test('duplicate request returns its receipt when another copy commits between receipt check and card load',async()=>{
 let release;let entered;let reads=0;
 const gate=new Promise(resolve=>{release=resolve});const paused=new Promise(resolve=>{entered=resolve});
 const {service,sql}=setup({afterFirst:async query=>{if(query.startsWith('SELECT word_id,result')&&++reads===1){entered();await gate}}});
 const input=review('w0');const duplicate=service.review(input);await paused;
 const first=await service.review(input);release();assert.deepEqual(await duplicate,first);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM review_events').get().n,1);
});
