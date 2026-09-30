@echo off
title ZUGFeRD ^& Factur-X Studio
cd /d "%~dp0"
echo ============================================================
echo   Starting ZUGFeRD ^& Factur-X Studio Web Server...
echo ============================================================
echo.
echo URL: http://127.0.0.1:8000/
echo.
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
pause
