@echo off
chcp 65001 >nul
title wger 减脂健身网站
cd /d "%~dp0main"
set DJANGO_SETTINGS_MODULE=settings.local_dev
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo.
echo  正在启动 wger 减脂健身网站（默认中文）...
echo  启动后请用浏览器打开: http://127.0.0.1:8000
echo  关闭此窗口即停止网站。
echo.
.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
pause