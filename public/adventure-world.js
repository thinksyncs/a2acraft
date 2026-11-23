import {ui} from './interface-language.js';
// The same route definitions govern the map, admission checks and actual roles.
export const adventureRegions = [
  {
    id:'village',level:1,name:ui('はじまりの村', "First village"),title:ui('最初の頼まれごと', "The first request"),
    description:ui('一人の仲間と、小さな困りごとを解決する。旅の最初の一歩。', "Solve a small problem with one companion. This is where the journey begins."),
    ability:ui('一人に相談する', "Consult one companion"),reward:ui('連携の笛 · 二人で調べてまとめる', "Party whistle \u00b7 two companions research and summarize"),
    nextHint:ui('成果を確認すると、仲間と進める「協力の森」への道が開きます。', "Accept your result to open the path to the Forest of Cooperation."),
    roles:[ui('相談・提案', "Advice and suggestions")],requiresSources:false,
    prompt:ui('今週やりたいことを整理し、今日から始められる小さな行動を3つ提案してください。', "Help me organize my goals this week and suggest three small actions I can take today.")
  },
  {
    id:'forest',level:2,name:ui('協力の森', "Forest of Cooperation"),title:ui('二人で道を切り開く', "Find a way together"),
    description:ui('調べる仲間からまとめる仲間へ。異なる役割の成果をつなぐ。', "One companion investigates and another summarizes. Each role builds on the previous result."),
    ability:ui('二人の連携', "Two-person teamwork"),reward:ui('読解の灯 · 二つの資料を比較する', "Reading lamp \u00b7 compare two sources"),
    nextHint:ui('二人の成果を確認すると、資料の違いを読み解く「知恵の図書館」が開きます。', "Accept the pair's results to open the Library of Wisdom and compare sources."),
    roles:[ui('調査・選択肢の整理', "Research and organize options"),ui('判断・最終まとめ', "Decide and summarize")],requiresSources:false,
    prompt:ui('少人数の勉強会を開きたいです。開催方法を3つ比べ、準備の少なさと参加しやすさから、おすすめの進め方をまとめてください。', "I want to organize a small study group. Compare three formats and recommend one that's easy to prepare and attend.")
  },
  {
    id:'library',level:3,name:ui('知恵の図書館', "Library of Wisdom"),title:ui('二つの記録を読み解く', "Read two records"),
    description:ui('二つの資料を持ち寄り、整理・比較・統合の三人で根拠を確かめる。', "Bring two sources. Three companions organize, compare and combine the evidence."),
    ability:ui('三人で資料を比較', "Compare sources with three companions"),reward:ui('航海図 · 計画から検証まで四人でつなぐ', "Sea chart \u00b7 four companions plan, create and verify"),
    nextHint:ui('比較結果を確認すると、より大きな仕事に出発する「旅立ちの港」が開きます。', "Accept the comparison to open the Harbor of Departure and set out on larger quests."),
    roles:[ui('資料Aの整理', "Organize source A"),ui('資料Bとの比較・相違点の検証', "Compare with source B and verify differences"),ui('根拠を添えた最終まとめ', "Summarize the evidence")],requiresSources:true,
    prompt:ui('資料Aと資料Bの共通点・違い・判断に足りない情報を整理し、根拠を示して次の行動を提案してください。', "Compare sources A and B. Identify what they share, where they differ and what evidence is missing, then recommend the next action.")
  },
  {
    id:'harbor',level:4,name:ui('旅立ちの港', "Harbor of Departure"),title:ui('四人で大きな依頼へ', "Four companions, one quest"),
    description:ui('計画、制作、検証、統合。身につけた連携で一つの成果を仕上げる。', "Plan, create, verify and combine. Use your party's experience to deliver one result."),
    ability:ui('四人で計画・制作・検証・統合', "Plan, create, verify and combine with four companions"),reward:ui('全地方踏破 · どの地方の戦法も繰り返し使える', "All regions explored \u00b7 use any region's strategy again"),
    nextHint:ui('ここまでの戦法を、自分の仕事でも繰り返し使えます。次の依頼を自由に持ち込んでください。', "Apply these strategies to your own work. Bring any request for your next quest."),
    roles:[ui('計画・工程の整理', "Plan and organize the steps"),ui('制作・成果案の作成', "Create a first draft"),ui('検証・不足と改善点の確認', "Verify gaps and improvements"),ui('統合・最終成果のまとめ', "Combine the final results")],requiresSources:false,
    prompt:ui('新しい勉強会の開催案を作りたいです。対象者と目的を整理し、案内文と60分の進行表を作り、矛盾や不足を確認して最終案にまとめてください。', "Plan a new study group. Describe the audience and purpose, write an invitation and a 60-minute agenda, then review the draft and deliver the final plan.")
  }
];

export function adventureProgress(saved={}) {
  const ids=new Set(Array.isArray(saved.completed)?saved.completed:[]);
  const completed=[];
  // A malformed or newer save must not unlock a gap in this route.
  for(const region of adventureRegions){if(!ids.has(region.id))break;completed.push(region.id);}
  return {level:Math.min(adventureRegions.length,completed.length+1),completed,
    nextRegionId:adventureRegions[completed.length]?.id||null,
    allComplete:completed.length===adventureRegions.length};
}
