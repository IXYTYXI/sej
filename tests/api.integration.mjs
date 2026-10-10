// Isolated local-preview acceptance checks. Never point this script at production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {recordReview} from '../lib/progression.ts';

const origin='http://127.0.0.1:5173';
const user='local_seedy';
const catalog=JSON.parse(fs.readFileSync('data/catalog.json','utf8'));
const stage=catalog.stages.find(s=>s.language==='en'&&!s.prerequisiteId);
const next=catalog.stages.find(s=>s.prerequisiteId===stage.id);
const words=new Map(catalog.words.map(w=>[w.id,w]));
let owned=false;
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function sql(commands){
 fs.mkdirSync('.sites-runtime',{recursive:true});
 const path='.sites-runtime/api-test-fixture.sql';
 fs.writeFileSync(path,commands);
 execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file',path],{stdio:'pipe'});
}
async function api(path,body,extra={}){
 const res=await fetch(origin+path,{headers:{Cookie:'__sites_local_auth=1',Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const text=await res.text(); let json;try{json=JSON.parse(text)}catch{if(res.status===403&&extra.Origin&&extra.Origin!==origin)json={error:text};else throw new Error(`${path}: expected JSON (${res.status}) ${text.slice(0,200)}`)};
 return {status:res.status,body:json};
}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
try{
 const anon=await fetch(origin+'/api/state?language=en');assert.equal(anon.status,401);
 const initial=ok(await api('/api/state?language=en'));
 assert.equal(initial.stats.mastered,0);assert.equal(initial.stats.learning,0,'Local QA database must start empty');
 const ja=ok(await api('/api/state?language=ja'));assert.equal(ja.stats.learning,0);
 owned=true;
 assert.equal(initial.stages.filter(s=>s.unlocked).length,1);
 assert.equal((await api('/api/study?language=en&stageId='+next.id)).status,403);
 assert.equal((await api('/api/exam',{stageId:stage.id})).status,403);
 assert.equal((await api('/api/settings',{dailyNewLimit:0})).status,400);
 assert.equal((await api('/api/settings',{dailyNewLimit:10},{Origin:'https://other.invalid'})).status,403);
 console.log('PASS authentication, origin, validation, initial locks and exam threshold');
 const queue=ok(await api('/api/study?language=en'));
 assert.equal(queue.cards.length,10);assert.equal(new Set(queue.cards.map(c=>c.id)).size,10);
 const first=queue.cards[0];const request={wordId:first.id,rating:4,version:0,requestId:crypto.randomUUID()};
 const reviewed=ok(await api('/api/review',request));assert.equal(reviewed.isMastered,false);
 assert.deepEqual(ok(await api('/api/review',request)),reviewed);
 const after=ok(await api('/api/state?language=en'));assert.equal(after.stats.todayNew,1);assert.equal(after.stats.mastered,0);
 assert.equal((await api('/api/review',{...request,requestId:crypto.randomUUID()})).status,409);
 const lockedWord=next.wordIds.find(id=>!stage.wordIds.includes(id));
 assert.equal((await api('/api/review',{wordId:lockedWord,rating:4,version:0,requestId:crypto.randomUUID()})).status,403);
 assert.equal(ok(await api('/api/state?language=ja')).stats.todayNew,0);
 console.log('PASS repeat request idempotency, optimistic concurrency, locked-word write and language isolation');
 // Twenty concurrent new-word requests must not exceed the daily limit of ten.
 await Promise.all(stage.wordIds.filter(id=>id!==first.id).slice(0,20).map(id=>api('/api/review',{wordId:id,rating:3,version:0,requestId:crypto.randomUUID()})));
 assert.equal(ok(await api('/api/state?language=en')).stats.todayNew,10);
 console.log('PASS atomic daily new-word quota under concurrency');
 const now=Date.now();
 function seedMastered(count){
  const commands=[];
  for(const id of stage.wordIds.slice(0,count)){
   const p=recordReview(null,words.get(id),3,now-9*86400000,'fixture');
   Object.assign(p,{firstSeen:now-9*86400000,goodDays:['2026-01-01','2026-01-04','2026-01-09'],lastRating:3,due:now+86400000,version:1,mastered:true});
   p.fsrs.scheduled_days=10;
   commands.push(`INSERT INTO cards(user_id,word_id,language,data,version,due,last_request) VALUES (${quote(user)},${quote(id)},'en',${quote(JSON.stringify(p))},1,${p.due},'fixture') ON CONFLICT(user_id,word_id) DO UPDATE SET data=excluded.data,version=1,due=excluded.due,last_request='fixture';`);
  }
  sql(commands.join('\n'));
 }
 seedMastered(79);assert.equal((await api('/api/exam',{stageId:stage.id})).status,403);
 seedMastered(80);
 const exam=ok(await api('/api/exam',{stageId:stage.id}));assert.equal(exam.questions.length,20);assert.ok(!('answerKey' in exam));
 assert.equal(ok(await api('/api/exam',{stageId:stage.id})).id,exam.id);
 // Ground truth comes from the local fixture catalog, not from a server-exposed answer key.
 const answers={};
 for(const q of exam.questions){
  const source=stage.wordIds.map(id=>words.get(id)).find(w=>q.prompt===w.word||q.prompt.startsWith(w.word+' '));
  assert.ok(source,`Unexpected question format: ${q.prompt}`);
  const correct=q.choices.find(c=>c.text===source.meaning);assert.ok(correct,'Exam choices should preserve dictionary meanings');answers[q.id]=correct.id;
 }
 const passed=ok(await api('/api/exam/submit',{id:exam.id,answers}));assert.equal(passed.passed,true);assert.equal(passed.score,20);assert.ok(passed.unlockedStageIds.includes(next.id));
 assert.deepEqual(ok(await api('/api/exam/submit',{id:exam.id,answers})),passed);
 assert.equal(ok(await api('/api/state?language=en')).stages.find(s=>s.id===next.id).unlocked,true);
 console.log('PASS 79/80 percent boundary, private answers, session reuse, scoring and permanent next-stage grant');
 // Later forgetting must reduce mastery without revoking an earned unlock.
 const id=stage.wordIds[0];const p=recordReview(null,words.get(id),1,now,'forget-fixture');
 sql(`UPDATE cards SET data=${quote(JSON.stringify(p))},due=${p.due} WHERE user_id=${quote(user)} AND word_id=${quote(id)};`);
 const forgotten=ok(await api('/api/state?language=en'));assert.equal(forgotten.stages.find(s=>s.id===stage.id).mastered,79);assert.equal(forgotten.stages.find(s=>s.id===next.id).unlocked,true);
 assert.equal((await api('/api/study?language=en&stageId='+next.id)).status,200);
 console.log('PASS forgetting reduces current mastery but keeps earned unlock');
 console.log('ALL LOCAL API ACCEPTANCE CHECKS PASSED');
}finally{
 if(owned){sql(['review_events','cards','exams','unlocks','passes','learners'].map(t=>`DELETE FROM ${t} WHERE user_id=${quote(user)};`).join('\n'));console.log('Removed only this run’s local simulated-user fixtures.');}
}
