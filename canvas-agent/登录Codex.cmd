@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "node_modules\@openai\codex\bin\codex.js" (
    echo 请先双击“启动画布助手.cmd”，等待依赖准备完成后再登录。
    pause
    exit /b 1
)
node "node_modules\@openai\codex\bin\codex.js" login
if errorlevel 1 (
    echo 登录未完成，请查看上方提示后重试。
) else (
    echo 登录完成。请回到画布连接助手；如果已经连接，请断开后重新连接。
)
pause
