export type Language = 'en' | 'ja';
export type Word = { id:string; language:Language; word:string; reading:string; meaning:string; example?:string; exampleMeaning?:string; tags:string[]; source:string };
export type Stage = {id:string; courseId:string; language:Language; title:string; index:number; prerequisiteId:string|null; wordIds:string[]};
export type Catalog = {courses:{id:string; title:string; language:Language; description:string; sourceUrl:string}[]; stages:Stage[]; words:Word[]; sources:{id:string; name:string; url:string; license:string; licenseUrl:string; note:string}[]};
export type Progress = {wordId:string; language:Language; fsrs:Record<string,unknown>; firstSeen:number; goodDays:string[]; lastRating:number; version:number; due:number; mastered:boolean; lastRequest:string};
export type Question = {id:string; prompt:string; choices:{id:string;text:string}[]};
