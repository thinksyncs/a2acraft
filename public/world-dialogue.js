import {ui} from './interface-language.js';
// Imported histories may store Codex's ambient UI records under a conversational
// role. Filter recognized envelopes for map display while leaving the saved
// transcript, user-authored XML, Markdown examples and attachments intact.
export function mapTranscriptText(value) {
  if (typeof value !== 'string') return '';
  // Codex adds this header to image/file prompts. Display the user's request
  // without showing the machine's temporary attachment paths.
  if (value.startsWith('# Files mentioned by the user:')) {
    const mark = /^## My request:[ \t]*\r?$/m.exec(value);
    if (mark) value = value.slice(mark.index + mark[0].length).trimStart();
  }
  if (!/<(?:external_codex_apps_selected_page|in-app-browser-context|environment_context)[\s_>]/i.test(value)) return value.trim() ? value : '';
  const kept = [];
  let closing = '', fence = '';
  for (let line of value.split(/\r?\n/)) {
    if (!closing) {
      const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        kept.push(line);
        if (mark?.startsWith(fence) && line.trim() === mark) fence = '';
        continue;
      }
      if (mark) { fence = mark; kept.push(line); continue; }
    }
    while (line) {
      if (!closing) {
        const tag = /^\s*<(external_codex_apps_selected_page(?:_part_\d+_of_\d+)?|in-app-browser-context|environment_context)(?:\s[^>]*)?>/i.exec(line);
        if (!tag) break;
        closing = '</' + tag[1].toLowerCase() + '>';
        line = line.slice(tag[0].length);
      }
      const end = line.toLowerCase().indexOf(closing);
      if (end < 0) { line = ''; break; }
      line = line.slice(end + closing.length);
      closing = '';
    }
    if (!closing) kept.push(line);
  }
  return kept.join('\n').trim();
}

const clean = (value) =>
  mapTranscriptText(value)
    .replace(/\s+/g, " ")
    .slice(0, 220);

