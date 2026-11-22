// Fictional, in-memory conversations for the explicitly labelled village demo.
// They never enter the server's conversation store or a real model session.
export function villageDemoChats(){
 const projects=['家計簿Webアプリ','写真整理ツール','読書記録アプリ','在庫管理API','音楽プレーヤー','学習メモアプリ','天気ダッシュボード','日程調整アプリ','レシピ検索サイト','小さなゲーム','文章校正ツール','資料検索アプリ','地図共有サービス','予約管理API','旅行プランアプリ','習慣記録ツール'];
 const stages=[
  '要件と画面案を整理しました。実装はまだ始めていません。',
  '主要画面とAPIを実装しました。コードを保存しました。テストと公開はまだです。',
  '主要機能を実装し、24件のテストが成功しました。リリースはまだです。',
  '機能の実装と検証が完了しました。バージョン1.0を公開しました。'
 ];
 const topics=[
  ['週末の散歩','川沿いを歩いて、昼前に駅へ戻りたい。どこで折り返そう？','橋を折り返し地点にしましょう。帰りは駅前のパン屋に寄る時間が取れます。'],
  ['今夜の献立','冷蔵庫に卵と小松菜があるよ。二人分の夕飯を作れる？','小松菜を炒めて卵でとじ、温かいご飯にのせましょう。残った葉はみそ汁に使えます。'],
  ['読書の感想','主人公が最後に手紙を渡さなかった理由を読書会で話したい。','手紙を書き始めた場面と、渡す直前のためらいを並べて読みましょう。気持ちが変わった一文を持ち寄れます。'],
  ['部屋の片付け','机の上に紙が積もって、書く場所がない。最初に何をする？','今日使う紙を一枚だけ机に残しましょう。返事が要る紙は、一つのトレーにまとめておくと見つかります。'],
  ['旅行の持ち物','一泊の列車旅で、すぐ使う物を鞄の底に入れたくない。','乗車券、充電器、薄い上着は外ポケットへ。着替えはひと袋にまとめて底に入れましょう。'],
  ['花壇の手入れ','朝の水やりは、花壇のどこを見て決めたらいい？','まず株元の土に触れてみて。乾いた場所から根元にゆっくり水を注ぐと、端の苗も見落としません。'],
  ['朝の習慣','出かける前にいつも鍵を探してしまう。明日はどうする？','今夜のうちに玄関の小皿に鍵と定期を置きましょう。明日は靴を履く前にその皿を確かめます。'],
  ['映画のおすすめ','古い無声映画を友達と観るなら、何から始めよう？','短編の『キートンの探偵学入門』はどうでしょう。上映後に、一番笑った身ぶりを一つずつ挙げてみて。'],
  ['楽器の練習','曲の三小節目で指がもつれる。通して弾く前に何を試そう？','三小節目の前後だけをゆっくり弾きましょう。指が滑らかにつながったら、前の小節を一つ足します。'],
  ['友人への贈り物','本好きの友達に、小さくて郵送しやすい物を贈りたい。','薄いしおりにしましょう。一緒に読んだ本の思い出を一行添えると、その人だけの贈り物になります。'],
  ['山歩きの準備','朝から尾根を歩く予定だよ。雨具と水はどこにしまおう？','雨具は取り出しやすい上部へ、水は横ポケットへ。分岐では立ち止まり、地図で帰りの道も確かめましょう。'],
  ['休日の過ごし方','午後の二時間を、家の近くでのんびり過ごしたい。','図書館で気になった一冊を借りて、公園のベンチへ。帰る前に好きな一節を書き留めておきましょう。']
 ];
 return Array.from({length:168},(_,index)=>{
  const software=index<projects.length,topic=software?null:topics[(index-projects.length)%topics.length];
  const originalTitle=software?projects[index]:topic[0]+' · '+(Math.floor((index-projects.length)/topics.length)+1),id='village-demo-'+(index+1),assignment=sampleAssignments.get(id),title=assignment?.title||originalTitle;
  const messages=assignment?[
   {id:id+'-assignment-request',role:'user',text:assignment.request},
   {id:id+'-assignment',role:'assistant',text:assignment.text}
  ]:[
   {id:id+'-user',role:'user',text:software?title+'というソフトウェアを開発したい。設計から一緒に進めてください。':topic[1]},
   {id:id+'-answer',role:'assistant',text:software?'【村のサンプル会話】\n'+stages[index%stages.length]:topic[2]}
  ];
  return {id,title,status:'completed',model:'CODEX · DEMO MODEL',createdAt:Date.UTC(2026,9,1)+index*3600000,updatedAt:Date.UTC(2026,9,2)+index*3600000,messages};
 });
}

const sampleSources={
 'village-sample-work':'village-demo-2',
 'village-sample-wait':'village-demo-9',
 'village-sample-pause':'village-demo-6',
 'village-sample-return':'village-demo-4'
};
export function villageDemoQuestSource(todoId){return sampleSources[todoId]||null;}

