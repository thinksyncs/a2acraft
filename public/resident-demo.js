import {worldText} from './i18n-world.js';
// Explicitly scripted examples, used only by demo=1. No model calls or job updates.
export function residentDemoReply(chat, text, context = null) {
  if (/ありがとう|またね|\b(?:thanks?|thank you|see you|bye)\b/i.test(text)) return worldText('うん、また道で会おうね。');
  const companions = context?.companions || [];
  if (chat.title?.startsWith(worldText('山歩きの準備')) && /雨具|水|尾根|荷物|分岐|rain|water|ridge|pack|fork/i.test(text)) {
    const buddy = companions.find(m => /調査|検証|レビュー|research|review|test/i.test(m.role)) || companions[0];
    const next = buddy ? worldText("分岐に着いたら、{name}と一緒に帰り道も確かめてね。", {name:buddy.name})
      : worldText('分岐で一度振り返ると、帰りの目印を覚えやすいよ。');
    return worldText('雨具は上ぶたの下へ。水は立ち止まってすぐ手が届く横ポケットがいいよ。')+next;
  }
  if (context?.companions?.length) {
    const perspectives=context.companions.map(member=>{
      const role=member.role;
      const suggestion=/検証|レビュー|安全|セキュリティ|test|review|security/i.test(role)?worldText('先に失敗する条件を挙げ、小さく試して結果を確かめましょう。'):
        /調査|research|分析/i.test(role)?worldText('分かっていることと未確認のことを分け、根拠を集めるところから始めましょう。'):
        /デザイン|設計|UI|design/i.test(role)?worldText('使う人の最初の操作を一つに絞り、画面と導線を形にしましょう。'):
        /実装|開発|code/i.test(role)?worldText('まず一つの動く機能を作り、入力から結果まで通して確認しましょう。'):
        /執筆|文章|writ/i.test(role)?worldText('相手に伝えたい結論を先に置き、短い具体例を添えましょう。'):
        worldText('今回の目的と次に確かめる一歩を整理しましょう。');
      return worldText("- {name}（{role}）の観点：{suggestion}", {name:member.name,role,suggestion});
    });
    return worldText("「{topic}」なら、こんな進め方はどう？\n\n{ideas}", {topic:chat.title,ideas:perspectives.join('\n')});
  }
  if (/何|なに|どんな|教え|\b(?:how|what|tell)\b/i.test(text)) return worldText("「{topic}」のどこから話そうか？", {topic:chat.title});
  return worldText("「{topic}」の続きだね。今日はどうしよう？", {topic:chat.title});
}
