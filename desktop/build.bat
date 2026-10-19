@echo off
REM Builds dist\DocTranslate\DocTranslate.exe. Run from a clean virtual environment:
REM   python -m venv .venv && .venv\Scripts\activate && pip install -r requirements-dev.txt
pyinstaller --noconfirm --windowed --name DocTranslate ^
  --collect-all customtkinter ^
  --collect-all tkinterdnd2 ^
  main.py
