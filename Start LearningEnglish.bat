@echo off
rem Double-click to start the app. Keep this window open while you practise; close it to stop the app.
cd /d "%~dp0"
title LearningEnglish - keep this window open
start "" http://localhost:8000
python server.py 8000
if errorlevel 1 (
  echo.
  echo Could not start the app. If it is already running, just open http://localhost:8000
  pause
)
