@echo off
set "DIRETORIO=%CD%"
echo Diretorio atual: %DIRETORIO%
echo.
echo Iniciando servidor...
echo.

:try_port
set /a port=8080
echo Tentando porta %port%...
echo.
echo Acesse: http://localhost:%port%
echo.
echo Listando arquivos no diretorio:
dir
echo.

:start_server
npx http-server . -p %port% --cors
if errorlevel 1 (
    set /a port+=1
    echo Porta %port% em uso, tentando proxima porta...
    goto start_server
)

pause 