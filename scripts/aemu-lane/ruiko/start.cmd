@echo off
rem Lane emulator start (StaticForge scripts/aemu-lane/lane.sh): private SDK root, own AVD home, hidden (started through
rem WMI in session 0, never on Yukimi's desktop).   start.cmd <avd> <console-port> [extra emulator args...]
rem LANE RULE: every start carries -no-audio: a lane emulator never plays through Ruiko's speakers (Yukimi, Nov 26 2026).
set ANDROID_HOME=C:\Users\ykaza\claude-lane\sdk
set ANDROID_SDK_ROOT=C:\Users\ykaza\claude-lane\sdk
set ANDROID_AVD_HOME=C:\Users\ykaza\claude-lane\avd
set ANDROID_EMULATOR_HOME=C:\Users\ykaza\claude-lane\home
cd /d C:\Users\ykaza\claude-lane
"%ANDROID_HOME%\emulator\emulator.exe" -avd %1 -port %2 -no-window -no-audio -no-boot-anim -no-metrics -gpu host -no-snapshot-save %3 %4 %5 %6 %7 %8 %9 > C:\Users\ykaza\claude-lane\logs\%1.txt 2>&1
