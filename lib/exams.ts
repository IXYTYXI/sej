import type { Question, Word } from './types';
import { ApiError, object } from './server-http';
export type ExamData = {questions: Question[]; answerKey: Record<string, string>};
export type GradedExam = {score:number; total:number; results:{prompt:string;correct:boolean;answer:string;chosen:string}[]};
function sample<T>(items: T[], count = items.length): T[] {
  const result = [...items];
  for (let i=0;i<Math.min(count,result.length);i++) {
    const number = crypto.getRandomValues(new Uint32Array(1))[0];
    const j = i + Math.floor((number / 4294967296) * (result.length-i));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0,count);
}
export function createExam(stageWords: Word[], pool: Word[]): ExamData {
  const answerKey: Record<string,string> = {};
  const meanings = [...new Set(pool.map(word=>word.meaning).filter(Boolean))];
  if (meanings.length < 4) throw new ApiError(409, '词库暂不足以生成考试选项');
  const questions = sample(stageWords,20).map(word => {
    const id = crypto.randomUUID();
    const correct = {id:crypto.randomUUID(), text:word.meaning};
    answerKey[id] = correct.id;
    const choices = sample([correct,...sample(meanings.filter(text=>text!==word.meaning),3).map(text=>({id:crypto.randomUUID(),text}))]);
    return {id,prompt:word.reading && word.language==='ja' ? `${word.word}（${word.reading}）` : word.word,choices};
  });
  return {questions,answerKey};
}
export function gradeExam(exam: ExamData, input: unknown): GradedExam {
  const answers = object(input,exam.questions.map(question=>question.id));
  const results = exam.questions.map(question => {
    const chosen = question.choices.find(choice=>choice.id===answers[question.id]);
    if (!chosen) throw new ApiError(400,'请完成全部题目，答案必须属于当前试卷');
    const answer = question.choices.find(choice=>choice.id===exam.answerKey[question.id]);
    if (!answer) throw new Error('Invalid stored examination');
    return {prompt:question.prompt,correct:chosen.id===answer.id,answer:answer.text,chosen:chosen.text};
  });
  return {score:results.filter(result=>result.correct).length,total:results.length,results};
}
