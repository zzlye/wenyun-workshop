@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo 请先安装 Node.js 22 或更新的 LTS 版本，然后重新双击此文件。
    echo 下载地址：https://nodejs.org/zh-cn/download
    pause
    exit /b 1
)
node launcher.mjs
if errorlevel 1 echo 启动未完成，请查看上面的错误信息。
pause
