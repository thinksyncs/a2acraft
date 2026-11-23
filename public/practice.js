export const practiceBusiness = Object.freeze({
  marker: '業務確認:4827',
  request: '業務確認:4827。架空の経費精算業務です。予算は120G、交通費は15Gが2件、備品費は20Gが1件です。与えた数字だけから支出合計と残金を計算し、提出前の確認用メモにしてください。小クエストは必ず2件だけに分解し、最初に計算根拠を整理・検証し、次に前工程の成果を確認して最終メモへ統合してください。パーティの各担当は自分の役割だけを3行以内で回答し、すべての回答に「業務確認:4827」をそのまま含めてください。ツール、ファイル操作、コマンド、検索、ネットワーク、外部への送信は使わず、チャット本文だけを成果としてください。ファイル保存や提出を実行済みとは書かないでください。',
  expectedArtifact: '「業務確認:4827」「支出<数値>G」「残金<数値>G」を含む、3行以内の経費精算メモ。計算の確認結果と、実際の領収書・提出は未確認であることが分かる本文。'
});

export const practiceRoles = Object.freeze(['リーダー', '調査・分析', '検証・レビュー', '支援・相談']);

const englishPractice = Object.freeze({
  marker: 'Expense check:4827',
  request: 'Expense check:4827. Prepare a short review memo for a fictitious expense claim. The budget is 120G. Two journeys cost 15G each, and supplies cost 20G. Use only these figures to calculate total spending and the remaining balance. Split the assignment into exactly two quests: first establish and check the calculation, then review the first result and compile the final memo. Each party member should respond only for their role, in at most three lines. Include “Expense check:4827” unchanged in every response. Work in the chat only. Do not use tools, files, commands, search, network access or external delivery. Do not claim to have saved or submitted anything.',
  expectedArtifact: 'An expense memo of at most three lines containing “Expense check:4827”, “Spent <number>G”, and “Remaining <number>G”. Include the calculation check and state that actual receipts and submission have not been verified.'
});

export function practiceBusinessFor(locale) {
  return locale === 'en' ? englishPractice : practiceBusiness;
}
