// Explicitly scripted examples, used only by demo=1. No model calls or job updates.
import {ui} from './interface-language.js';

export function residentDemoReply(chat, text, context = null) {
  if (/ありがとう|またね|\b(thanks|thank you|see you)\b/i.test(text)) {
    return ui('うん、また道で会おうね。', 'See you on the trail!');
  }
  const companions = context?.companions || [];
  if (/^山歩きの準備|hik(e|ing)|trail walk/i.test(chat.title || '') &&
      /雨具|水|尾根|荷物|分岐|\b(rain|water|ridge|pack|fork|junction)\b/i.test(text)) {
    const buddy = companions.find(m => /調査|検証|レビュー|research|test|review/i.test(m.role)) || companions[0];
    const next = buddy
      ? ui(`分岐に着いたら、${buddy.name}と一緒に帰り道も確かめてね。`, ` At the fork, ask ${buddy.name} to check the way back with you.`)
      : ui('分岐で一度振り返ると、帰りの目印を覚えやすいよ。', ' Look back at the fork so you’ll recognize it on the way home.');
    return ui('雨具は上ぶたの下へ。水は立ち止まってすぐ手が届く横ポケットがいいよ。',
      'Keep your rain gear under the top flap and your water in a side pocket where you can reach it.') + next;
  }
  if (companions.length) {
    const perspectives = companions.map(member => {
      const role = member.role;
      const suggestion = /検証|レビュー|安全|セキュリティ|test|review|security/i.test(role)
        ? ui('先に失敗する条件を挙げ、小さく試して結果を確かめましょう。', 'List what might go wrong, then run a small test.')
        : /調査|research|分析|analysis/i.test(role)
        ? ui('分かっていることと未確認のことを分け、根拠を集めるところから始めましょう。', 'Write down what we know and gather evidence for the open questions.')
        : /デザイン|設計|UI|design/i.test(role)
        ? ui('使う人の最初の操作を一つに絞り、画面と導線を形にしましょう。', 'Pick the first thing someone needs to do and sketch the screen they’ll use.')
        : /実装|開発|code|develop/i.test(role)
        ? ui('まず一つの動く機能を作り、入力から結果まで通して確認しましょう。', 'Build one working feature and follow it from input to result.')
        : /執筆|文章|writ/i.test(role)
        ? ui('相手に伝えたい結論を先に置き、短い具体例を添えましょう。', 'Start with the main point and add a short example.')
        : ui('今回の目的と次に確かめる一歩を整理しましょう。', 'Agree on the goal and the next thing to check.');
      return ui(`- ${member.name}（${role}）の観点：${suggestion}`, `- ${member.name} (${role}): ${suggestion}`);
    });
    const intro = ui(`「${chat.title}」なら、こんな進め方はどう？`, `How about this approach to “${chat.title}”?`);
    return intro + '\n\n' + perspectives.join('\n');
  }
  if (/何|なに|どんな|教え|\b(what|how|tell me)\b/i.test(text)) {
    return ui(`「${chat.title}」のどこから話そうか？`, `Where should we start with “${chat.title}”?`);
  }
  return ui(`「${chat.title}」の続きだね。今日はどうしよう？`, `Let’s pick up “${chat.title}”. What would you like to do today?`);
}
