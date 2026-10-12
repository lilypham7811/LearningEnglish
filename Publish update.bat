@echo off
rem Double-click after the app is changed: sends the new version to GitHub.
rem The online app updates in about 1-2 minutes.
cd /d "%~dp0"
"C:\Program Files\Git\cmd\git.exe" add -A
"C:\Program Files\Git\cmd\git.exe" commit -m "Update app"
"C:\Program Files\Git\cmd\git.exe" push origin main
echo.
echo Done. The online app updates in about 1-2 minutes: https://lilypham7811.github.io/LearningEnglish/
pause
