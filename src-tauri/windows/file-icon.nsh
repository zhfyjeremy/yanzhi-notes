; .md / .markdown 使用独立文件图标,不占用应用 exe 的图标索引。
; Tauri 的 APP_ASSOCIATE 会把 DefaultIcon 写成 exe,0;本钩子在它之后改回 file-icon.ico。
; 关联名与 tauri.conf.json 里 fileAssociations.name 一致。

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Markdown\DefaultIcon" "" "$\"$INSTDIR\file-icon.ico$\""
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
