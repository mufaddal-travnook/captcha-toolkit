@echo off
REM ---------------------------------------------------------------------------
REM tunnel.bat — keep an SSH reverse SOCKS tunnel up on your HOME machine.
REM
REM   home machine  --(SOCKS server on :1081)
REM   EC2 :1080     --(reverse-forward)-->  home :1081  -->  internet (home IP)
REM
REM Prereqs (run ONCE, in a separate window, and leave running):
REM   pip install pproxy
REM   pproxy -l socks5://127.0.0.1:1081
REM
REM Then run THIS file. It reconnects automatically whenever the tunnel drops.
REM Edit the three values below to match your setup.
REM ---------------------------------------------------------------------------

set KEY=C:\Users\Universal\Downloads\private_key.pem
set EC2=ubuntu@54.67.67.128
set FORWARD=1080:127.0.0.1:1081

:loop
echo [%date% %time%] Connecting tunnel %FORWARD% to %EC2% ...
ssh -i "%KEY%" ^
  -o ServerAliveInterval=30 ^
  -o ServerAliveCountMax=3 ^
  -o ExitOnForwardFailure=yes ^
  -o StrictHostKeyChecking=accept-new ^
  -N -R %FORWARD% %EC2%
echo [%date% %time%] Tunnel dropped (exit code %errorlevel%). Reconnecting in 5s...
timeout /t 5 /nobreak >nul
goto loop
