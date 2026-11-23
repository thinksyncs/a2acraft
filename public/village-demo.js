import {ui} from './interface-language.js';
// Fictional, in-memory conversations for the explicitly labelled village demo.
// They never enter the server's conversation store or a real model session.
export function villageDemoChats(){
 const projects=[ui('家計簿Webアプリ', "Budget web app"),ui('写真整理ツール', "Photo organizer"),ui('読書記録アプリ', "Reading journal"),ui('在庫管理API', "Inventory API"),ui('音楽プレーヤー', "Music player"),ui('学習メモアプリ', "Study notes"),ui('天気ダッシュボード', "Weather dashboard"),ui('日程調整アプリ', "Scheduling app"),ui('レシピ検索サイト', "Recipe search"),ui('小さなゲーム', "Pocket game"),ui('文章校正ツール', "Writing editor"),ui('資料検索アプリ', "Document search"),ui('地図共有サービス', "Shared maps"),ui('予約管理API', "Booking API"),ui('旅行プランアプリ', "Travel planner"),ui('習慣記録ツール', "Habit tracker")];
 const stages=[
  ui('要件と画面案を整理しました。実装はまだ始めていません。', "We outlined the requirements and screens. Implementation has not started."),
  ui('主要画面とAPIを実装しました。コードを保存しました。テストと公開はまだです。', "We implemented the main screens and API. The code is saved. Testing and release are still ahead."),
  ui('主要機能を実装し、24件のテストが成功しました。リリースはまだです。', "We implemented the main features. All 24 tests passed. The release is still ahead."),
  ui('機能の実装と検証が完了しました。バージョン1.0を公開しました。', "We verified the implementation and released version 1.0.")
 ];
 const topics=[
  [ui('週末の散歩', "A weekend walk"),ui('川沿いを歩いて、昼前に駅へ戻りたい。どこで折り返そう？', "I'd like to walk by the river and reach the station before noon. Where should I turn back?"),ui('橋を折り返し地点にしましょう。帰りは駅前のパン屋に寄る時間が取れます。', "Turn back at the bridge. That leaves time to stop at the bakery near the station.")],
  [ui('今夜の献立', "Dinner tonight"),ui('冷蔵庫に卵と小松菜があるよ。二人分の夕飯を作れる？', "I have eggs and leafy greens in the fridge. What can I make for two?"),ui('小松菜を炒めて卵でとじ、温かいご飯にのせましょう。残った葉はみそ汁に使えます。', "Sauté the greens, fold in the eggs, and serve over hot rice. Use the leftover leaves in miso soup.")],
  [ui('読書の感想', "Book club"),ui('主人公が最後に手紙を渡さなかった理由を読書会で話したい。', "I'd like to discuss why the main character never gave up the letter."),ui('手紙を書き始めた場面と、渡す直前のためらいを並べて読みましょう。気持ちが変わった一文を持ち寄れます。', "Read the moment they began writing alongside their hesitation to hand it over. Bring a line that shows what changed.")],
  [ui('部屋の片付け', "Clearing my desk"),ui('机の上に紙が積もって、書く場所がない。最初に何をする？', "Papers have covered my desk. How do I make room to write?"),ui('今日使う紙を一枚だけ机に残しましょう。返事が要る紙は、一つのトレーにまとめておくと見つかります。', "Leave only the page you need today. Put papers waiting for a reply together in one tray.")],
  [ui('旅行の持ち物', "Packing for a trip"),ui('一泊の列車旅で、すぐ使う物を鞄の底に入れたくない。', "I'm taking an overnight train. How can I keep essentials within reach?"),ui('乗車券、充電器、薄い上着は外ポケットへ。着替えはひと袋にまとめて底に入れましょう。', "Keep your ticket, charger and a light jacket in an outer pocket. Pack your clothes together at the bottom.")],
  [ui('花壇の手入れ', "Tending the garden"),ui('朝の水やりは、花壇のどこを見て決めたらいい？', "Which part of the flower bed should I check before watering?"),ui('まず株元の土に触れてみて。乾いた場所から根元にゆっくり水を注ぐと、端の苗も見落としません。', "Feel the soil at the base of the plants. Start with the dry patches and water each seedling at its roots.")],
  [ui('朝の習慣', "A morning habit"),ui('出かける前にいつも鍵を探してしまう。明日はどうする？', "I always hunt for my keys before leaving. What can I change tomorrow?"),ui('今夜のうちに玄関の小皿に鍵と定期を置きましょう。明日は靴を履く前にその皿を確かめます。', "Put your keys and travel pass in a dish by the door tonight. Check it before you put on your shoes.")],
  [ui('映画のおすすめ', "Film night"),ui('古い無声映画を友達と観るなら、何から始めよう？', "Which silent film should I watch with a friend?"),ui('短編の『キートンの探偵学入門』はどうでしょう。上映後に、一番笑った身ぶりを一つずつ挙げてみて。', "Try Buster Keaton's Sherlock Jr. Afterwards, each pick the gesture that made you laugh the most.")],
  [ui('楽器の練習', "Music practice"),ui('曲の三小節目で指がもつれる。通して弾く前に何を試そう？', "My fingers stumble in the third bar. What should I try before playing the whole piece?"),ui('三小節目の前後だけをゆっくり弾きましょう。指が滑らかにつながったら、前の小節を一つ足します。', "Slow down and play just the bars around it. Once the movement feels smooth, add the preceding bar.")],
  [ui('友人への贈り物', "A gift for a friend"),ui('本好きの友達に、小さくて郵送しやすい物を贈りたい。', "I'd like a small, easy-to-mail gift for a friend who loves books."),ui('薄いしおりにしましょう。一緒に読んだ本の思い出を一行添えると、その人だけの贈り物になります。', "Choose a slim bookmark. Add one line about a book you read together.")],
  [ui('山歩きの準備', "Preparing for a hike"),ui('朝から尾根を歩く予定だよ。雨具と水はどこにしまおう？', "I'm walking the ridge this morning. Where should I pack my water and rain gear?"),ui('雨具は取り出しやすい上部へ、水は横ポケットへ。分岐では立ち止まり、地図で帰りの道も確かめましょう。', "Keep rain gear at the top and water in a side pocket. Pause at each fork to check the way back.")],
  [ui('休日の過ごし方', "A quiet afternoon"),ui('午後の二時間を、家の近くでのんびり過ごしたい。', "I've got two hours to spend close to home. How can I unwind?"),ui('図書館で気になった一冊を借りて、公園のベンチへ。帰る前に好きな一節を書き留めておきましょう。', "Borrow a book from the library and settle on a park bench. Write down a favorite passage before you head home.")]
 ];
 return Array.from({length:168},(_,index)=>{
  const software=index<projects.length,topic=software?null:topics[(index-projects.length)%topics.length];
  const originalTitle=software?projects[index]:topic[0]+' · '+(Math.floor((index-projects.length)/topics.length)+1),id='village-demo-'+(index+1),assignment=sampleAssignments.get(id),title=assignment?.title||originalTitle;
  const messages=assignment?[
   {id:id+'-assignment-request',role:'user',text:assignment.request},
   {id:id+'-assignment',role:'assistant',text:assignment.text}
  ]:[
   {id:id+'-user',role:'user',text:software?title+ui('というソフトウェアを開発したい。設計から一緒に進めてください。', " is the software I want to build. Please help me design and develop the app."):topic[1]},
   {id:id+'-answer',role:'assistant',text:software?ui('【村のサンプル会話】\n', "[Village sample conversation]\n")+stages[index%stages.length]:topic[2]}
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
const formation=(name,ids)=>({name,leaderId:ids.at(-1),members:ids.map((conversationId,index)=>({conversationId,role:[ui('調査', "Research"),ui('執筆', "Writing"),ui('レビュー', "Review"),ui('リーダー', "Leader")][index%4]}))});
const hero=formation(ui('旅の仲間', "Traveling companions"),['demo1','demo2','demo3','demo4']);
const building=formation(ui('写真工房の隊', "Photo workshop party"),['village-demo-2','village-demo-18','village-demo-30','village-demo-42']);
const paused=formation(ui('学習図書館の隊', "Study library party"),['village-demo-54','village-demo-66','village-demo-78','village-demo-6']);
const returned=formation(ui('在庫管理の隊', "Inventory party"),['village-demo-90','village-demo-102','village-demo-114','village-demo-4']);
const sampleTime=Date.UTC(2026,9,31,9);
const sampleSteps=(party,statuses,outputs=[],roles=[])=>party.members.map((member,index)=>({...member,role:roles[index]||member.role,status:statuses[index],output:outputs[index]||'',error:statuses[index]==='interrupted'?ui('画面確認の途中で中断しています。', "The screen review was interrupted."):null}));
const photoSteps=sampleSteps(building,['completed','running','pending','pending'],[ui('【サンプル成果】撮影日・タグ・重複写真で整理する設計をまとめました。', "[Sample result] Planned how to organize photos by date and tag and identify duplicates.")],[ui('整理方法の調査', "Researching photo organization"),ui('写真一覧の画面実装', "Building the gallery"),ui('画像表示のレビュー', "Reviewing image display"),ui('リーダー・最終まとめ', "Lead and summarize")]);
const studySteps=sampleSteps(paused,['completed','completed','interrupted','pending'],[ui('【サンプル成果】学習メモの検索条件を確認しました。', "[Sample result] Checked the search filters for study notes."),ui('【サンプル成果】メモ一覧とタグ入力の画面案を作りました。', "[Sample result] Designed the note list and tag input screens.")],[ui('学習メモの調査', "Researching study notes"),ui('画面案の作成', "Designing the screens"),ui('スマホ表示の確認', "Checking mobile layouts"),ui('リーダー・最終まとめ', "Lead and summarize")]);
const stockSummary=ui('【サンプル成果】在庫管理APIの入出庫・検索・権限チェックを確認し、公開手順をまとめました。', "[Sample result] Verified inventory movements, search and permissions and documented the release steps.");
const stockSteps=sampleSteps(returned,['completed','completed','completed','completed'],[ui('【サンプル成果】在庫管理APIの仕様を確認しました。', "[Sample result] Reviewed the inventory API specification."),ui('【サンプル成果】入出庫と検索APIを実装しました。', "[Sample result] Implemented stock movements and search."),ui('【サンプル成果】権限と在庫数のテストを確認しました。', "[Sample result] Checked permissions and stock count tests."),stockSummary],[ui('API仕様の調査', "Reviewing the API specification"),ui('在庫APIの実装', "Implementing the inventory API"),ui('権限と在庫数の検証', "Testing permissions and stock counts"),ui('リーダー・最終まとめ', "Lead and summarize")]);
const sampleTodo=(id,title,status,party,runStatus,{description,criteria,artifact,location,steps=[]}={})=>({id,title,description:ui('【村のサンプル依頼】', "[Sample quest] ")+description,criteria,source:{artifact,location},priority:'normal',due:'',mediaIds:[],status,assignee:{type:'party'},createdAt:sampleTime,updatedAt:sampleTime,runs:party?[{id:id+'-run',questId:id+'-quest',status:runStatus,party,steps,createdAt:sampleTime,updatedAt:sampleTime,...(runStatus==='paused'?{error:ui('スマホ表示の確認で中断しました。次は画面の崩れを確認します。', "Paused during the mobile review. Check the layout next.")}:{}),...(runStatus==='completed'?{completedAt:sampleTime,output:stockSummary}:{})}]:[]});
const sampleItems=[
 sampleTodo('village-sample-work',ui('写真整理ツールを実装する', "Build the photo organizer"),'doing',building,'running',{description:ui('撮影日とタグで写真を探せる一覧画面を作っています。', "Build a photo gallery searchable by date and tag."),criteria:ui('写真の一覧・絞り込み・重複の確認ができること。', "Browse and filter photos and check for duplicates."),artifact:ui('写真一覧とタグ検索の画面', "Photo gallery and tag search"),location:'workshop',steps:photoSteps}),
 sampleTodo('village-sample-wait',ui('レシピ検索サイトを設計する', "Design a recipe search site"),'todo',null,null,{description:ui('冷蔵庫の食材からレシピを探せる検索画面を設計します。', "Design a search screen that finds recipes using ingredients in the fridge."),criteria:ui('食材・調理時間・人数で検索できる画面案を作ること。', "Create a screen that filters by ingredients, cooking time and servings."),artifact:ui('レシピ検索画面の設計案', "Recipe search screen design"),location:'library'}),
 sampleTodo('village-sample-pause',ui('学習メモアプリの画面を確認する', "Review the study notes app"),'doing',paused,'paused',{description:ui('学習メモの一覧とタグ入力が、スマホでも使えるか確認しています。', "Check that the note list and tag inputs work on mobile."),criteria:ui('小さい画面でも入力欄や保存ボタンが隠れないこと。', "Keep the input fields and Save button visible on small screens."),artifact:ui('スマホ画面の確認結果', "Mobile layout review"),location:'library',steps:studySteps}),
 sampleTodo('village-sample-return',ui('在庫管理APIを公開する', "Release the inventory API"),'done',returned,'completed',{description:ui('在庫管理APIの入出庫と検索を検証し、公開手順を整理しました。', "Verified stock movements and search and documented the release."),criteria:ui('入出庫・権限・在庫数の検証結果をまとめること。', "Summarize the checks for stock movements, permissions and inventory counts."),artifact:ui('在庫APIの検証結果と公開手順', "Inventory API test results and release instructions"),location:'castle',steps:stockSteps})
];
// Each supporting member reports their part of one shared project.
const assignmentTitles={18:ui('写真一覧の画面担当', "Photo gallery interface"),30:ui('写真の表示レビュー', "Photo display review"),42:ui('写真工房のまとめ', "Photo workshop summary"),54:ui('学習メモの調査', "Researching study notes"),66:ui('学習メモの画面案', "Study notes screen design"),78:ui('学習メモのスマホ確認', "Study notes on mobile"),90:ui('在庫の仕様調査', "Inventory specifications"),102:ui('在庫の入出庫確認', "Inventory movements"),114:ui('在庫の権限チェック', "Inventory permissions")};
const assignmentStates={pending:ui('担当の順番待ち', "Waiting for a turn"),running:ui('作業中', "Working"),completed:ui('担当分を完了', "Assignment complete"),interrupted:ui('中断中', "Paused")};
const sampleAssignments=new Map(sampleItems.flatMap(task=>task.runs.flatMap(run=>run.steps.filter(step=>assignmentTitles[step.conversationId.replace('village-demo-','')]).map(step=>[step.conversationId,{
 title:assignmentTitles[step.conversationId.replace('village-demo-','')],
 request:ui('「','“')+task.title+ui('」で担当している「', "” and your task “")+step.role+ui('」について、進み具合を教えてください。', "”. How is it going?"),
 text:(step.output?.replace(/^(?:【サンプル成果】|\[Sample result\] )/u,'')||step.error||(ui('現在は', "Current status: ")+assignmentStates[step.status]+ui('です。', ".")))+'\n\n'+[
  ui('依頼：', "Quest: ")+task.title,ui('役割：', "Role: ")+step.role,ui('状態：', "Status: ")+assignmentStates[step.status]+ui('（サンプル）', " (sample)"),ui('作業内容：', "Work: ")+task.description,
 ].map(line=>'> '+line).join('\n')
}]))));
const sampleQuest={id:'village-sample-work-quest',text:ui('写真整理ツールを実装する', "Build the photo organizer"),status:'running',party:building,createdAt:sampleTime,updatedAt:sampleTime,link:{todoId:'village-sample-work',runId:'village-sample-work-run'},steps:photoSteps};
export function villageDemoActivityState(state){
 // Opening the tavern initializes an empty demo runner. Keep the map's sample
 // formation until the user saves members or starts an actual demo quest.
 const savedParty=state.party?.party;
 return {...state,party:state.party?.quest?state.party:{...(state.party||{}),party:savedParty?.members?.length?savedParty:hero,quest:sampleQuest},todos:{...(state.todos||{}),items:[...(state.todos?.items||[]),...sampleItems.filter(sample=>!(state.todos?.items||[]).some(task=>task.id===sample.id))]}};
}
