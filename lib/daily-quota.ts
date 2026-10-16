import { createHash, randomUUID } from 'node:crypto';
import type { Database, PreparedStatement } from './database';
import type { Language } from './types';
import { dayKey } from './progression';
import { ApiError, object } from './server-http';

export type QuotaSnapshot = {
  day:string; baseLimit:number; limit:number; boostsUsed:number; boostsRemaining:number;
  needsDecision:boolean; previousDay:string|null; previousLimit:number|null; version:number; boosts:number[];
};
type QuotaResult = {quota:QuotaSnapshot};
type QuotaInput = {language:Language;action:'boost'|'keep'|'reset';amount?:number;day:string;version:number;requestId:string};
const MAX_LIMIT = 2147483647;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// SQL creates both the response and the audit from the row inside its write
// transaction. A concurrent tab cannot change the saved receipt afterwards.
function snapshotSQL(alias='daily_quotas'):string {
  const c=(name:string)=>`${alias}.${name}`;
  return `json_object('day',${c('day')},'baseLimit',${c('base_limit')},'limit',${c('quota_limit')},
    'boostsUsed',json_array_length(${c('boosts')}),'boostsRemaining',3-json_array_length(${c('boosts')}),
    'needsDecision',json(CASE WHEN ${c('decision')}='pending' THEN 'true' ELSE 'false' END),
    'previousDay',${c('previous_day')},'previousLimit',${c('previous_limit')},'version',${c('version')},'boosts',json(${c('boosts')}))`;
}

function validate(input:unknown):QuotaInput {
  const data=object(input,['language','action','amount','day','version','requestId']);
  if(data.language!=='en'&&data.language!=='ja')throw new ApiError(400,'请选择英语或日语');
  if(data.action!=='boost'&&data.action!=='keep'&&data.action!=='reset')throw new ApiError(400,'请选择有效的额度操作');
  if(typeof data.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.day)||!Number.isFinite(Date.parse(`${data.day}T00:00:00Z`))||new Date(`${data.day}T00:00:00Z`).toISOString().slice(0,10)!==data.day)throw new ApiError(400,'额度日期不正确');
  if(!Number.isSafeInteger(data.version)||Number(data.version)<1||typeof data.requestId!=='string'||!UUID.test(data.requestId))throw new ApiError(400,'额度版本或请求编号不正确');
  if(data.action==='boost') {
    if(!Number.isInteger(data.amount)||Number(data.amount)<1||Number(data.amount)>100)throw new ApiError(400,'增加数量须为 1–100 的整数');
  } else if(data.amount!==undefined)throw new ApiError(400,'保留或重置额度时不接受增加数量');
  return {language:data.language,action:data.action,amount:data.action==='boost'?Number(data.amount):undefined,day:data.day,version:Number(data.version),requestId:data.requestId.toLowerCase()};
}

