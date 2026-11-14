// Explicitly scripted examples, used only by demo=1. No model calls or job updates.
export function residentDemoReply(chat, text) {
  const name = chat.characterName || '街の人';
  if (/ありがとう|またね/.test(text)) return `${name}：こちらこそ。また街で声をかけてください。`;
  if (/何|なに|どんな|教え/.test(text)) return `${name}：「${chat.title}」について一緒に考えられます。気になっていることを教えてください。`;
  return `${name}：声をかけてくれてありがとう。「${chat.title}」について、どんなことを話しましょうか。`;
}
