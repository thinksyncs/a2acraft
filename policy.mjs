// Fail closed: unknown quota is never interpreted as unused quota.
export function checkPlan(account, payload, reserve = 5) {
  if (account?.type !== 'chatgpt') return {ok:false,reason:'ChatGPTアカウントでログインしてください。APIキー接続は利用できません。'};
  const buckets = payload?.rateLimitsByLimitId ? Object.values(payload.rateLimitsByLimitId) : payload?.rateLimits ? [payload.rateLimits] : [];
  if (!buckets.length) return {ok:false,reason:'利用枠を取得できません。更新してから送信してください。'};
  let count=0;
  for (const bucket of buckets) {
    if (bucket.rateLimitReachedType) return {ok:false,reason:'利用上限に達しています。リセット後に更新してください。'};
    for (const w of [bucket.primary,bucket.secondary].filter(Boolean)) {
      count++;
      if (!Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return {ok:false,reason:'利用枠の値を確認できません。'};
      if (!Number.isFinite(w.resetsAt) || w.resetsAt*1000 <= Date.now()) return {ok:false,reason:'利用枠の更新待ちです。最新の残量を再取得してください。'};
      if (w.usedPercent >= 100-reserve) return {ok:false,reason:`残枠が${reserve}%以下のため、新規送信を停止しています。`};
    }
  }
  return count ? {ok:true,reason:''} : {ok:false,reason:'契約の残枠が未取得です。追加クレジットだけでは開始しません。'};
}
