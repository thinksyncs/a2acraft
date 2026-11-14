export const equipmentSlots = ['weapon','tool','spell'];
export const slotLabels = {weapon:'武器',tool:'道具',spell:'呪文'};

const namedItems = {
  'assess-patch-risk':['balance','見定めの天秤'],
  'attack-path-analysis':['route-spear','経路を辿る槍'],
  'deep-security-scan':['lantern','深層を照らす灯'],
  'define-security-policy':['banner','守りの旗'],
  'finding-discovery':['magnifier','発見の虫眼鏡'],
  'fix-finding':['wrench','修復のレンチ'],
  'propose-security-hardening':['fortress','堅牢の砦'],
  'security-diff-scan':['crossed-blades','差分の双剣'],
  'security-scan':['shield','守りの盾'],
  'threat-model':['compass','脅威を見渡す羅針盤'],
  'track-findings':['target','追跡の標的'],
  'triage-finding':['sieve','選別のふるい'],
  'validation':['seal','真偽を確かめる印章'],
  'verify-fix':['check-hammer','修復を確かめる槌'],
  'vulnerability-writeup':['report-scroll','弱点を記す巻物'],
  'code-review':['crossed-blades','見通しの双剣'],
  'test-runner':['hammer','試練の槌'],
  'openai-docs':['staff','星読みの呪文'],
  'paper-reading':['book','論文を解く呪文'],
  'pdf':['report-scroll','仕上げの巻物'],
  'documents':['quill','記録の羽根ペン'],
  'google-docs':['quill','共同執筆の羽根ペン'],
  'spreadsheets':['abacus','計算のそろばん'],
  'google-sheets':['abacus','集計のそろばん'],
  'presentations':['easel','発表の画架'],
  'google-slides':['easel','説明の画架'],
  'imagegen':['palette','彩りのパレット'],
  'visualize':['map','図解の地図'],
  'template-creator':['stencil','型づくりの定規'],
  'skill-creator':['anvil','技を鍛える金床'],
  'skill-installer':['key','技を開く鍵'],
  'plugin-management':['gear','連携の歯車'],
  'create-pet':['egg','相棒を呼ぶたまご'],
  'update-pet':['brush','相棒のブラシ'],
  'pets':['paw','相棒の足あと'],
  'yolozu-image-service':['lens','見抜きのレンズ'],
  'write-page':['quill','物語の羽根ペン'],
  'maintain-space':['broom','整理のほうき'],
  'manage-schedules':['hourglass','時を刻む砂時計'],
  'organize-space':['compass','道しるべの羅針盤'],
  'sites':['fortress','拠点づくりの城']
};
const silhouettes={
  weapon:[['sword','剣'],['spear','槍'],['axe','斧'],['dagger','短剣'],['mace','メイス'],['crossbow','弩'],['flail','鎖鉄球'],['sickle','鎌']],
  tool:[['toolkit','道具箱'],['quill','羽根ペン'],['palette','パレット'],['map','地図'],['lens','レンズ'],['abacus','そろばん'],['easel','画架'],['hourglass','砂時計']],
  spell:[['staff','杖の呪文'],['book','書の呪文'],['orb','水晶の呪文'],['rune-scroll','巻物の呪文']]
};
const epithets=['星明かりの','夜明けの','月影の','風渡りの','青空の','森守りの','火花の','旅人の'];
export const equipmentIconNames = [...new Set(['bow','shield','hammer','hero','tavern','crown',...Object.values(namedItems).map(([icon])=>icon),...Object.values(silhouettes).flat().map(([icon])=>icon)])];

