@echo off
cd /d "%~dp0"

echo ============================================
echo   准备演示数据
echo ============================================
echo.
echo   先确认 start.bat 那个窗口还开着（服务在跑）。
echo.

node scripts\seed-demo.js 10
if errorlevel 1 goto failed

node scripts\demo-seed.js
if errorlevel 1 goto failed

echo.
echo   完成。回到浏览器按 F5 刷新。
echo   点餐页右下角那个绿色气泡就是「点餐搭档」。
echo.
pause
exit /b 0

:failed
echo.
echo   出错了。最常见的原因是服务没启动，先双击 start.bat。
echo.
pause
exit /b 1
