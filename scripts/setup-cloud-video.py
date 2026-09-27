"""Prepare a reusable renderer image; contains no question data or upload tokens."""
from pathlib import Path
import subprocess

runtime = Path('/vercel/sandbox/video-runtime')
runtime.mkdir(parents=True, exist_ok=True)
with (runtime / 'setup.log').open('w') as log:
    subprocess.run(['sudo', 'apt-get', 'update'], check=True, stdout=log, stderr=log, timeout=120)
    subprocess.run(['sudo', 'apt-get', 'install', '-y', 'build-essential', 'ffmpeg', 'libcairo2-dev', 'libpango1.0-dev', 'pkg-config', 'python3-dev', 'python3-venv', 'texlive-latex-extra', 'texlive-fonts-recommended', 'texlive-science', 'dvisvgm', 'espeak-ng', 'fonts-liberation'], check=True, stdout=log, stderr=log, timeout=600)
    subprocess.run(['python3', '-m', 'venv', str(runtime / 'venv')], check=True, stdout=log, stderr=log, timeout=60)
    subprocess.run([str(runtime / 'venv/bin/python'), '-m', 'pip', 'install', 'manim==0.21.0'], check=True, stdout=log, stderr=log, timeout=300)
    subprocess.run([str(runtime / 'venv/bin/python'), '-c', 'from manim import MathTex; MathTex(r"x^2")'], check=True, cwd=runtime, stdout=log, stderr=log, timeout=60)
(runtime / 'ready').write_text('manim-0.21.0-v1', encoding='utf-8')
print('Cloud renderer environment ready.')
