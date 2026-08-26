@echo off
setlocal
chcp 65001 >nul
echo Starting the ContextWeave Skill updater...

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Update failed: Node.js was not found. Follow https://skillhub.cn/install/skillhub.md.
  set "UPDATE_EXIT_CODE=1"
  goto :finish
)

node.exe "%~dp0update_skill.cjs" %*
set "UPDATE_EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if not "%CONTEXTWEAVE_UPDATE_NO_PAUSE%"=="1" pause
exit /b %UPDATE_EXIT_CODE%
