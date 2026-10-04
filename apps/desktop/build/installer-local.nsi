; ULTRALINK desktop installer (stand-alone NSIS script; builds on Linux/macOS/Windows without wine)
; usage: makensis -DVERSION=1.5.0 -DSRC=dist/win-unpacked -DOUT=dist/ultralink-desktop-setup.exe build/installer-local.nsi
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
Name "ULTRALINK"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\ULTRALINK"
InstallDirRegKey HKCU "Software\ULTRALINK" "InstallDir"
RequestExecutionLevel user
BrandingText "ULTRALINK ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "ULTRALINK"
VIAddVersionKey "FileDescription" "ULTRALINK desktop setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "ULTRALINK"
VIAddVersionKey "LegalCopyright" "ULTRALINK"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\ULTRALINK.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ULTRALINK"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  nsExec::Exec 'taskkill /F /IM ULTRALINK.exe'
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall ULTRALINK.exe"
  CreateShortcut "$DESKTOP\ULTRALINK.lnk" "$INSTDIR\ULTRALINK.exe"
  CreateShortcut "$SMPROGRAMS\ULTRALINK.lnk" "$INSTDIR\ULTRALINK.exe"
  WriteRegStr HKCU "Software\ULTRALINK" "InstallDir" "$INSTDIR"
  !define UK "Software\Microsoft\Windows\CurrentVersion\Uninstall\ULTRALINK"
  WriteRegStr HKCU "${UK}" "DisplayName" "ULTRALINK"
  WriteRegStr HKCU "${UK}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UK}" "Publisher" "ULTRALINK"
  WriteRegStr HKCU "${UK}" "DisplayIcon" "$INSTDIR\ULTRALINK.exe"
  WriteRegStr HKCU "${UK}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UK}" "UninstallString" '"$INSTDIR\Uninstall ULTRALINK.exe"'
  WriteRegDWORD HKCU "${UK}" "NoModify" 1
  WriteRegDWORD HKCU "${UK}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM ULTRALINK.exe'
  Delete "$DESKTOP\ULTRALINK.lnk"
  Delete "$SMPROGRAMS\ULTRALINK.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ULTRALINK"
  DeleteRegKey HKCU "Software\ULTRALINK"
SectionEnd
