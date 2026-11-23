import {ui} from './interface-language.js';
import {mapTranscriptText} from './world-dialogue.js';
import {villageDelegation} from './village-delegates.js';

// A local, conservative reading of saved conversations. These stages describe
// evidence in the transcript, not an inspection or certification of software.
export const VILLAGE_STAGES=Object.freeze([
  Object.freeze({id:'planned',label:ui('構想', "Planned")}),
  Object.freeze({id:'building',label:ui('建設中', "Building")}),
  Object.freeze({id:'testing',label:ui('仕上げ・検証', "Testing")}),
  Object.freeze({id:'complete',label:ui('完成', "Complete")})
]);

const stageIds=new Set(VILLAGE_STAGES.map(stage=>stage.id));
const activities=new Set(['starting','running','stopping']);
const appearances=['hero','mage','priest','martial-artist'];
const string=value=>typeof value==='string'?value:'';
const bounded=(value,length)=>Array.from(string(value).trim().replace(/\s+/gu,' ')).slice(0,length).join('');
const normalized=value=>string(value).normalize('NFKC').toLocaleLowerCase('ja');

function hash(value){
  let seed=2166136261;
  for(let index=0;index<value.length;index++){seed^=value.charCodeAt(index);seed=Math.imul(seed,16777619);}
  return seed>>>0;
}

function timestamp(value){
  if(typeof value==='number')return Number.isFinite(value)&&Math.abs(value)<=8640000000000000?value:null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
  const result=Date.parse(value);return Number.isFinite(result)?result:null;
}

// Bound each inspected message, while retaining earlier milestones. Sampling
// only recent turns would erase buildings after unrelated follow-up messages.
function inspectedMessages(messages){
  return messages.map((message,index)=>({role:message.role,text:mapTranscriptText(message.text).slice(0,index<messages.length-24?2000:4000)}));
}

