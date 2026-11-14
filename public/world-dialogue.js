const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .slice(0, 220);

export function conversationMessageText(message) {
  if (typeof message?.text === 'string' && message.text.trim()) return message.text;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length) return '添付ファイル: ' + attachments.map((item,index) =>
    String(item?.name || 'ファイル ' + (index + 1)).replace(/([\\`*_{}\[\]()#+.!|<>-])/g,'\\$1')).join('、');
  return message?.role === 'user' ? '本文のない依頼' : '';
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
      "ここで相談したいことがあるんです。" + clean(event.question), "question");
    context = event.kind === "question" ? "現在、相談への回答を待っています。" : "現在、問題の確認が必要です。";
  }
  if (job?.error) {
    const failure = add("failure:" + job.id, job.id, [job.attempt, job.error],
      "うまくいかない箇所が見つかりました。" + clean(job.error));
    if (!current) {
      current = failure;
      context = "現在、うまくいかない箇所があります。" + clean(job.error) + " ";
    }
  }
  if (!job && (chat.error || ["failed", "cancelled"].includes(chat.status))) {
    const stopped = chat.status === "cancelled";
    const detail = clean(chat.error) || (stopped ? "完了した結果は確認できていません。" : "前の処理は完了しませんでした。記録を確認してください。");
    const failure = add("chat-failure:" + chat.id, chat.id, [chat.status, chat.error, chat.activity?.id],
      (stopped ? "処理は停止しています。" : "うまくいかない箇所が見つかりました。") + detail);
    if (!current) {
      current = failure;
      context = (stopped ? "現在、処理は停止しています。" : "現在、うまくいかない箇所があります。") + detail + " ";
    }
  }
  if (project?.paused) {
    const paused = add("pause:" + project.id, project.id, [true],
      "今は作業を休止しています。続きの記録は残してあります。");
    if (!current) {
      current = paused;
      context = "今は作業を休止しています。";
    }
  }
  if (job?.status === "done") {
    const pr = project?.pullRequests?.find((item) => job.url && item.url === job.url && item.repoId === job.repoId);
    add("job:" + job.id, job.id, [job.status, job.attempt, job.completedAt, job.kind, job.output, pr?.url],
      (baseline ? "あの後、" : "") +
      (job.kind === "verify"
        ? "検証の結果が届きました。"
        : job.kind === "publish" && pr
          ? "変更をPRにまとめました。まだ公開とは別の段階です。"
          : "この工程の報告がまとまりました。") +
      " " +
      clean(job.output));
  } else if (baseline && ["running", "preparing", "queued"].includes(job?.status)) {
    add("job:" + job.id, job.id, [job.status, job.attempt, job.title],
      "相談の続きは「" +
      clean(job.title) +
      "」です。" +
      (job.status === "queued"
        ? "作業の順番を待っています。"
        : "今、続きを進めています。"));
  }
  for (const progress of events.filter((e) => e.kind === "progress"))
    add("event:" + progress.id, progress.id, [progress.question, progress.summary],
      "記録に報告が残っています。" + clean(progress.question) + " " + clean(progress.summary));
  const introduction = !baseline && !job ? messages.filter((m) => m.role === "user").at(-1) : null;
  const ordered = introduction ? [introduction, ...messages.filter((m) => m !== introduction)] : messages;
  for (const message of ordered) {
    const evidence = [message.role, message.text];
    if (message.attachments?.length) evidence.push(message.attachments);
    const report = add("message:" + message.reportSource, message.reportSource,
      evidence, conversationMessageText(message).trim());
    report.label = message.role === "user" ? "依頼" : "返答";
  }
  if (!candidates.length)
    add("introduction:" + chat.id, job?.id || chat.id, [job?.title || chat.title], job
      ? "「" +
        clean(job.title) +
        "」を担当しています。まとまったら、ここでお知らせします。"
      : "まだお話はこれからです。何から始めましょうか。");
  const candidate = candidates.find((item) => heard[item.key] !== item.version);
  const text = candidate?.text || "前にお話ししたところから、まだ新しい報告はありません。";
  return {
    ...candidate,
    version: candidate?.version || baseline?.version,
    source: candidate?.source || baseline?.source || chat.id,
    text: current && candidate !== current ? context + (candidate ? "以前の記録からお伝えします。" : "") + text : text,
    conversationId: chat.id,
    kind: candidate?.kind || "report",
    label: candidate?.label || (candidate?.kind === "question" ? "確認事項" : "進捗"),
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
      "話の種ですが、「" +
      clean(from.name) +
      "」で考えたことは「" +
      clean(to.name) +
      "」でも役に立つでしょうか。向こうの話も聞いてみたいですね。",
  };
}
