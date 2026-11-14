import path from 'node:path';
import {LocalStore} from './local-store.mjs';
import {validateDailyReportDate} from './public/daily-report.js';

const maxReports=366,maxMarkdown=100000,maxBytes=50000000;
const reportId=(date,timeZone)=>date+'@'+timeZone;
function validateMarkdown(markdown){if(typeof markdown!=='string'||!markdown.trim()||markdown.length>maxMarkdown)throw Error('日報は1〜100,000文字で保存してください。');}
function checkSize(value){if(Buffer.byteLength(JSON.stringify(value),'utf8')>maxBytes)throw Error('保存済みの日報が50MBを超えています。');}
export class DailyReportStore extends LocalStore{
 constructor(directory,onChange){super(path.join(directory,'daily-reports.json'),{version:1,revision:0,items:[]},onChange);}
 async load(){
  await super.load(value=>{
   if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items)||value.items.length>maxReports)throw Error('日報の保存内容を確認できません。');
   const ids=new Set();
   for(const item of value.items){
    if(!item)throw Error('日報の保存内容を確認できません。');
    if(typeof item.timeZone!=='string')throw Error('日報の保存内容を確認できません。');
    validateDailyReportDate(item.date,item.timeZone);validateMarkdown(item.markdown);
    if(item.id!==reportId(item.date,item.timeZone)||ids.has(item.id)||!Number.isFinite(item.createdAt)||!Number.isFinite(item.updatedAt)||Math.abs(item.createdAt)>8640000000000000||Math.abs(item.updatedAt)>8640000000000000)throw Error('日報の保存内容を確認できません。');
    ids.add(item.id);
   }
   checkSize(value);
  });return this;
 }
 public(){
  return {version:1,revision:this.value.revision,items:this.value.items.map(({id,date,timeZone,createdAt,updatedAt})=>({id,date,timeZone,createdAt,updatedAt})).sort((a,b)=>a.id<b.id?1:a.id>b.id?-1:0)};
 }
 item(date,timeZone='Asia/Tokyo'){
  validateDailyReportDate(date,timeZone);
  return structuredClone(this.value.items.find(item=>item.id===reportId(date,timeZone))||null);
 }
 async save({date,timeZone='Asia/Tokyo',markdown}={}){
  validateDailyReportDate(date,timeZone);validateMarkdown(markdown);
  const id=reportId(date,timeZone);
  return this.mutate(value=>{
   let item=value.items.find(item=>item.id===id);const now=Date.now();
   if(!item){if(value.items.length>=maxReports)throw Error('日報は366件まで保存できます。');item={id,date,timeZone,createdAt:now};value.items.push(item);}
   Object.assign(item,{markdown,updatedAt:now});
   checkSize({...value,revision:value.revision+1});return item;
  });
 }
}
