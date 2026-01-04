@echo off
REM Batch Test Runner for Minigame Videos
REM Run with: run-batch-tests.bat
REM Automatically discovers and runs tests for minigame_{X}-{S}_{E}.mp4 files

cd /d "%~dp0"

if not exist "%~dp0node_modules" (
    echo Error: node_modules not found. Please run: npm install
    exit /b 1
)

node run-batch-tests.js
pause