// These records exist only in the labelled map preview. Its quest flags link
// back to the corresponding fictional conversation, never to a server TODO.
const formation=(name,ids)=>({name,leaderId:ids.at(-1),members:ids.map((conversationId,index)=>({conversationId,role:['調査','執筆','レビュー','リーダー'][index%4]}))});
const hero=formation('旅の仲間',['demo1','demo2','demo3','demo4']);
const building=formation('写真工房の隊',['village-demo-2','village-demo-18','village-demo-30','village-demo-42']);
const paused=formation('学習図書館の隊',['village-demo-54','village-demo-66','village-demo-78','village-demo-6']);
const returned=formation('在庫管理の隊',['village-demo-90','village-demo-102','village-demo-114','village-demo-4']);
const sampleTime=Date.UTC(2026,9,31,9);
const sampleSteps=(party,statuses,outputs=[],roles=[])=>party.members.map((member,index)=>({...member,role:roles[index]||member.role,status:statuses[index],output:outputs[index]||'',error:statuses[index]==='interrupted'?'画面確認の途中で中断しています。':null}));
const photoSteps=sampleSteps(building,['completed','running','pending','pending'],['【サンプル成果】撮影日・タグ・重複写真で整理する設計をまとめました。'],['整理方法の調査','写真一覧の画面実装','画像表示のレビュー','リーダー・最終まとめ']);
const studySteps=sampleSteps(paused,['completed','completed','interrupted','pending'],['【サンプル成果】学習メモの検索条件を確認しました。','【サンプル成果】メモ一覧とタグ入力の画面案を作りました。'],['学習メモの調査','画面案の作成','スマホ表示の確認','リーダー・最終まとめ']);
const stockSummary='【サンプル成果】在庫管理APIの入出庫・検索・権限チェックを確認し、公開手順をまとめました。';
const stockSteps=sampleSteps(returned,['completed','completed','completed','completed'],['【サンプル成果】在庫管理APIの仕様を確認しました。','【サンプル成果】入出庫と検索APIを実装しました。','【サンプル成果】権限と在庫数のテストを確認しました。',stockSummary],['API仕様の調査','在庫APIの実装','権限と在庫数の検証','リーダー・最終まとめ']);
const sampleTodo=(id,title,status,party,runStatus,{description,criteria,artifact,location,steps=[]}={})=>({id,title,description:'【村のサンプル依頼】'+description,criteria,source:{artifact,location},priority:'normal',due:'',mediaIds:[],status,assignee:{type:'party'},createdAt:sampleTime,updatedAt:sampleTime,runs:party?[{id:id+'-run',questId:id+'-quest',status:runStatus,party,steps,createdAt:sampleTime,updatedAt:sampleTime,...(runStatus==='paused'?{error:'スマホ表示の確認で中断しました。次は画面の崩れを確認します。'}:{}),...(runStatus==='completed'?{completedAt:sampleTime,output:stockSummary}:{})}]:[]});
const sampleItems=[
 sampleTodo('village-sample-work','写真整理ツールを実装する','doing',building,'running',{description:'撮影日とタグで写真を探せる一覧画面を作っています。',criteria:'写真の一覧・絞り込み・重複の確認ができること。',artifact:'写真一覧とタグ検索の画面',location:'workshop',steps:photoSteps}),
 sampleTodo('village-sample-wait','レシピ検索サイトを設計する','todo',null,null,{description:'冷蔵庫の食材からレシピを探せる検索画面を設計します。',criteria:'食材・調理時間・人数で検索できる画面案を作ること。',artifact:'レシピ検索画面の設計案',location:'library'}),
 sampleTodo('village-sample-pause','学習メモアプリの画面を確認する','doing',paused,'paused',{description:'学習メモの一覧とタグ入力が、スマホでも使えるか確認しています。',criteria:'小さい画面でも入力欄や保存ボタンが隠れないこと。',artifact:'スマホ画面の確認結果',location:'library',steps:studySteps}),
 sampleTodo('village-sample-return','在庫管理APIを公開する','done',returned,'completed',{description:'在庫管理APIの入出庫と検索を検証し、公開手順を整理しました。',criteria:'入出庫・権限・在庫数の検証結果をまとめること。',artifact:'在庫APIの検証結果と公開手順',location:'castle',steps:stockSteps})
];
// Each supporting member reports their part of one shared project.
const assignmentTitles={18:'写真一覧の画面担当',30:'写真の表示レビュー',42:'写真工房のまとめ',54:'学習メモの調査',66:'学習メモの画面案',78:'学習メモのスマホ確認',90:'在庫の仕様調査',102:'在庫の入出庫確認',114:'在庫の権限チェック'};
const assignmentStates={pending:'担当の順番待ち',running:'作業中',completed:'担当分を完了',interrupted:'中断中'};
const sampleAssignments=new Map(sampleItems.flatMap(task=>task.runs.flatMap(run=>run.steps.filter(step=>assignmentTitles[step.conversationId.replace('village-demo-','')]).map(step=>[step.conversationId,{
 title:assignmentTitles[step.conversationId.replace('village-demo-','')],
 request:'「'+task.title+'」で担当している「'+step.role+'」について、進み具合を教えてください。',
 text:(step.output?.replace(/^【サンプル成果】/u,'')||step.error||('現在は'+assignmentStates[step.status]+'です。'))+'\n\n'+[
  '依頼：'+task.title,'役割：'+step.role,'状態：'+assignmentStates[step.status]+'（サンプル）','作業内容：'+task.description,
 ].map(line=>'> '+line).join('\n')
}]))));
const sampleQuest={id:'village-sample-work-quest',text:'写真整理ツールを実装する',status:'running',party:building,createdAt:sampleTime,updatedAt:sampleTime,link:{todoId:'village-sample-work',runId:'village-sample-work-run'},steps:photoSteps};
export function villageDemoActivityState(state){
 // Opening the tavern initializes an empty demo runner. Keep the map's sample
 // formation until the user saves members or starts an actual demo quest.
 const savedParty=state.party?.party;
 return {...state,party:state.party?.quest?state.party:{...(state.party||{}),party:savedParty?.members?.length?savedParty:hero,quest:sampleQuest},todos:{...(state.todos||{}),items:[...(state.todos?.items||[]),...sampleItems.filter(sample=>!(state.todos?.items||[]).some(task=>task.id===sample.id))]}};
}
