; Stratus additions to electron-builder's assisted NSIS installer.
;
; The uninstaller gets a page with an unticked "also delete my settings"
; checkbox. Settings stay by default, and an update (which runs the old
; uninstaller silently with --updated) never shows the page, so it never
; deletes anything.

!ifdef BUILD_UNINSTALLER
  ; electron-builder includes this file before MUI2, but the page below uses its macros.
  !include MUI2.nsh
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var StratusDeleteDataCheckbox
  Var StratusDeleteData

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.StratusDataPageShow un.StratusDataPageLeave
  !macroend

  Function un.StratusDataPageShow
    !insertmacro MUI_HEADER_TEXT "Your Stratus data" "Choose whether to keep your settings."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "Stratus keeps your settings, backend connection and listening history in your user profile. Keep them if you might install Stratus again."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "Also delete my Stratus settings and data"
    Pop $StratusDeleteDataCheckbox
    ${NSD_SetState} $StratusDeleteDataCheckbox ${BST_UNCHECKED}
    nsDialogs::Show
  FunctionEnd

  Function un.StratusDataPageLeave
    ${NSD_GetState} $StratusDeleteDataCheckbox $StratusDeleteData
  FunctionEnd

  !macro customUnInstall
    ${ifNot} ${isUpdated}
    ${andIf} $StratusDeleteData == ${BST_CHECKED}
      ; Electron keeps per-user data under %APPDATA% even for per-machine installs.
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endIf}
  !macroend
!endif
