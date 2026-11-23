import {getLocale} from './i18n-world.js';
const japaneseGiven=['リオン','アレン','ルカ','ノエル','シオン','レオン','カイル','セナ','エリオ','フィン','ロイ','ユアン','ルーク','レイ','トア','オリバー','アリア','セリア','リリカ','ミーナ','ルナ','ティナ','エマ','アイリス','メル','ニーナ','リゼ','サラ','リナ','ユリカ','ソフィア','エルナ','ガイ','ラルフ','ジーク','ロラン','グレン','テオ','キース','ヴィオ','レナ','クララ','フローラ','マリル','アデル','イリス','フェリ','スピカ'];
const japaneseFamilies=['ルーン','ノール','アステル','リーフ','ベル','ルーチェ','ミスト','セレス','オーク','フォルテ','ブラン','ウィンド','ロゼ','ヴェイル','リーヴ','ソレイユ'];

const englishGiven=['Rion','Allen','Luca','Noel','Shion','Leon','Kyle','Sena','Elio','Finn','Roy','Ewan','Luke','Ray','Toa','Oliver','Aria','Celia','Lyrica','Mina','Luna','Tina','Emma','Iris','Mel','Nina','Lise','Sara','Rina','Yurika','Sophia','Erna','Guy','Ralph','Sieg','Roland','Glen','Theo','Keith','Vio','Lena','Clara','Flora','Maril','Adele','Ilis','Feri','Spica'];
const englishFamilies=['Rune','Noll','Aster','Leaf','Bell','Luce','Mist','Ceres','Oak','Forte','Blanc','Wind','Rose','Vale','Reeve','Soleil'];

/** Add names only where missing. Existing titles, names and other fields stay intact. */
export function assignCharacterNames(rows,{random=Math.random, locale=getLocale()}={}){
 const english=locale==='en', givenNames=english?englishGiven:japaneseGiven, familyNames=english?englishFamilies:japaneseFamilies;
 const used=new Set(rows.map(row=>row.characterName).filter(name=>typeof name==='string'&&name.trim()));
 let changed=false;
 for(const row of rows){
  if(typeof row.characterName==='string'&&row.characterName.trim())continue;
  const available=givenNames.filter(name=>!used.has(name));
  let choices=available;
  if(!choices.length)choices=givenNames.flatMap(first=>familyNames.map(last=>first+(english?' ':'・')+last)).filter(name=>!used.has(name));
  let name;
  if(choices.length){
   const fraction=Number(random()),index=Number.isFinite(fraction)?Math.max(0,Math.min(choices.length-1,Math.floor(fraction*choices.length))):0;
   name=choices[index];
  }else{
   let suffix=2;while(used.has(givenNames[0]+' '+suffix))suffix++;
   name=givenNames[0]+' '+suffix;
  }
  row.characterName=name;used.add(name);changed=true;
 }
 return changed;
}
