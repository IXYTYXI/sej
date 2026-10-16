import type { Catalog, Language, Progress, Stage } from './types';
import { canChallenge, canOpen, dayKey, dayStart, hasMastery, recordReview } from './progression';
import { createExam, gradeExam, type ExamData } from './exams';
import { ApiError, identifier, object } from './server-http';
import type { Database } from './database';
import { createDailyQuota } from './daily-quota';

type User = {userId:string;displayName:string};
type CardRow = {data:string};
type ExamRow = {id:string;stage_id:string;data:string;expires_at:number;result:string|null};
type ReviewResult = {nextDue:string;isMastered:boolean};
type ReviewReceipt = {response:ReviewResult;rating:number;version:number};
const masterySQL = `json_extract(c.data, '$.lastRating') >= 3
 AND json_extract(c.data, '$.fsrs.scheduled_days') >= 7
 AND ? - json_extract(c.data, '$.firstSeen') >= 604800000
 AND (SELECT COUNT(DISTINCT value) FROM json_each(c.data, '$.goodDays')) >= 3`;
const countMasterySQL = `(SELECT COUNT(*) FROM cards c JOIN json_each(?) w ON c.word_id = w.value WHERE c.user_id = ? AND ${masterySQL})`;

export function createLearningService(db: Database, catalog: Catalog, user: User, clock: ()=>number = Date.now) {
  const words = new Map(catalog.words.map(word=>[word.id,word]));
  const stageMap = new Map(catalog.stages.map(stage=>[stage.id,stage]));
  const prepare = (sql:string,...values:(string|number|null)[]) => db.prepare(sql).bind(...values);
  const quotas = createDailyQuota(db,user.userId,clock);
  async function load(language:Language) {
    const [cardRows,grants,passed] = await Promise.all([
      prepare('SELECT data FROM cards WHERE user_id=? AND language=?',user.userId,language).all<CardRow>(),
      prepare('SELECT stage_id FROM unlocks WHERE user_id=?',user.userId).all<{stage_id:string}>(),
      prepare('SELECT stage_id FROM passes WHERE user_id=?',user.userId).all<{stage_id:string}>(),
    ]);
    return {progress:new Map(cardRows.results.map(row=>{const p=JSON.parse(row.data) as Progress;return [p.wordId,p]})),grants:new Set(grants.results.map(row=>row.stage_id)),passed:new Set(passed.results.map(row=>row.stage_id))};
  }
  async function todayNew(language:Language,now:number) {
    const row = await prepare('SELECT COUNT(*) AS n FROM review_events WHERE user_id=? AND language=? AND new_word=1 AND created_at>=? AND created_at<?',user.userId,language,dayStart(now),dayStart(now)+86400000).first<{n:number}>();
    return row?.n??0;
  }
  function stageFor(id:unknown) {
    const stage=stageMap.get(identifier(id)); if(!stage)throw new ApiError(404,'学习阶段不存在');return stage;
  }
  function stageMastered(stage:Stage,progress:Map<string,Progress>,now:number) {
    return stage.wordIds.filter(id=>{const card=progress.get(id);return card&&hasMastery(card,now)}).length;
  }
  async function state(language:Language) {
    const now=clock(); const {progress,grants,passed}=await load(language);const quota=await quotas.current(language,now);
    const stages=catalog.stages.filter(stage=>stage.language===language).map(stage=>{
      const mastered=stageMastered(stage,progress,now); const total=stage.wordIds.length;const unlocked=canOpen(stage,grants);
      return {id:stage.id,courseId:stage.courseId,language:stage.language,title:stage.title,index:stage.index,prerequisiteId:stage.prerequisiteId,total,mastered,learned:stage.wordIds.filter(id=>progress.has(id)).length,percent:total?Math.floor(mastered/total*100):0,unlocked,passed:passed.has(stage.id),canTest:unlocked&&canChallenge(mastered,total)};
    });
    const historyRows=await prepare("SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '+8 hours') AS date, COUNT(*) AS reviews, SUM(new_word) AS newWords FROM review_events WHERE user_id=? AND language=? AND created_at>=? AND created_at<? GROUP BY date",user.userId,language,dayStart(now)-13*86400000,dayStart(now)+86400000).all<{date:string;reviews:number;newWords:number}>();
    const historyMap=new Map(historyRows.results.map(row=>[row.date,row]));
    const history=Array.from({length:14},(_,i)=>{const date=dayKey(now-(13-i)*86400000);return historyMap.get(date)??{date,reviews:0,newWords:0}});
    const today=history[history.length-1];const mastered=[...progress.values()].filter(p=>hasMastery(p,now)).length;
    return {user:{name:user.displayName},language,settings:{dailyNewLimit:quota.baseLimit},quota,stats:{mastered,learning:progress.size-mastered,due:[...progress.values()].filter(p=>p.due<=now).length,totalWords:catalog.words.filter(w=>w.language===language).length,todayReviews:today.reviews,todayNew:today.newWords,unlockedStages:stages.filter(s=>s.unlocked).length,totalStages:stages.length},courses:catalog.courses.filter(course=>course.language===language),stages,history,sources:catalog.sources};
  }
  async function study(language:Language,stageId?:string,mode:'scheduled'|'practice'='scheduled') {
    const now=clock();const {progress,grants,passed}=await load(language);const quota=await quotas.current(language,now);
    let stages=catalog.stages.filter(stage=>stage.language===language&&canOpen(stage,grants));
    if(stageId){const stage=stageFor(stageId);if(stage.language!==language)throw new ApiError(400,'阶段与语言不匹配');if(!canOpen(stage,grants))throw new ApiError(403,'请先解锁这个阶段');stages=[stage]}
    const accessible=[...new Set(stages.flatMap(stage=>stage.wordIds))].filter(id=>words.get(id)?.language===language);
    const learned=accessible.map(id=>progress.get(id)).filter((p):p is Progress=>Boolean(p)).sort((a,b)=>a.due-b.due||a.wordId.localeCompare(b.wordId));
    const due=learned.filter(p=>p.due<=now);
    const unseen=accessible.filter(id=>!progress.has(id));
    const nextReview=learned.find(p=>p.due>now);
    const challengeStage=stages.find(stage=>!passed.has(stage.id)&&canChallenge(stageMastered(stage,progress,now),stage.wordIds.length));
    const availability={unseenCount:unseen.length,learnedCount:learned.length,nextReviewAt:nextReview?new Date(nextReview.due).toISOString():null,challengeStage:challengeStage?{id:challengeStage.id,title:challengeStage.title}:null};
    const newRemaining=quota.needsDecision?0:Math.max(0,quota.limit-await todayNew(language,now));
    const selected=(mode==='practice'?learned:due).slice(0,50).map(p=>({id:p.wordId,version:p.version,isNew:false}));
    if(mode==='scheduled')for(const id of unseen.slice(0,Math.min(newRemaining,50-selected.length)))selected.push({id,version:0,isNew:true});
    return {mode,cards:selected.map(item=>({...words.get(item.id)!,version:item.version,isNew:item.isNew})),newRemaining,dueCount:due.length,quota,availability};
  }
  async function review(input:unknown):Promise<ReviewResult> {
    const data=object(input,['wordId','rating','version','requestId']);const wordId=identifier(data.wordId);const word=words.get(wordId);
    if(!word)throw new ApiError(404,'单词不存在');
    const {rating,version,requestId}=data;
    if(!Number.isInteger(rating)||Number(rating)<1||Number(rating)>4||!Number.isSafeInteger(version)||Number(version)<0||typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new ApiError(400,'复习参数不正确');
    const readReceipt=async()=>{
      const saved=await prepare('SELECT word_id,result FROM review_events WHERE user_id=? AND request_id=?',user.userId,requestId).first<{word_id:string;result:string}>();
      if(!saved)return null;const receipt=JSON.parse(saved.result) as ReviewReceipt;
      if(saved.word_id!==wordId||receipt.rating!==rating||receipt.version!==version)throw new ApiError(409,'此请求编号已用于另一项操作');
      return receipt.response;
    };
    const prior=await readReceipt();if(prior)return prior;
    // Another copy can commit after the first receipt lookup but before these reads.
    const conflict=async(message:string):Promise<ReviewResult>=>{const saved=await readReceipt();if(saved)return saved;throw new ApiError(409,message)};
    const now=clock();const {progress,grants}=await load(word.language);const previous=progress.get(wordId)??null;
    if(!catalog.stages.some(stage=>stage.language===word.language&&stage.wordIds.includes(wordId)&&canOpen(stage,grants)))throw new ApiError(403,'请先解锁该单词所在阶段');
    if((previous?.version??0)!==version)return conflict('学习记录已更新，请刷新后重试');
    if(previous&&previous.due>now)return conflict('这个单词尚未到复习时间');
    if(!previous){
      const quota=await quotas.current(word.language,now);
      if(quota.needsDecision)return conflict('请先选择保留或重置之前增加的额度');
      if(await todayNew(word.language,now)>=quota.limit)return conflict('今天的新词目标已完成');
    }
    const next=recordReview(previous,word,Number(rating),now,requestId);const response={nextDue:new Date(next.due).toISOString(),isMastered:next.mastered};
    const receipt=JSON.stringify({response,rating,version});
    if(dayKey(clock())!==dayKey(now))return conflict('日期已变化，请刷新后重试');
    await db.batch([
      prepare(`INSERT INTO cards (user_id,word_id,language,data,version,due,last_request)
 SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM review_events WHERE user_id=? AND request_id=?)
 AND (? > 0 OR EXISTS (SELECT 1 FROM daily_quotas q WHERE q.user_id=? AND q.language=? AND q.day=? AND q.decision<>'pending'
   AND (SELECT COUNT(*) FROM review_events WHERE user_id=? AND language=? AND new_word=1 AND created_at>=? AND created_at<?) < q.quota_limit))
 ON CONFLICT(user_id,word_id) DO UPDATE SET data=excluded.data,version=excluded.version,due=excluded.due,last_request=excluded.last_request WHERE cards.version=? AND cards.due<=?`,user.userId,wordId,word.language,JSON.stringify(next),next.version,next.due,requestId,user.userId,requestId,Number(version),user.userId,word.language,dayKey(now),user.userId,word.language,dayStart(now),dayStart(now)+86400000,Number(version),now),
      prepare(`INSERT INTO review_events (user_id,request_id,word_id,language,created_at,new_word,result)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cards WHERE user_id=? AND word_id=? AND last_request=? AND version=?)
 ON CONFLICT(user_id,request_id) DO NOTHING`,user.userId,requestId,wordId,word.language,now,previous?0:1,receipt,user.userId,wordId,requestId,next.version),
    ]);
    const saved=await readReceipt();if(!saved)throw new ApiError(409,'学习记录或今日额度已更新，请刷新后重试');return saved;
  }
  async function settings(input:unknown) {
    const {dailyNewLimit}=object(input,['dailyNewLimit']);if(!Number.isInteger(dailyNewLimit)||Number(dailyNewLimit)<5||Number(dailyNewLimit)>50)throw new ApiError(400,'每日新词数量须为 5–50 的整数');
    return quotas.setBase(Number(dailyNewLimit));
  }
  async function startExam(input:unknown) {
    const {stageId}=object(input,['stageId']);const stage=stageFor(stageId);const now=clock();const {progress,grants}=await load(stage.language);
    if(!canOpen(stage,grants)||!canChallenge(stageMastered(stage,progress,now),stage.wordIds.length))throw new ApiError(403,'阶段解锁且掌握率达到 80% 后才能考试');
    const active=()=>prepare('SELECT id,stage_id,data,expires_at,result FROM exams WHERE user_id=? AND stage_id=? AND result IS NULL AND expires_at>? ORDER BY created_at,id LIMIT 1',user.userId,stage.id,now).first<ExamRow>();
    let exam=await active();
    if(!exam){
      const accessibleIds=new Set(catalog.stages.filter(candidate=>candidate.language===stage.language&&canOpen(candidate,grants)).flatMap(candidate=>candidate.wordIds));
      const generated=createExam(stage.wordIds.map(id=>words.get(id)!),catalog.words.filter(word=>accessibleIds.has(word.id)));
      const id=crypto.randomUUID();
      await prepare(`INSERT INTO exams (id,user_id,stage_id,data,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM exams WHERE user_id=? AND stage_id=? AND result IS NULL AND expires_at>?) AND ${countMasterySQL} >= ?`,id,user.userId,stage.id,JSON.stringify(generated),now,now+30*60000,user.userId,stage.id,now,JSON.stringify(stage.wordIds),user.userId,now,Math.ceil(stage.wordIds.length*.8)).run();
      exam=await active();if(!exam)throw new ApiError(409,'掌握状态已更新，请刷新后再考试');
    }
    return {id:exam.id,questions:(JSON.parse(exam.data) as ExamData).questions,expiresAt:new Date(exam.expires_at).toISOString()};
  }
  async function submitExam(input:unknown) {
    const data=object(input,['id','answers']);const id=identifier(data.id);const now=clock();
    const row=await prepare('SELECT id,stage_id,data,expires_at,result FROM exams WHERE id=? AND user_id=?',id,user.userId).first<ExamRow>();
    if(!row)throw new ApiError(404,'试卷不存在');if(row.result)return JSON.parse(row.result);
    if(row.expires_at<=now)throw new ApiError(409,'试卷已过期，请重新开始');
    const stage=stageFor(row.stage_id);const graded=gradeExam(JSON.parse(row.data) as ExamData,data.answers);
    const children=catalog.stages.filter(candidate=>candidate.prerequisiteId===stage.id).map(candidate=>candidate.id);
    const eligible=canChallenge(graded.score,graded.total)?1:0;
    const base=JSON.stringify({...graded,passed:false,unlockedStageIds:[]});
    const batch=[prepare(`WITH qualified AS (SELECT CASE WHEN ?=1 AND ${countMasterySQL}>=? THEN 1 ELSE 0 END AS ok)
 UPDATE exams SET result=(SELECT json_set(?, '$.passed', json(CASE WHEN ok=1 THEN 'true' ELSE 'false' END), '$.unlockedStageIds', json(CASE WHEN ok=1 THEN ? ELSE '[]' END)) FROM qualified) WHERE id=? AND user_id=? AND result IS NULL AND expires_at>?`,eligible,JSON.stringify(stage.wordIds),user.userId,now,Math.ceil(stage.wordIds.length*.8),base,JSON.stringify(children),id,user.userId,now),
      prepare(`INSERT INTO passes (user_id,stage_id,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM exams WHERE id=? AND user_id=? AND json_extract(result,'$.passed')=1) ON CONFLICT(user_id,stage_id) DO NOTHING`,user.userId,stage.id,now,id,user.userId),
      ...children.map(child=>prepare(`INSERT INTO unlocks (user_id,stage_id,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM exams WHERE id=? AND user_id=? AND json_extract(result,'$.passed')=1) ON CONFLICT(user_id,stage_id) DO NOTHING`,user.userId,child,now,id,user.userId)),
    ];
    await db.batch(batch);
    const saved=await prepare('SELECT result FROM exams WHERE id=? AND user_id=?',id,user.userId).first<{result:string|null}>();
    if(!saved?.result)throw new ApiError(409,'试卷状态已改变，请刷新后重试');return JSON.parse(saved.result);
  }
  return {state,study,review,settings,startExam,submitExam,adjustQuota:quotas.adjust};
}
