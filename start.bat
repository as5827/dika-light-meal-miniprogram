@echo off
cd /d "%~dp0"

echo ============================================
echo   低卡轻食点餐系统
echo ============================================
echo.
echo   顾客端点餐页   http://localhost:3000
echo   商家后台       http://localhost:3000/admin   (admin / dika2026)
echo.
echo   正在启动服务，3 秒后自动打开浏览器...
echo   关闭这个窗口 = 停止服务。
echo.

start "" /b node server\server.js
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/"

echo   已启动。录演示视频请再双击「准备演示数据.bat」。
echo.
pause
