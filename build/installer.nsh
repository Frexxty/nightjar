; Nightjar additions to electron-builder's assisted NSIS installer.
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

  Var NightjarDeleteDataCheckbox
  Var NightjarDeleteData

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.NightjarDataPageShow un.NightjarDataPageLeave
  !macroend

  Function un.NightjarDataPageShow
    !insertmacro MUI_HEADER_TEXT "Your Nightjar data" "Choose whether to keep your settings."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "Nightjar keeps your settings, backend connection and listening history in your user profile. Keep them if you might install Nightjar again."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "Also delete my Nightjar settings and data"
    Pop $NightjarDeleteDataCheckbox
    ${NSD_SetState} $NightjarDeleteDataCheckbox ${BST_UNCHECKED}
    nsDialogs::Show
  FunctionEnd

  Function un.NightjarDataPageLeave
    ${NSD_GetState} $NightjarDeleteDataCheckbox $NightjarDeleteData
  FunctionEnd

  !macro customUnInstall
    ${ifNot} ${isUpdated}
    ${andIf} $NightjarDeleteData == ${BST_CHECKED}
      ; Electron keeps per-user data under %APPDATA% even for per-machine installs.
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ; Installs from before the rename keep using this folder (electron/profile.cjs).
      RMDir /r "$APPDATA\Stratus"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endIf}
  !macroend
!endif
