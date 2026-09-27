"""Trusted cloud wrapper: install the fixed renderer, render, upload one scoped MP4."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

directory=Path(sys.argv[1]).resolve()
def status(**value):
    temporary=directory/"status.tmp"
    temporary.write_text(json.dumps(value),encoding="utf-8")
    temporary.replace(directory/"status.json")
try:
    status(status="rendering",message="Installing the cloud video renderer.")
    with (directory/"setup.log").open("w") as log:
        subprocess.run(["sudo","apt-get","update"],check=True,stdout=log,stderr=log,timeout=120)
        subprocess.run(["sudo","apt-get","install","-y","build-essential","ffmpeg","libcairo2-dev","libpango1.0-dev","pkg-config","python3-dev","python3-venv","texlive-latex-extra","texlive-fonts-recommended","texlive-science","dvisvgm","espeak-ng","fonts-liberation"],check=True,stdout=log,stderr=log,timeout=600)
        subprocess.run(["python3","-m","venv",str(directory/"venv")],check=True,stdout=log,stderr=log,timeout=60)
        subprocess.run([str(directory/"venv/bin/python"),"-m","pip","install","manim==0.21.0"],check=True,stdout=log,stderr=log,timeout=300)
    with (directory/"render.log").open("w") as log:
        subprocess.run([str(directory/"venv/bin/python"),str(Path(__file__).with_name("render-explanation.py")),str(directory)],check=True,stdout=log,stderr=log,timeout=900)
    rendered=json.loads((directory/"status.json").read_text(encoding="utf-8"))
    status(status="rendering",message="Saving your video to your account.")
    movie=directory/"explanation.mp4"
    if movie.stat().st_size>50*1024*1024: raise RuntimeError("This video exceeds the current 50 MB upload limit. Try a shorter explanation.")
    upload=json.loads((directory/"upload.json").read_text(encoding="utf-8"))
    request=urllib.request.Request(upload["url"],data=movie.read_bytes(),method="PUT",headers={"Content-Type":"video/mp4","cache-control":"3600"})
    with urllib.request.urlopen(request,timeout=120) as response:
        if response.status>=300: raise RuntimeError("The video could not be saved to cloud storage.")
    status(status="ready",cloudUploaded=True,narration=rendered.get("narration",False),message="Your cloud explanation video is ready.")
except Exception as error:
    # Do not log the signed upload URL or credential-bearing exception text.
    previous=json.loads((directory/"status.json").read_text(encoding="utf-8"))
    message=previous.get("message") if previous.get("status")=="error" else "Cloud video rendering or upload failed. Your question and simulations are saved; retry the video."
    status(status="error",message=message)
    sys.exit(1)
