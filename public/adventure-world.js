// The same route definitions govern the map, admission checks and actual roles.
export const adventureRegions = [
  {
    id:'village',level:1,name:'はじまりの村',title:'最初の頼まれごと',
    description:'一人の仲間と、小さな困りごとを解決する。旅の最初の一歩。',
    ability:'一人に相談する',reward:'連携の笛 · 二人で調べてまとめる',
    nextHint:'成果を確認すると、仲間と進める「協力の森」への道が開きます。',
    roles:['相談・提案'],requiresSources:false,
    prompt:'今週やりたいことを整理し、今日から始められる小さな行動を3つ提案してください。'
  },
  {
    id:'forest',level:2,name:'協力の森',title:'二人で道を切り開く',
    description:'調べる仲間からまとめる仲間へ。異なる役割の成果をつなぐ。',
    ability:'二人の連携',reward:'読解の灯 · 二つの資料を比較する',
    nextHint:'二人の成果を確認すると、資料の違いを読み解く「知恵の図書館」が開きます。',
    roles:['調査・選択肢の整理','判断・最終まとめ'],requiresSources:false,
    prompt:'少人数の勉強会を開きたいです。開催方法を3つ比べ、準備の少なさと参加しやすさから、おすすめの進め方をまとめてください。'
  },
  {
    id:'library',level:3,name:'知恵の図書館',title:'二つの記録を読み解く',
    description:'二つの資料を持ち寄り、整理・比較・統合の三人で根拠を確かめる。',
    ability:'三人で資料を比較',reward:'航海図 · 計画から検証まで四人でつなぐ',
    nextHint:'比較結果を確認すると、より大きな仕事に出発する「旅立ちの港」が開きます。',
    roles:['資料Aの整理','資料Bとの比較・相違点の検証','根拠を添えた最終まとめ'],requiresSources:true,
    prompt:'資料Aと資料Bの共通点・違い・判断に足りない情報を整理し、根拠を示して次の行動を提案してください。'
  },
  {
    id:'harbor',level:4,name:'旅立ちの港',title:'四人で大きな依頼へ',
    description:'計画、制作、検証、統合。身につけた連携で一つの成果を仕上げる。',
    ability:'四人で計画・制作・検証・統合',reward:'全地方踏破 · どの地方の戦法も繰り返し使える',
    nextHint:'ここまでの戦法を、自分の仕事でも繰り返し使えます。次の依頼を自由に持ち込んでください。',
    roles:['計画・工程の整理','制作・成果案の作成','検証・不足と改善点の確認','統合・最終成果のまとめ'],requiresSources:false,
    prompt:'新しい勉強会の開催案を作りたいです。対象者と目的を整理し、案内文と60分の進行表を作り、矛盾や不足を確認して最終案にまとめてください。'
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
