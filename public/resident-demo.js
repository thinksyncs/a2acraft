// Explicitly scripted examples, used only by demo=1. No model calls or job updates.
export function residentDemoReply(chat, text, context = null) {
  const name = chat.characterName || '街の人';
  if (/ありがとう|またね/.test(text)) return `${name}：こちらこそ。また街で声をかけてください。`;
  if (context?.companions?.length) {
    const perspectives=context.companions.map(member=>{
      const role=member.role;
      const suggestion=/検証|レビュー|安全|セキュリティ|test/i.test(role)?'先に失敗する条件を挙げ、小さく試して結果を確かめましょう。':
        /調査|research|分析/i.test(role)?'分かっていることと未確認のことを分け、根拠を集めるところから始めましょう。':
        /デザイン|設計|UI|design/i.test(role)?'使う人の最初の操作を一つに絞り、画面と導線を形にしましょう。':
        /実装|開発|code/i.test(role)?'まず一つの動く機能を作り、入力から結果まで通して確認しましょう。':
        /執筆|文章|write/i.test(role)?'相手に伝えたい結論を先に置き、短い具体例を添えましょう。':
        '今回の目的と次に確かめる一歩を整理しましょう。';
      return `- ${member.name}（${role}）の観点：${suggestion}`;
    });
    return `${name}：「${chat.title}」を、今の仲間と考えてみましょう。\n\n${perspectives.join('\n')}`;
  }
  if (/何|なに|どんな|教え/.test(text)) return `${name}：「${chat.title}」について一緒に考えられます。気になっていることを教えてください。`;
  return `${name}：声をかけてくれてありがとう。「${chat.title}」について、どんなことを話しましょうか。`;
}
