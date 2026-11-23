#!/bin/sh
# Open a fresh, sample-only A2ACraft window from the user's Mac desktop.
set -eu
umask 077
cd -P -- "$(dirname -- "$0")"
here=$PWD
app="$here/A2ACraft.app"
if [ ! -d "$app" ]; then app="$here/mac-arm64/A2ACraft.app"; fi
if [ ! -d "$app" ]; then app="/Applications/A2ACraft.app"; fi
run=$(/usr/bin/mktemp -d "$here/mac-walk-XXXXXX" 2>/dev/null) ||
  run=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/a2acraft-walk-XXXXXX")
run=$(cd -P -- "$run" && pwd -P)
log="$run/startup.txt"
profile="$run/sample"
recording="$profile/recording"
report="$recording/result.json"
echo "今回の録画先: $run"
fail() {
  echo "$1" | /usr/bin/tee -a "$log" >&2
  echo "$log" >&2
  exit 1
}
info="$app/Contents/Info.plist"
[ -f "$info" ] || fail 'A2ACraft.app を「アプリケーション」またはこのファイルと同じフォルダに置いてから開いてください。'
entry=$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$info") || fail '起動ファイル名を読み取れませんでした。'
version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$info") || fail 'バージョンを読み取れませんでした。'
identifier=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$info") || fail 'アプリの識別子を確認できません。'
case "$identifier/$entry" in
  com.thinksyncs.chatui/A2ACraft|com.thinksyncs.chatui.tauri/chat-ui-tauri) ;;
  *) fail 'A2ACraft の起動ファイルを確認できません。' ;;
esac
[ -x "$app/Contents/MacOS/$entry" ] || fail 'A2ACraft の起動ファイルを確認できません。'
{
  echo "A2ACraft $version ($app)"
  /usr/bin/sw_vers -productVersion
  /usr/bin/file -b "$app/Contents/MacOS/$entry"
} > "$log"
/usr/bin/codesign --verify --deep --strict "$app" >> "$log" 2>&1 || fail 'アプリの署名検査でエラーがありました。'
echo 'サンプルの村を開きます。地図での会話と仲間の立ち話が終わるまで、ウィンドウを開いておいてください。'
if /usr/bin/open -n --stderr "$run/app-stderr.txt" "$app" --args --demo --record-sample-walk "--preview-data-dir=$profile" >> "$log" 2>&1; then
  echo 'Launch Services accepted the application' >> "$log"
else
  status=$?
  echo "Launch Services exited $status" >> "$log"
  /bin/cat "$log" >&2
  exit "$status"
fi
elapsed=0
while [ ! -s "$report" ] && [ "$elapsed" -lt 420 ]; do
  /bin/sleep 2
  elapsed=$((elapsed + 2))
done
[ -s "$report" ] || fail '起動は受理されましたが、Macアプリから録画結果が届きませんでした。'
status=$(/usr/bin/plutil -extract status raw -o - "$report") || fail '録画結果を読み取れませんでした。'
echo "Recorder: $status" >> "$log"
if [ "$status" != verified ]; then
  if stage=$(/usr/bin/plutil -extract stage raw -o - "$report" 2>/dev/null); then
    echo "録画が止まった場面: $stage" | /usr/bin/tee -a "$log" >&2
  fi
  /usr/bin/plutil -extract reason raw -o - "$report" | /usr/bin/tee -a "$log" >&2
  exit 1
fi

# Build a self-contained local player next to the original images. Only frame
# names, phases and timings are read. The captured pixels stay intact.
frames="$run/frames.txt"
: > "$frames"
index=0
seen=" "
while filename=$(/usr/bin/plutil -extract "frames.$index.file" raw -o - "$report" 2>/dev/null); do
  [ "$index" -lt 250 ] || fail '録画枚数が上限を超えました。'
  case "$filename" in overview.jpg|frame-[0-9][0-9][0-9].jpg) ;; *) fail '録画の画像名を確認できませんでした。';; esac
  [ -s "$recording/$filename" ] || fail '録画結果に対応する画像が見つかりませんでした。'
  phase=$(/usr/bin/plutil -extract "frames.$index.phase" raw -o - "$report") || fail '録画の場面名がありません。'
  at=$(/usr/bin/plutil -extract "frames.$index.atMs" raw -o - "$report") || fail '録画時刻がありません。'
  case "$phase" in ''|*[!a-z0-9-]*) fail '録画の場面名が不正です。';; esac
  case "$at" in ''|*[!0-9]*) fail '録画時刻が不正です。';; esac
  printf '["%s","%s",%s],\n' "$filename" "$phase" "$at" >> "$frames"
  case "$seen" in *" $phase "*) ;; *) seen="$seen$phase ";; esac
  index=$((index + 1))
done
for phase in walk arrival chat-input chat-reply ambient; do
  case "$seen" in *" $phase "*) ;; *) fail "録画に $phase の場面がありません。";; esac
done
player="$recording/村の散策と会話.html"
{
  /bin/cat <<'HTML'
<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>A2ACraft・村の散策と会話</title>
<style>body{margin:0;background:#162126;color:#f5f2e8;font:16px system-ui}main{max-width:1280px;margin:auto}img{display:block;width:100%;max-height:82vh;object-fit:contain}nav{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.6rem}button{padding:.5rem .75rem;font:inherit}output{margin-left:auto}</style>
<main><img id="scene" alt="A2ACraftの録画"><nav aria-label="再生操作"><button id="play">一時停止</button><button data-phase="walk">歩行</button><button data-phase="chat-input">地図でチャット</button><button data-phase="ambient">仲間の立ち話</button><output></output></nav></main>
<script>const frames=[
HTML
  /bin/cat "$frames"
  /bin/cat <<'HTML'
];const image=document.querySelector('img'),play=document.querySelector('#play'),out=document.querySelector('output');
const names={overview:'村の全体',walk:'小道を歩行',arrival:'村人に到着','chat-input':'地図で入力','chat-reply':'村人の返答',ambient:'仲間の立ち話'};
let index=0,running=true,timer;
function show(){
  clearTimeout(timer);const [file,phase,at]=frames[index];image.src=file;out.textContent=names[phase]||'村の散策';
  play.textContent=running?'一時停止':index===frames.length-1?'もう一度':'再生';
  if(!running)return;
  const next=frames[index+1];if(!next){running=false;play.textContent='もう一度';return;}
  const hold=phase.startsWith('chat')||phase==='ambient'?1800:phase==='arrival'?1000:50;
  timer=setTimeout(()=>{index++;show();},Math.max(hold,Math.min(3500,next[2]-at)));
}
play.onclick=()=>{if(!running&&index===frames.length-1)index=0;running=!running;show();};
for(const button of document.querySelectorAll('[data-phase]'))button.onclick=()=>{index=frames.findIndex(f=>f[1]===button.dataset.phase);running=true;show();};
show();</script></html>
HTML
} > "$player"
echo "録画完了。次のファイルを開いて再生できます。"
echo "$player"