function narrative(value,{quotes=false}={}){
  let result=string(value)
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g,' ')
    .replace(/^\s*>.*$/gm,' ')
    .replace(/^(?: {4}|\t).*$/gm,' ')
    .replace(/`[^`\n]*`/g,' ');
  if(quotes)result=result.replace(/"[^"\n]*"|'[^'\n]{2,240}'|「[^」]*」|『[^』]*』|“[^”]*”/g,' ');
  return result;
}

// These are literal topic aliases, not inferred personal characteristics. They
// let an explicit Japanese topic meet a building named with its English term.
const topicAliases=[
  ['music',/(?:音楽|作曲|\bmusic\b)/iu],['chat',/(?:チャット|会話|\bchat\b)/iu],
  ['inventory',/(?:在庫|\binventory\b)/iu],['budget',/(?:家計|家計簿|\bbudget(?:ing)?\b)/iu],
  ['booking',/(?:予約|\bbooking\b|\breservation\b)/iu],['travel',/(?:旅行|観光|\btravel\b)/iu],
  ['learning',/(?:学習|教育|\blearning\b|\beducation\b)/iu],['weather',/(?:天気|気象|\bweather\b)/iu],
  ['cooking',/(?:料理|献立|レシピ|\bcooking\b|\brecipes?\b)/iu],['photo',/(?:写真|\bphoto(?:graphy)?\b)/iu],
  ['image',/(?:画像|\bimages?\b)/iu],['video',/(?:動画|\bvideos?\b)/iu],
  ['game',/(?:ゲーム|\bgames?\b)/iu],['map',/(?:地図|\bmaps?\b)/iu],
  ['notification',/(?:通知|\bnotifications?\b)/iu],['email',/(?:メール|\be-?mail\b)/iu],
  ['calendar',/(?:カレンダー|\bcalendar\b)/iu],['statistics',/(?:統計|\bstatistics\b)/iu],
  ['auth',/(?:認証|\bauth(?:entication)?\b)/iu],['payment',/(?:決済|\bpayments?\b)/iu],
  ['history',/(?:履歴|\bhistory\b)/iu],['privacy',/(?:プライバシー|\bprivacy\b)/iu],
  ['accessibility',/(?:アクセシビリティ|\baccessib(?:le|ility)\b)/iu],
  ['physics',/(?:物理|\bphysics\b)/iu],['math',/(?:数学|\bmath(?:ematics)?\b)/iu],
  ['quantum',/(?:量子|\bquantum\b)/iu]
];
const topicStopWords=new Set(['the','a','an','and','or','for','to','of','in','on','with','my','our','i','we','me','please','would','like','want','need','build','building','create','develop','development','implement','implementation','fix','app','apps','application','software','program','project','website','code','web','main','prompt','作成','開発','実装','修正','改善','相談','比較','説明','確認','検討','計画','質問','構想','管理','機能','関連','設計','保存','アプリ','ソフト','ソフトウェア','プロジェクト']);
const genericTitle=/^(?:main|prompt\s*\d*|chat\s*\d*|conversation\s*\d*|new\s+chat|untitled|会話\s*\d*|チャット\s*\d*|新しい会話|無題)$/iu;

function topicKeywords(value){
  const text=normalized(value),result=[];
  const add=word=>{if(word&&!topicStopWords.has(word)&&!result.includes(word)&&result.length<12)result.push(word);};
  for(const [word,pattern] of topicAliases)if(pattern.test(text))add(word);
  for(const match of text.matchAll(/[a-z][a-z0-9+#.-]{1,24}|[\p{Script=Han}]{2,16}|[\p{Script=Katakana}ー]{2,20}/gu)){
    const word=match[0].replace(/(?:の)?(?:開発|作成|実装|修正|改善|相談|説明|計画|質問|管理|設計)$/u,'');
    add(word);
  }
  return result;
}

function shortTopic(value){
  const clean=string(value).trim().replace(/^(?:(?:最近|今|現在)(?:は)?[、,]?\s*)?(?:(?:私は|僕は|ぼくは|わたしは)\s*)?/u,'')
    .replace(/^(?:まず(?:は)?|次に|それでは|では)[、,\s]+/u,'')
    .replace(/^[\s、,：:]+|[\s、,。！？!?：:]+$/gu,'').replace(/\s+/gu,' ');
  // A remaining subject such as 「私の友人は」 or 「友人の太郎は」
  // belongs to someone else; it is not part of this resident's topic.
  if(!clean||/[\p{Script=Han}\p{Script=Katakana}ー][はが]/u.test(clean))return null;
  const characters=Array.from(clean);
  return characters.length>32?characters.slice(0,31).join('')+'…':clean;
}

function interestQuestion(sentence){
  return /[?？]\s*$/u.test(sentence)||/(?:あります|ありません|ある|ない|なくなりました)(?:か|でしょうか)[。！]?$/u.test(sentence);
}

function declarationTopic(sentence){
  if(interestQuestion(sentence))return null;
  const japanese=sentence.match(/^(.{1,120}?)に(?:興味|関心)(?:が|を)(?:あります|ある|持っています|持っている)(?:[。！]|$)/u);
  if(japanese)return shortTopic(japanese[1]);
  const english=sentence.match(/^(?:i\s+am|i'm|we\s+are|we're)\s+(?:interested\s+in|curious\s+about)\s+(.{1,160}?)(?:[.!]|$)/iu);
  return english?shortTopic(english[1].replace(/^(?:building|developing|learning|studying)\s+/iu,'')):null;
}

function withdrawnTopic(sentence){
  if(interestQuestion(sentence))return null;
  const japanese=sentence.match(/^(.{1,120}?)に(?:は)?(?:もう)?(?:興味|関心)(?:が|は|を)?(?:ありません|ない|なくなりました|なくなった|持っていません|持たなくなりました)(?:[。！]|$)/u);
  if(japanese)return shortTopic(japanese[1]);
  const english=sentence.match(/^(?:i\s+am|i'm|we\s+are|we're)\s+(?:not|no\s+longer)\s+(?:interested\s+in|curious\s+about)\s+(.{1,160}?)(?:[.!]|$)/iu);
  return english?shortTopic(english[1].replace(/\s+(?:anymore|any longer)$/iu,'')):null;
}

function sameInterest(left,right){
  if(normalized(left)===normalized(right))return true;
  const rightWords=new Set(topicKeywords(right));
  return topicKeywords(left).some(word=>rightWords.has(word));
}

function requestTopic(sentence){
  const japanese=sentence.match(/^(.{1,120}?)(?:について(?:知りたい|相談|調べ|学びたい|教えて|教え|考え|話し)|を(?:作りたい|作って|開発したい|開発して|実装したい|実装して|改善したい|改善して|修正したい|修正して|学びたい|勉強したい|調べたい|調べて|比較したい|比較して|検討したい|検討して))/u);
  if(japanese)return shortTopic(japanese[1]);
  const english=sentence.match(/^(?:(?:i|we)\s+(?:want|need|would\s+like)\s+to\s+|please\s+)?(?:build|create|develop|implement|learn|study|research)\s+(.{1,160}?)(?:[.!?]|$)/iu);
  return english?shortTopic(english[1].replace(/^(?:an?|the)\s+/iu,'')):null;
}

function conversationInterest(title,messages){
  let declaration=null,request=null;
  let withdrawals=[];
  for(const message of messages){
    if(message.role!=='user')continue;
    for(const sentence of narrative(message.text,{quotes:true}).split(/(?<=[。！？])\s*|(?<=[.!?])\s+|\n+/u)){
      const text=sentence.trim();
      const withdrawn=withdrawnTopic(text);
      if(withdrawn){
        if(!withdrawals.some(topic=>sameInterest(topic,withdrawn)))withdrawals.push(withdrawn);
        if(declaration&&sameInterest(declaration.interest,withdrawn))declaration=null;
        continue;
      }
      const topic=declarationTopic(text);
      if(topic){
        withdrawals=withdrawals.filter(withdrawn=>!sameInterest(topic,withdrawn));
        declaration={interest:topic,interestSource:'user',interestEvidence:bounded(text,180)};
      }
      if(!request){const topic=requestTopic(text);if(topic)request={interest:topic,interestSource:'user',interestEvidence:bounded(text,180)};}
    }
  }
  const meaningfulTitle=title&&!genericTitle.test(title)?shortTopic(title):null;
  const withdrawn=topic=>withdrawals.some(value=>sameInterest(topic,value));
  const selected=declaration||(request&&!withdrawn(request.interest)?request:null)||(meaningfulTitle&&!withdrawn(meaningfulTitle)?{interest:meaningfulTitle,interestSource:'title',interestEvidence:bounded(title,180)}:{interest:ui('この会話の続き', "Continue this conversation"),interestSource:'fallback',interestEvidence:''});
  return {...selected,interestKeywords:selected.interestSource==='fallback'?[]:topicKeywords(selected.interest),
    projectKeywords:topicKeywords([meaningfulTitle||'',request?.interest||''].join(' '))};
}

const softwareDomain=/(?:ソフト(?:ウェア)?|アプリ(?:ケーション)?|ウェブ(?:サイト|アプリ)|webサイト|プログラム|コード|実装|リポジトリ|フロントエンド|バックエンド|データベース|サーバー|\b(?:app|application|software|website|web\s+app|program|code|coding|repository|frontend|backend|database|server|api|cli|gui|electron|react|vue|python|javascript|typescript|rust)\b)/iu;
const making=/(?:作[る成りっ]|開発|実装|修正|改善|改修|追加|構築|コーディング|リファクタ|バグ|エラーを直|\b(?:build|building|built|develop(?:ing|ed|ment)?|implement(?:ing|ed|ation)?|creat(?:e|ing|ed)|fix(?:ing|ed)?|refactor(?:ing|ed)?|debug(?:ging|ged)?|add(?:ing|ed)?)\b)/iu;
const codingFence=/```(?:javascript|typescript|jsx|tsx|js|ts|python|py|rust|rs|go|java|csharp|cs|cpp|c\+\+|c|swift|kotlin|php|ruby|rb|html|css|sql)\b[^\n]*\n\s*\S/iu;
const codeShape=/(?:\b(?:function|class|def|fn)\s+[\w$]+|\b(?:const|let|var)\s+[\w$]+\s*=|<[A-Za-z][^>]*>)/u;
const sourcePath=/(?:^|[\s`/])[A-Za-z0-9_.-]+\.(?:m?[jt]sx?|py|rs|go|java|vue|svelte|css|html|cpp|swift|rb|php)\b/u;
const educational=/(?:とは何|どのような知識|仕組みを|意味を|使い方|説明して|説明してください|教えて|学びたい|勉強|紹介して|紹介してください|おすすめ|\b(?:explain|recommend|tutorial|learning|learn about|what is|what are|how does|what knowledge)\b)/iu;
const directRequest=/(?:作って|作りたい|開発して|実装して|修正して|改善して|構築して|追加して|\b(?:build|create|develop|implement|fix|refactor)\b)/iu;
const thirdParty=/(?:会社が|他社|他人|製品紹介|\b(?:third.party|developed by|made by|created by|built by)\b)/iu;
const recommendationList=/(?:おすすめ.{0,20}アプリ|アプリ.{0,16}(?:おすすめ|比較表|一覧)|\blist of apps\b|\bapp recommendations\b)/iu;

function makingSoftware(value){
  if(!softwareDomain.test(value)||!making.test(value)||thirdParty.test(value))return false;
  if(/(?:とは何|どのような知識|\bwhat (?:is|are|knowledge)\b|\bhow does\b)/iu.test(value))return false;
  if(educational.test(value)&&!directRequest.test(value))return false;
  if(recommendationList.test(value)&&!/(?:実装|修正|開発|\b(?:implement|fix|develop)\b)/iu.test(value))return false;
  return true;
}

function developmentEvidence(title,messages){
  const users=messages.filter(message=>message.role==='user');
  for(const text of [title,...users.map(message=>narrative(message.text))]){
    for(const sentence of text.split(/(?<=[.!?])\s+|[\n。！？!?]+/u)){
      if(makingSoftware(sentence))return bounded(sentence,180);
    }
  }
  // An explanation or a recommendation about someone else's software is not
  // a new project, even when the answer contains example code or its history.
  if(users.some(message=>educational.test(message.text)))return null;
  for(const message of messages){
    if(message.role==='assistant'&&codingFence.test(message.text)&&codeShape.test(message.text))return ui('会話にソフトウェアのソースコードが含まれています。', "The conversation includes software source code.");
    const plain=narrative(message.text);
    if(thirdParty.test(plain))continue;
    if(message.role==='assistant'&&makingSoftware(plain))return bounded(plain,180);
    if(sourcePath.test(message.text)&&making.test(plain))return bounded(plain,180)||ui('ソースファイルの変更についての会話です。', "The conversation discusses source file changes.");
    if(softwareDomain.test(plain)&&progressEvent(plain)?.stage==='complete')return bounded(plain,180);
  }
  return null;
}

function futureOrQuestion(value){
  const text=value.replace(/\bcan confirm\b/gu,'confirm');
  return /[?？]\s*$/u.test(text)||/^(?:has|have|did|is|are|was|were)\b|(?:ました|した|済み)(?:か|でしょうか)[。！]?$/u.test(text)||/^(?:example|例)[：:]|例えば/u.test(text)||/(?:したい|してほしい|してください|しましょう|する予定|予定です|計画です|するつもり|する必要|したら|すれば|するなら|できたら|仮に|と言って|と書いて|と表示|\b(?:will|would|should|could|can|may|might|please|let'?s|todo|plan(?:ned)?\s+to|need\s+to|want\s+to|hope\s+to|ready\s+to|if|unless)\b|\b(?:check|ensure|verify|confirm)\s+(?:that|whether)\b)/u.test(text);
}

function negated(value){
  const text=value.replace(/\b(?:no errors?|zero failures?|0 failed)\b|失敗\s*0\s*件|エラーなし/gu,'');
  return /(?:未(?:完成|完了|実装|公開|実行|実施|検証|着手)|(?:して|できて|されて|され)いません|できません|まだ.{0,24}(?:ない|です)|(?:完成|完了|公開|リリース|デプロイ|成功|通過).{0,12}(?:していない|していません|ではない|してません)|\bno\s+(?:code|implementation|tests?)\b|\b(?:not|never|haven't|hasn't|didn't|isn't|wasn't|cannot|can't|failed|failing|failure|incomplete|pending)\b)/u.test(text);
}

function progressEvent(value){
  const text=normalized(value).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s*)/u,'').trim();
  if(!text||futureOrQuestion(text))return null;
  if(/(?:ロールバック(?:しました|した|済み)|公開を取り消しました|リリースを取り消しました|\brolled back\b|\breverted (?:the )?(?:release|deployment)\b)/u.test(text))return {kind:'rollback',stage:'building',text:bounded(value,180)};
  const negative=negated(text);
  if(negative){
    if(/(?:テスト|検証|\btests?\b).{0,40}(?:失敗|通ら|不合格|\bfail(?:ed|ing|ure)?\b|did not pass)/u.test(text))return {kind:'blocked',stage:'testing',text:bounded(value,180)};
    if(/(?:未実装|未完成|実装.{0,20}していません|\b(?:not|isn't)\s+(?:yet\s+)?(?:implemented|complete|finished)\b|\bno code\b.{0,30}\bimplemented\b|implementation.{0,20}incomplete)/u.test(text))return {kind:'remaining',stage:'building',text:bounded(value,180)};
    if(/(?:未公開|未リリース|未デプロイ|(?:公開|リリース|デプロイ).{0,20}(?:まだ|していません|していない)|\b(?:not|haven't|hasn't)\b.{0,30}\b(?:released|deployed|launched)\b)/u.test(text))return {kind:'unreleased',text:bounded(value,180)};
    return null;
  }
  const documentation=/(?:readme|ドキュメント|資料|記事|\b(?:documentation|document|blog|article)\b)/u.test(text)&&!/(?:アプリ|ソフト|本番|\b(?:app|software|production|product)\b)/u.test(text);
  const release=/(?:リリース|デプロイ|公開)(?:を|が)?(?:完了(?:しました|した|済み)|しました|した|済み|できました|しています)|\b(?:released|launched|shipped)\b.{0,60}(?:\bv?\d+\.\d+|\b(?:version|users?|app|software|website|product|production)\b)|\bdeployed\b.{0,50}\b(?:production|live)\b/u.test(text);
  const complete=/(?:ソフト(?:ウェア)?|アプリ(?:ケーション)?|プロジェクト|製品|サイト|ツール).{0,20}(?:完成(?:しました|した|です|済み)|完了(?:しました|した|です|済み))|\b(?:app(?:lication)?|software|website|project|product)\s+(?:is|was|has been)\s+(?:complete(?:d)?|finished)\b/u.test(text);
  const staging=/(?:ステージング|検証環境|\bstaging\b)/u.test(text)&&!/(?:本番|\bproduction\b)/u.test(text);
  if((release||complete)&&!documentation&&!staging)return {kind:'release',stage:'complete',text:bounded(value,180)};
  if(staging&&/(?:デプロイ|\bdeployed\b)/u.test(text))return {kind:'validation',stage:'testing',text:bounded(value,180)};
  if(/(?:テスト|検証|動作確認|ビルド).{0,45}(?:成功|通過|完了|実行しました|実行した|実施しました|実施した|済み|中です|中|しています)|\b(?:tests?|testing|build|verification|validation)\b.{0,60}\b(?:passed|succeeded|successful|complete(?:d)?|running)\b|\b(?:passed|ran|running)\b.{0,25}\b(?:tests?|test suite)\b/u.test(text))return {kind:'validation',stage:'testing',text:bounded(value,180)};
  if(/(?:実装|修正|追加|構築|開発|コードを作成|プログラムを作成)(?:を|が|は)?(?:完了(?:しました|した|済み)|しました|した|済み|中です|中|を進めています)|\b(?:implemented|created|built|fixed|refactored|added|wrote)\b|\b(?:implementing|developing|coding)\b/u.test(text))return {kind:'implementation',stage:'building',text:bounded(value,180)};
  return null;
}

function estimatedProgress(messages){
  let stage='planned',implemented=false;
  const evidence=[];
  for(const message of messages){
    // An actual code artifact is implementation evidence, never proof of release.
    if(message.role==='assistant'&&codingFence.test(message.text)&&codeShape.test(message.text)){
      stage='building';implemented=true;evidence.push({kind:'implementation',text:ui('会話にソースコードが作成されています。', "Source code was written in this conversation.")});
    }
    const sentences=narrative(message.text,{quotes:true}).split(/(?<=[。！？])\s*|(?<=[.!?])\s+|[\n;；]+|\s+(?:but|however)\s+|(?:ただし|しかし)[、,]?/u);
    for(const sentence of sentences){
      const event=progressEvent(sentence);if(!event)continue;
      if(event.kind==='remaining')stage=implemented?'building':'planned';
      else if(event.kind==='unreleased'){if(stage==='complete')stage='testing';}
      else {stage=event.stage;implemented=true;}
      evidence.push({kind:event.kind,text:event.text});
    }
  }
  const unique=[];
  for(const item of evidence.reverse())if(!unique.some(other=>other.kind===item.kind&&other.text===item.text))unique.push(item);
  return {stage,evidence:unique.slice(0,3).reverse()};
}

function validOverrides(values){
  const result=new Map();
  for(const value of Array.isArray(values)?values:[]){
    if(!value||typeof value.conversationId!=='string'||!['auto','software','resident'].includes(value.kind)||!(value.stage==='auto'||stageIds.has(value.stage)))continue;
    result.set(value.conversationId,value);
  }
  return result;
}

/** Pure projection: no network requests, storage writes, or conversation edits. */
export function projectVillage(chats,overrides=[]){
  const residents=[],projects=[],seen=new Set(),settings=validOverrides(overrides);
  const stats={population:0,projects:0,working:0,stages:Object.fromEntries(VILLAGE_STAGES.map(stage=>[stage.id,0]))};
  for(const chat of Array.isArray(chats)?chats:[]){
    if(!chat||typeof chat.id!=='string'||!chat.id||chat.id.length>512||seen.has(chat.id))continue;
    const override=settings.get(chat.id),manualStage=stageIds.has(override?.stage)?override.stage:null;
    const messages=(Array.isArray(chat.messages)?chat.messages:[]).filter(message=>['user','assistant'].includes(message?.role));
    if(!messages.length&&override?.kind!=='software'&&!manualStage)continue;
    seen.add(chat.id);
    const title=bounded(mapTranscriptText(chat.title),120)||ui('会話', "Conversation"),name=bounded(mapTranscriptText(chat.characterName),80)||title;
    const status=string(chat.status)||'idle',activity=activities.has(status)?'working':status==='failed'?'attention':'resting';
    const times=[timestamp(chat.updatedAt),...messages.map(message=>timestamp(message.createdAt))].filter(value=>value!==null);
    const seed=hash(chat.id),resident={id:chat.id,conversationId:chat.id,name,title,status,activity,seed,appearance:appearances[seed%appearances.length],messageCount:messages.length,updatedAt:times.reduce((latest,time)=>latest===null||time>latest?time:latest,null),projectId:null,delegation:villageDelegation(chat)};
    const inspected=inspectedMessages(messages),development=developmentEvidence(title,inspected);
    const {projectKeywords,...interest}=conversationInterest(title,inspected);Object.assign(resident,interest);
    if(override?.kind!=='resident'&&(override?.kind==='software'||manualStage||development)){
      const estimated=estimatedProgress(inspected),stage=manualStage||estimated.stage;
      const stageLabel=VILLAGE_STAGES.find(value=>value.id===stage).label;
      const evidence=manualStage?[{kind:'manual',text:ui('建物の進み具合を手動で設定しています。', "Building progress was set manually.")}]:estimated.evidence.length?estimated.evidence:[{kind:'planning',text:development||ui('進み具合を示す記述がないため、構想として表示しています。', "Shown as planned until the conversation records progress.")}];
      resident.projectId='project:'+chat.id;
      projects.push({id:resident.projectId,conversationId:chat.id,title,stage,stageLabel,source:manualStage?'manual':'estimated',evidence,seed,activity,topicKeywords:projectKeywords});
      stats.stages[stage]++;
    }
    residents.push(resident);if(activity==='working')stats.working++;
  }
  stats.population=residents.length;stats.projects=projects.length;
  return {residents,projects,stats};
}
