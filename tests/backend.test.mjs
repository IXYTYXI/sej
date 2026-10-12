import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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
function setup(hooks = {}) {
  const sql=new DatabaseSync(':memory:');for(const file of ['0000_amazing_old_lace.sql','0003_daily_quota.sql'])sql.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
  const stmt=(query,values=[])=>({query,values,bind(...args){return stmt(query,args)},async all(){return {results:sql.prepare(query).all(...values)}},async first(){const row=sql.prepare(query).get(...values)??null;await hooks.afterFirst?.(query,row);return row},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}}}});
  const db={prepare:stmt,async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts){const changed=sql.prepare(s.query).run(...s.values);r.push({meta:{changes:Number(changed.changes)}});}sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
  let now=time; const service=createLearningService(db,catalog,{userId:'u1',displayName:'User'},()=>now);
  function seed(count=16){for(const w of words.slice(0,count)){const data={wordId:w.id,language:w.language,fsrs:{state:2,due:new Date(time),last_review:new Date(time-86400000),stability:20,difficulty:3,elapsed_days:1,scheduled_days:20,reps:4,lapses:0},firstSeen:time-10*86400000,goodDays:['2026-10-01','2026-10-05','2026-10-10'],lastRating:3,version:1,due:time,mastered:true,lastRequest:'seed'};sql.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?)').run('u1',w.id,w.language,JSON.stringify(data),1,time,'seed')}}
  return {service,sql,seed,setTime:t=>now=t};
}
const review=(wordId,version=0,requestId=crypto.randomUUID())=>({wordId,version,requestId,rating:3});

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
test('exam requires current mastery, reuses active attempt, and permanently unlocks next stage',async()=>{
 const {service,sql,seed}=setup();await assert.rejects(service.startExam({stageId:'en-1'}),{status:403});seed();
 const exam=await service.startExam({stageId:'en-1'});assert.equal((await service.startExam({stageId:'en-1'})).id,exam.id);assert.equal('answerKey' in exam,false);
 const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
 const answers=Object.fromEntries(stored.questions.map(q=>[q.id,stored.answerKey[q.id]]));
 const result=await service.submitExam({id:exam.id,answers});assert.equal(result.passed,true);assert.deepEqual(result.unlockedStageIds,['en-2']);
 assert.deepEqual(await service.submitExam({id:exam.id,answers:{}}),result);
 sql.prepare("UPDATE cards SET data=json_set(data,'$.mastered',json('false'),'$.lastRating',1)").run();
 assert.equal((await service.state('en')).stages[1].unlocked,true);
});
test('mastery loss before submission prevents unlock even with perfect exam answers',async()=>{
 const {service,sql,seed}=setup();seed();const exam=await service.startExam({stageId:'en-1'});const stored=JSON.parse(sql.prepare('SELECT data FROM exams WHERE id=?').get(exam.id).data);
 sql.prepare("UPDATE cards SET data=json_set(data,'$.mastered',json('false'),'$.lastRating',1)").run();
 const result=await service.submitExam({id:exam.id,answers:stored.answerKey});assert.equal(result.score,20);assert.equal(result.passed,false);assert.deepEqual(result.unlockedStageIds,[]);
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