function fingerprint(value){let hash=2166136261;for(const char of value){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}

// Presentation metadata only. Skill instructions and permissions remain with Codex.
export function skillAppearance(name) {
  const key = String(name).normalize('NFKC').toLowerCase();
  const shortName=key.split(/[:/]/).filter(Boolean).at(-1)||key;
  if (/(?:gmail|e?mail|メール)/.test(key)) return {slot:'weapon',icon:'bow',itemName:'便りの弓',singleUse:true};
  const slot=/(?:openai-docs|knowledge|reference|知識|research|paper|論文)/.test(key)?'spell':/(?:document|pdf|presentation|slides|spreadsheet|sheets|image|visualize|pet|template)/.test(key)?'tool':'weapon';
  const known=namedItems[shortName];
  if(known)return {slot,icon:known[0],itemName:known[1],singleUse:false};
  const hash=fingerprint(key),[icon,label]=silhouettes[slot][hash%silhouettes[slot].length];
  return {slot,icon,itemName:epithets[(hash>>>8)%epithets.length]+label,singleUse:false,rune:hash.toString(16).padStart(8,'0')};
}

// Refresh old saved display fields without changing the skill's slot or behavior.
export function equipmentPresentation(skill){
  if(!skill||typeof skill!=='object')return skill;
  if(!skill.name)return {...skill};
  const appearance=skillAppearance(skill.name),{rune,...saved}=skill;
  return {...saved,icon:appearance.icon,itemName:appearance.itemName,...(appearance.rune?{rune:appearance.rune}:{})};
}

// Planning ranges for a standard task, not metered usage or a model tariff.
// Keep these separate from saved equipment: refreshing an estimate must never
// change ownership, permissions, or which skill a conversation invokes.
const tokenProfiles={
 quick:{minTokens:1000,maxTokens:4000,scope:'短い文面1通、または単一の整理作業'},
 review:{minTokens:3000,maxTokens:10000,scope:'小さな変更や記録を1件レビュー'},
 test:{minTokens:3000,maxTokens:12000,scope:'対象を絞ったテストと結果の確認'},
 document:{minTokens:3000,maxTokens:12000,scope:'短い文書・表・図の作成や編集'},
 research:{minTokens:5000,maxTokens:20000,scope:'資料を数件読み、要点を整理'},
 implement:{minTokens:5000,maxTokens:25000,scope:'対象を絞った実装と動作確認'},
 security:{minTokens:8000,maxTokens:30000,scope:'対象を限定したセキュリティ調査'},
 deep:{minTokens:20000,maxTokens:80000,scope:'複数の観点から繰り返す詳細調査'}
};
const tokenProfileByName={
 'assess-patch-risk':'review','attack-path-analysis':'security','deep-security-scan':'deep',
 'define-security-policy':'document','finding-discovery':'security','fix-finding':'implement',
 'propose-security-hardening':'security','security-diff-scan':'security','security-scan':'security',
 'threat-model':'security','track-findings':'quick','triage-finding':'review','validation':'review',
 'verify-fix':'test','vulnerability-writeup':'document','code-review':'review','test-runner':'test',
 'openai-docs':'research','paper-reading':'research','pdf':'document','documents':'document',
 'google-docs':'document','spreadsheets':'document','google-sheets':'document','presentations':'document',
 'google-slides':'document','visualize':'document','template-creator':'document','skill-creator':'implement',
 'skill-installer':'quick','plugin-management':'quick','create-pet':'implement','update-pet':'implement',
 'pets':'quick','write-page':'document','maintain-space':'quick','manage-schedules':'quick',
 'organize-space':'quick','sites':'implement'
};
export function skillTokenEstimate(skill){
 const name=typeof skill==='string'?skill:skill?.name;
 const key=typeof name==='string'?name.normalize('NFKC').trim().toLowerCase().split(/[:/]/).filter(Boolean).at(-1)||'':'';
 const profile=tokenProfiles[tokenProfileByName[key]||(/(?:gmail|e?mail|メール)/.test(key)?'quick':'')];
 if(!profile)return {minTokens:null,maxTokens:null,label:'— k token',basis:'unknown',scope:'目安未登録',detail:key==='imagegen'||key==='yolozu-image-service'?'画像処理の利用量を含むため、テキストのtoken数だけでは見積もれません。':'このスキルの消費目安はまだ登録されていません。'};
 return {...profile,label:profile.minTokens/1000+'–'+profile.maxTokens/1000+' k token',basis:'reference',detail:'入力・出力・ツール利用を含む参考見積もりです。実測値ではなく、長い履歴や繰り返し作業では範囲を超えることがあります。'};
}

export const demoEquipmentSkills = [
  {id:'demo-review',name:'code-review',displayName:'コードレビュー',description:'コードを読み、変更箇所と問題点を調べます。'},
  {id:'demo-test',name:'test-runner',displayName:'テスト',description:'テストを実行し、動作を確認します。'},
  {id:'demo-mail',name:'shared-gmail-workflow',displayName:'メール送信',description:'宛先と本文を決め、一通ずつメールを送るためのskillです。'},
  {id:'demo-pdf',name:'pdf',displayName:'PDF',description:'文書をPDFに仕上げ、ページの見た目を確認します。'},
  {id:'demo-visualize',name:'visualize',displayName:'図解',description:'情報を図や操作できる見本にまとめます。'},
  {id:'demo-docs',name:'openai-docs',displayName:'OpenAIの知識',description:'公式資料を参照して、CodexやAPIの疑問を調べます。'},
  {id:'demo-paper',name:'paper-reading',displayName:'論文読解',description:'論文の主張と根拠を読み解くための知識です。'}
].map(skill => ({...skill,...skillAppearance(skill.name)}));
