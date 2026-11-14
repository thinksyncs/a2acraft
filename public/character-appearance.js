const appearances={
  hero:{id:'hero',label:'冒険者',icon:'hero'},
  priest:{id:'priest',label:'僧侶',icon:'priest'},
  mage:{id:'mage',label:'魔法使い',icon:'mage'},
  martialArtist:{id:'martial-artist',label:'武道家',icon:'martial-artist'}
};

// Appearance follows the saved role; it never changes skills or permissions.
export function characterAppearance(role){
  const value=String(role??'').normalize('NFKC').toLowerCase();
  if(/僧侶|神官|司祭|ヒーラー|プリースト|\b(?:priest|cleric|healer)\b/.test(value))return {...appearances.priest};
  if(/魔法使い|魔術師|魔導師|魔道士|ウィザード|メイジ|\b(?:mage|wizard|sorcerer)\b/.test(value))return {...appearances.mage};
  if(/武道家|格闘家|拳法|モンク|\b(?:martial[ -]?artist|monk|fighter)\b/.test(value))return {...appearances.martialArtist};
  if(/調査|研究|分析|探索|\b(?:investigation|investigator|research|researcher|analysis|analyst)\b/.test(value))return {...appearances.mage};
  if(/執筆|文章|補助|支援|回復|治療|\b(?:writing|writer|support|healing|editor)\b/.test(value))return {...appearances.priest};
  if(/レビュー|検証|戦闘|\b(?:review|reviewer|combat|battle|testing|tester)\b/.test(value))return {...appearances.martialArtist};
  return {...appearances.hero};
}

export function characterIcon(role,className='equipment-icon'){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');
  svg.setAttribute('class',className);svg.setAttribute('viewBox','0 0 64 80');svg.setAttribute('aria-hidden','true');
  use.setAttribute('href','/assets/equipment.svg#'+characterAppearance(role).icon);svg.append(use);return svg;
}
