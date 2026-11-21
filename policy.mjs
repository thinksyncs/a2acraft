// Fail closed: unknown quota is never interpreted as unused quota.
export function checkPlan(account, payload, reserve = 5) {
  if (account?.type !== 'chatgpt') return {ok:false,reason:'ChatGPTアカウントでログインしてください。APIキー接続は利用できません。'};
  const buckets = payload?.rateLimitsByLimitId ? Object.values(payload.rateLimitsByLimitId) : payload?.rateLimits ? [payload.rateLimits] : [];
  const quotaBlock = (reason, quota = {}) => ({ok:false, reason, quota});
  if (!buckets.length) return quotaBlock('利用枠を取得できません。更新してから送信してください。');
  let count=0;
  for (const [bucketIndex, bucket] of buckets.entries()) {
    if (!bucket || typeof bucket !== 'object') return quotaBlock('利用枠の値を確認できません。');
    const slots = ['primary','secondary'];
    // A provider can report a limit without identifying a window. Only point
    // to a window here if its own reported usage independently hits the reserve.
    if (bucket.rateLimitReachedType) {
      const slot = slots.find(key => {
        const used = bucket[key]?.usedPercent;
        return Number.isFinite(used) && used >= 100-reserve && used <= 100;
      });
      return quotaBlock('利用上限に達しています。リセット後に更新してください。', slot ? {bucketIndex,slot} : {});
    }
    for (const slot of slots) {
      const w = bucket[slot];
      if (!w) continue;
      count++;
      if (!Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return quotaBlock('利用枠の値を確認できません。');
      if (!Number.isFinite(w.resetsAt) || w.resetsAt*1000 <= Date.now()) return quotaBlock('利用枠の更新待ちです。最新の残量を再取得してください。');
      if (w.usedPercent >= 100-reserve) return quotaBlock(`残枠が${reserve}%以下のため、新規送信を停止しています。`, {bucketIndex,slot});
    }
  }
  return count ? {ok:true,reason:''} : quotaBlock('契約の残枠が未取得です。追加クレジットだけでは開始しません。');
}
