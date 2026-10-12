@echo off
rem Copies just the app files into the "github-upload" folder and opens it.
rem Then drag everything inside that folder onto the GitHub "Upload files" page.
cd /d "%~dp0"
if exist github-upload rmdir /s /q github-upload
mkdir github-upload\icons
copy /y index.html github-upload\ >nul
copy /y styles.css github-upload\ >nul
copy /y app.js github-upload\ >nul
copy /y live.js github-upload\ >nul
copy /y library.js github-upload\ >nul
copy /y dialogs.js github-upload\ >nul
copy /y manifest.webmanifest github-upload\ >nul
copy /y sw.js github-upload\ >nul
copy /y icons\*.png github-upload\icons\ >nul
echo Ready: drag everything inside the github-upload folder onto GitHub.
start "" explorer "%~dp0github-upload"