export function createDailyQuota(db:Database,userId:string,clock:()=>number=Date.now) {
  const prepare=(sql:string,...values:(string|number|null)[])=>db.prepare(sql).bind(...values);
  function audit(action:string,requestId:string,now:number,fingerprint:string,amount:number|null=null):PreparedStatement {
    return prepare(`INSERT INTO quota_events (user_id,request_id,language,day,action,amount,fingerprint,before_state,result,created_at)
      SELECT user_id,last_request,language,day,?,?,?,before_state,json_object('quota',json(${snapshotSQL()})),?
      FROM daily_quotas WHERE user_id=? AND last_request=?
      ON CONFLICT(user_id,request_id) DO NOTHING`,action,amount,fingerprint,now,userId,requestId);
  }

  async function current(language:Language,now=clock()):Promise<QuotaSnapshot> {
    const day=dayKey(now);
    const requestId=`initialize:${language}:${day}`;
    await db.batch([
      prepare(`WITH previous AS (
          SELECT day,base_limit,quota_limit FROM daily_quotas WHERE user_id=? AND language=? AND day<? ORDER BY day DESC LIMIT 1
        ), baseline AS (SELECT COALESCE((SELECT daily_new_limit FROM learners WHERE user_id=?),10) AS n)
        INSERT INTO daily_quotas (user_id,language,day,base_limit,quota_limit,boosts,decision,previous_day,previous_limit,version,last_request,updated_at)
        SELECT ?,?,?,baseline.n,baseline.n+COALESCE(previous.quota_limit-previous.base_limit,0),'[]',
          CASE WHEN COALESCE(previous.quota_limit-previous.base_limit,0)>0 THEN 'pending' ELSE 'none' END,
          previous.day,previous.quota_limit,1,?,?
        FROM baseline LEFT JOIN previous ON 1=1
        WHERE COALESCE(previous.quota_limit-previous.base_limit,0)<=?-baseline.n
        ON CONFLICT(user_id,language,day) DO NOTHING`,userId,language,day,userId,userId,language,day,requestId,now,MAX_LIMIT),
      audit('initialize',requestId,now,requestId),
    ]);
    const row=await prepare(`SELECT ${snapshotSQL()} AS snapshot FROM daily_quotas WHERE user_id=? AND language=? AND day=?`,userId,language,day).first<{snapshot:string}>();
    if(!row)throw new ApiError(409,'累计新词额度过高，请调低基础设置后重试');
    return JSON.parse(row.snapshot) as QuotaSnapshot;
  }

  async function adjust(input:unknown):Promise<QuotaResult> {
    const data=validate(input);
    const fingerprint=createHash('sha256').update(JSON.stringify({language:data.language,action:data.action,amount:data.amount,day:data.day,version:data.version})).digest('hex');
    const receipt=async():Promise<QuotaResult|null>=>{
      const row=await prepare('SELECT fingerprint,result FROM quota_events WHERE user_id=? AND request_id=?',userId,data.requestId).first<{fingerprint:string;result:string}>();
      if(!row)return null;
      if(row.fingerprint!==fingerprint)throw new ApiError(409,'此请求编号已用于另一项操作');
      return JSON.parse(row.result) as QuotaResult;
    };
    const prior=await receipt();
    if(prior)return prior;
    const conflict=async(message:string):Promise<QuotaResult>=>{
      const saved=await receipt();
      if(saved)return saved;
      throw new ApiError(409,message);
    };
    if(data.day!==dayKey(clock()))return conflict('日期已变化，请刷新今天的额度后重试');
    const quota=await current(data.language);
    if(quota.version!==data.version)return conflict('额度已更新，请刷新后重试');
    if(data.action==='boost') {
      if(quota.needsDecision)return conflict('请先选择保留或重置之前增加的额度');
      if(quota.boostsRemaining===0)return conflict('今天的三次提升机会已用完');
      if(quota.boostsUsed===0&&data.amount!==10)throw new ApiError(400,'每天第一次提升固定增加 10 词');
      if(quota.limit>MAX_LIMIT-data.amount!)return conflict('累计新词额度已达到上限');
    } else if(!quota.needsDecision)return conflict('今天的额度无需再次选择保留或重置');
    const now=clock();
    if(data.day!==dayKey(now))return conflict('日期已变化，请刷新今天的额度后重试');
    const amount=data.amount??0;
    await db.batch([
      prepare(`UPDATE daily_quotas SET before_state=${snapshotSQL()},
        quota_limit=CASE WHEN ?='boost' THEN quota_limit+? WHEN ?='reset' THEN base_limit ELSE quota_limit END,
        boosts=CASE WHEN ?='boost' THEN json_insert(boosts,'$[#]',?) ELSE boosts END,
        decision=CASE WHEN ?='keep' THEN 'keep' WHEN ?='reset' THEN 'reset' ELSE decision END,
        version=version+1,last_request=?,updated_at=?
        WHERE user_id=? AND language=? AND day=? AND version=? AND version<?
        AND NOT EXISTS (SELECT 1 FROM quota_events WHERE user_id=? AND request_id=?)
        AND ((?='boost' AND decision<>'pending' AND json_array_length(boosts)<3
          AND ((json_array_length(boosts)=0 AND ?=10) OR (json_array_length(boosts)>0 AND ? BETWEEN 1 AND 100)) AND quota_limit<=?-?)
          OR (? IN ('keep','reset') AND decision='pending'))`,data.action,amount,data.action,data.action,amount,data.action,data.action,data.requestId,now,userId,data.language,data.day,data.version,MAX_VERSION,userId,data.requestId,data.action,amount,amount,MAX_LIMIT,amount,data.action),
      audit(data.action,data.requestId,now,fingerprint,data.amount??null),
    ]);
    return (await receipt())??conflict('额度已更新，请刷新后重试');
  }

  async function setBase(limit:number):Promise<{dailyNewLimit:number}> {
    const now=clock();
    const day=dayKey(now);
    const operation=`settings:${randomUUID()}`;
    const changed=await db.batch([
      // Guard the setting itself before updating daily rows so the whole change
      // is rejected if preserving accumulated additions would overflow.
      prepare(`INSERT INTO learners (user_id,daily_new_limit)
        SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM daily_quotas WHERE user_id=? AND day=? AND (quota_limit-base_limit>?-? OR (base_limit<>? AND version>=?)))
        ON CONFLICT(user_id) DO UPDATE SET daily_new_limit=excluded.daily_new_limit`,userId,limit,userId,day,MAX_LIMIT,limit,limit,MAX_VERSION),
      prepare(`UPDATE daily_quotas SET before_state=${snapshotSQL()},quota_limit=quota_limit-base_limit+?,base_limit=?,version=version+1,
        last_request=?||':'||language,updated_at=?
        WHERE user_id=? AND day=? AND base_limit<>? AND (SELECT daily_new_limit FROM learners WHERE user_id=?)=?`,limit,limit,operation,now,userId,day,limit,userId,limit),
      audit('settings',`${operation}:en`,now,operation),
      audit('settings',`${operation}:ja`,now,operation),
    ]);
    if(!changed[0].meta.changes)throw new ApiError(409,'累计新词额度过高，无法应用此基础设置');
    return {dailyNewLimit:limit};
  }
  return {current,adjust,setBase};
}
