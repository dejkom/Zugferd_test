@echo off
title ZUGFeRD ^& Factur-X Studio
cd /d "%~dp0"
echo ============================================================
echo   Starting ZUGFeRD ^& Factur-X Studio Web Server...
echo ============================================================
echo.
echo URL: http://localhost:8000/ (or your network IP e.g. http://10.36.54.226:8000/)
echo.
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
pause