export function conversationMessageText(message) {
  const text = mapTranscriptText(message?.text);
  if (text) return text;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length) return ui('添付ファイル: ', "Attachments: ") + attachments.map((item,index) =>
    String(item?.name || ui('ファイル ', "File ") + (index + 1)).replace(/([\\`*_{}\[\]()#+.!|<>-])/g,'\\$1')).join('、');
  return message?.role === 'user' && !String(message.text || '').trim() ? ui('本文のない依頼', "Request without text") : '';
}
const versionOf = (value) => {
  const raw = JSON.stringify(value);
  let hash = 2166136261;
  for (const char of raw) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return String(hash >>> 0) + ":" + raw.length;
};

// Old village saves have only a snapshot hash. Recover the message it actually
// described when possible; unknown old receipts must not hide unseen reports.
function legacyReports(baseline, messages, job, project) {
  const reports = {};
  if (!baseline?.version || baseline.reports || job || project?.paused) return reports;
  for (const message of messages) {
    const version = versionOf([
      undefined, undefined, undefined, undefined, undefined, undefined,
      message.id, message.text, project?.paused,
    ]);
    if (version === baseline.version)
      reports["message:" + message.reportSource] = versionOf(["message:" + message.reportSource, message.role, message.text]);
  }
  return reports;
}

export function residentReport(chat, project, baseline) {
  const job = project?.jobs?.find((j) => j.id === chat.project?.jobId);
  const events = (project?.events || []).filter((e) => job && e.jobId === job.id);
  const event = events
    .filter(
      (e) => e.kind !== "progress" && e.status === "open",
    )
    .at(-1);
  const messages = (chat.messages || []).map((message, index) => ({
    ...message, reportSource: message.id || chat.id + ":message:" + index,
  })).filter(
    (m) => ["user", "assistant"].includes(m.role) && conversationMessageText(m),
  );
  const previousReports = legacyReports(baseline, messages, job, project);
  const heard = { ...previousReports, ...baseline?.reports };
  const candidates = [];
  const add = (key, source, evidence, text, kind = "report") => {
    const candidate = { key, source, version: versionOf([key, ...evidence]), text, kind };
    candidates.push(candidate);
    return candidate;
  };
  let current, context = "";
  if (event) {
    current = add("event:" + event.id, event.id,
      [event.kind, event.question, event.options],
      ui("ここで相談したいことがあるんです。", "There's something I'd like to discuss. ") + clean(event.question), "question");
    context = event.kind === "question" ? ui("現在、相談への回答を待っています。", "Waiting for an answer. ") : ui("現在、問題の確認が必要です。", "An issue needs review. ");
  }
  if (job?.error) {
    const failure = add("failure:" + job.id, job.id, [job.attempt, job.error],
      ui("うまくいかない箇所が見つかりました。", "Something went wrong. ") + clean(job.error));
    if (!current) {
      current = failure;
      context = ui("現在、うまくいかない箇所があります。", "There's still a problem. ") + clean(job.error) + " ";
    }
  }
  if (!job && (chat.error || ["failed", "cancelled"].includes(chat.status))) {
    const stopped = chat.status === "cancelled";
    const detail = clean(chat.error) || (stopped ? ui("完了した結果は確認できていません。", "I couldn't confirm the result. ") : ui("前の処理は完了しませんでした。記録を確認してください。", "The previous task did not finish. Check its record."));
    const failure = add("chat-failure:" + chat.id, chat.id, [chat.status, chat.error, chat.activity?.id],
      (stopped ? ui("処理は停止しています。", "Work has stopped. ") : ui("うまくいかない箇所が見つかりました。", "Something went wrong. ")) + detail);
    if (!current) {
      current = failure;
      context = (stopped ? ui("現在、処理は停止しています。", "The process is stopped. ") : ui("現在、うまくいかない箇所があります。", "There's still a problem. ")) + detail + " ";
    }
  }
  if (project?.paused) {
    const paused = add("pause:" + project.id, project.id, [true],
      ui("今は作業を休止しています。続きの記録は残してあります。", "Work is paused. The record is saved."));
    if (!current) {
      current = paused;
      context = ui("今は作業を休止しています。", "Work is paused. ");
    }
  }
  if (job?.status === "done") {
    const pr = project?.pullRequests?.find((item) => job.url && item.url === job.url && item.repoId === job.repoId);
    add("job:" + job.id, job.id, [job.status, job.attempt, job.completedAt, job.kind, job.output, pr?.url],
      (baseline ? ui("あの後、", "Since we spoke, ") : "") +
      (job.kind === "verify"
        ? ui("検証の結果が届きました。", "the test results came in.")
        : job.kind === "publish" && pr
          ? ui("変更をPRにまとめました。まだ公開とは別の段階です。", "I put the changes into a pull request. They are awaiting publication.")
          : ui("この工程の報告がまとまりました。", "the report for this step is ready.")) +
      " " +
      clean(job.output));
  } else if (baseline && ["running", "preparing", "queued"].includes(job?.status)) {
    add("job:" + job.id, job.id, [job.status, job.attempt, job.title],
      ui("相談の続きは「", "The next topic is “") +
      clean(job.title) +
      ui("」です。", "”. ") +
      (job.status === "queued"
        ? ui("作業の順番を待っています。", "I'm waiting for my turn.")
        : ui("今、続きを進めています。", "I'm working on it now.")));
  }
  for (const progress of events.filter((e) => e.kind === "progress"))
    add("event:" + progress.id, progress.id, [progress.question, progress.summary],
      ui("記録に報告が残っています。", "A report is on file. ") + clean(progress.question) + " " + clean(progress.summary));
  const introduction = !baseline && !job ? messages.filter((m) => m.role === "user").at(-1) : null;
  const ordered = introduction ? [introduction, ...messages.filter((m) => m !== introduction)] : messages;
  for (const message of ordered) {
    const evidence = [message.role, message.text];
    if (message.attachments?.length) evidence.push(message.attachments);
    const report = add("message:" + message.reportSource, message.reportSource,
      evidence, conversationMessageText(message).trim());
    report.label = message.role === "user" ? ui("依頼", "Request") : ui("返答", "Reply");
  }
  if (!candidates.length)
    add("introduction:" + chat.id, job?.id || chat.id, [job?.title || chat.title], job
      ? "「" +
        clean(job.title) +
        ui("」を担当しています。まとまったら、ここでお知らせします。", "” is my task. I'll report back here when it's ready.")
      : ui("まだお話はこれからです。何から始めましょうか。", "We haven't spoken yet. Where shall we start?"));
  const candidate = candidates.find((item) => heard[item.key] !== item.version);
  const text = candidate?.text || ui("前にお話ししたところから、まだ新しい報告はありません。", "No new reports since we last spoke.");
  return {
    ...candidate,
    version: candidate?.version || baseline?.version,
    source: candidate?.source || baseline?.source || chat.id,
    text: current && candidate !== current ? context + (candidate ? ui("以前の記録からお伝えします。", "From an earlier record: ") : "") + text : text,
    conversationId: chat.id,
    kind: candidate?.kind || "report",
    label: candidate?.label || (candidate?.kind === "question" ? ui("確認事項", "Question") : ui("進捗", "Progress")),
    previousReports,
  };
}

// Call only after rendering the selected report, never while enumerating residents.
export function acknowledgeResidentReport(baseline, report, heardAt = Date.now()) {
  return {
    ...baseline,
    version: report.version,
    source: report.source,
    heardAt,
    reports: {
      ...baseline?.reports,
      ...report.previousReports,
      ...(report.key ? { [report.key]: report.version } : {}),
    },
  };
}
export function associationSpeech(from, to) {
  return {
    kind: "association",
    text:
      ui("話の種ですが、「", "I wonder if what we learned on “") +
      clean(from.name) +
      ui("」で考えたことは「", "” might help with “") +
      clean(to.name) +
      ui("」でも役に立つでしょうか。向こうの話も聞いてみたいですね。", "”. I'd like to hear what they think."),
  };
}
