import type {Progress,Stage} from './types';
import {createEmptyCard,fsrs,type Card,type Grade} from 'ts-fsrs';
const DAY=86400000;
const scheduler=fsrs({request_retention:0.9,enable_fuzz:false});
export function canChallenge(learned:number,total:number){return total>0&&learned>=total;}
export function hasPassingScore(score:number,total:number){return total>0&&score>=Math.ceil(total*0.8);}
export function hasMastery(card:Pick<Progress,'firstSeen'|'goodDays'|'lastRating'|'fsrs'|'due'>,now:number){
  return new Set(card.goodDays).size>=3&&now-card.firstSeen>=7*DAY&&card.lastRating>=3&&Number(card.fsrs.scheduled_days)>=7;
}
export function canOpen(stage:Pick<Stage,'id'|'prerequisiteId'>,grants:Set<string>){return stage.prerequisiteId===null||grants.has(stage.id);}
export function dayKey(time:number){return new Date(time+8*3600000).toISOString().slice(0,10);}
export function dayStart(time:number){return Date.parse(dayKey(time)+'T00:00:00+08:00');}
export function recordReview(previous:Progress|null,word:{id:string;language:'en'|'ja'},rating:number,now:number,requestId:string):Progress{
  if(!Number.isInteger(rating)||rating<1||rating>4)throw new Error('无效的记忆评分');
  const old=previous?{...previous.fsrs,due:new Date(previous.due),last_review:previous.fsrs.last_review?new Date(String(previous.fsrs.last_review)):undefined} as Card:createEmptyCard(new Date(now));
  const {card}=scheduler.next(old,new Date(now),rating as Grade);
  let goodDays=previous?.goodDays??[];
  if(rating===1)goodDays=[];
  else if(rating>=3&&(!previous||previous.due<=now))goodDays=[...new Set([...goodDays,dayKey(now)])].slice(-10);
  const result:Progress={wordId:word.id,language:word.language,fsrs:JSON.parse(JSON.stringify(card)),firstSeen:previous?.firstSeen??now,goodDays,lastRating:rating,version:(previous?.version??0)+1,due:card.due.getTime(),mastered:false,lastRequest:requestId};
  result.mastered=hasMastery(result,now);
  return result;
}
