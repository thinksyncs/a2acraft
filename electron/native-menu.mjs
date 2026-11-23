export function systemInterfaceLanguage(locales) {
  for (const locale of locales) {
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (base === 'ja' || base === 'en') return base;
  }
  return 'en';
}

export function nativeMenuTemplate({platform, text, reload, recover, diagnose, reading}) {
  return [
    ...(platform === 'darwin' ? [{role:'appMenu'}] : []),
    {label:text('編集','Edit'), submenu:[
      {role:'undo'}, {role:'redo'}, {type:'separator'}, {role:'cut'}, {role:'copy'}, {role:'paste'}, {role:'selectAll'}
    ]},
    {label:text('表示','View'), submenu:[
      {id:'saved-reload', label:text('画面を再読み込み','Reload Window'), accelerator:'CmdOrCtrl+R', click:reload},
      {role:'resetZoom'}, {role:'zoomIn'}, {role:'zoomOut'}, {role:'togglefullscreen'},
      ...(reading ? [{type:'separator'}, reading] : [])
    ]},
    {label:text('ウィンドウ','Window'), submenu:[
      {id:'recover-window', label:text('表示を復帰','Restore Window'), click:recover},
      {id:'diagnose-window', label:text('表示の診断','Window Diagnostics'), click:diagnose},
      {type:'separator'}, {role:'minimize'}, {role:'close'}
    ]}
  ];
}
