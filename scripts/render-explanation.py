"""Fixed Manim template. Input is validated data, never AI-generated Python."""
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import textwrap
import wave
from video_layout import place_caption, diagram_bounds

from manim import (Scene, Text, MathTex, VGroup, Circle, Rectangle, Line, Arrow,
                   FadeIn, FadeOut, Write, Create, ValueTracker, always_redraw,
                   VMobject, Triangle, config, tempconfig, linear, UP, DOWN, LEFT, RIGHT)
import numpy as np

directory = Path(sys.argv[1]).resolve()
payload = json.loads((directory / "input.json").read_text(encoding="utf-8"))
scene = payload["scene"]
frames = payload["frames"]
GREEN = "#17362E"
CREAM = "#F2EBDD"
MINT = "#86D9B0"
GOLD = "#E8C875"

def status(**value):
    temporary = directory / "status.tmp"
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(directory / "status.json")

def paragraph(text, width=62, size=23, color=CREAM, max_width=12):
    lines = []
    for line in str(text).splitlines():
        lines.extend(textwrap.wrap(line, width=width) or [""])
    result = Text("\n".join(lines), font="Arial", font_size=size, color=color, line_spacing=0.85)
    if result.width > max_width:
        result.scale_to_fit_width(max_width)
    return result

ALLOWED_TEX = set("frac sqrt sin cos tan theta omega alpha beta gamma delta Delta pi exp log ln dot ddot text mathrm left right cdot times vec tau mu rho epsilon phi sigma int sum infty leq geq partial begin end aligned cases quad qquad max min approx lambda nu eta kappa nabla pm degree percent dfrac tfrac overline hat underbrace rightarrow leftarrow leftrightarrow rightleftharpoons".split())
def equation(source):
    # TeX commands outside this mathematical vocabulary are never compiled.
    commands = re.findall(r"\\([A-Za-z]+)", source)
    environments=re.findall(r"\\(?:begin|end)\s*\{([^}]+)\}",source)
    if all(command in ALLOWED_TEX for command in commands) and all(name in ("aligned","cases") for name in environments) and len(source) <= 400 and "^^" not in source and not re.search(r"[#~]|(?<!\\)%", source):
        try:
            result = MathTex(source, font_size=31, color=GOLD)
            if result.width > 5.8:
                result.scale_to_fit_width(5.8)
            return result
        except Exception:
            pass
    # Never expose raw LaTeX when an unsupported formula cannot be typeset.
    return paragraph("Equation could not be typeset", width=40, size=18, color=GOLD, max_width=5.8)

def audio_duration(index, default):
    file = directory / f"voice-{index}.wav"
    if file.exists():
        with wave.open(str(file), "rb") as voice:
            return voice.getnframes() / voice.getframerate()
    return default

class Explanation(Scene):
    def construct(self):
        self.camera.background_color = GREEN
        brand = Text("Chalk", font="Segoe Print", font_size=25, color=MINT).to_corner(UP + LEFT, buff=0.3)
        self.add(brand)
        motion=payload.get("motionPresentation",{})
        if motion.get("rate",1)<1:
            notice=Text(f"Motion display slowed {1/motion['rate']:.0f}x; actual frequency {motion['frequencyHz']:.1f} Hz",font="Arial",font_size=12,color=MINT).to_corner(DOWN+LEFT,buff=.3)
            self.add(notice)
        title = paragraph(scene["title"], width=45, size=37).move_to([0, 2.3, 0])
        if title.height > 1: title.scale_to_fit_height(1)
        problem = paragraph(scene["problemText"], width=76, size=25).move_to([0, 0.4, 0])
        if problem.height > 3.4: problem.scale_to_fit_height(3.4)
        footer = Text("Understand the solution, then explore the simulation",font="Arial",font_size=18,color=MINT).move_to([0,-2.8,0])
        self.play(Write(title), FadeIn(problem), FadeIn(footer), run_time=1)
        self.voice(0)
        self.wait(max(3, audio_duration(0, 6)))
        self.play(FadeOut(title), FadeOut(problem), FadeOut(footer), run_time=0.5)

        positions = np.array([[o["position"] for o in frame["objects"]] for frame in frames])
        projected = positions[:, :, :2].copy()
        projected[:, :, 0] += 0.35 * positions[:, :, 2]
        projected[:, :, 1] += 0.15 * positions[:, :, 2]
        extents=np.array([[obj["size"]["radius"] if obj["shape"] in ("sphere","planet","pendulumBob","pulley") else obj["size"]["x"]/2,
                           obj["size"]["radius"] if obj["shape"] in ("sphere","planet","pendulumBob","pulley") else (0 if obj["shape"]=="plane" else obj["size"]["y"]/2)] for obj in scene["objects"]])
        frame_scales=np.array([[o.get("scale",[1,1,1])[:2] for o in frame["objects"]] for frame in frames])
        extents=extents*frame_scales
        # Frame the experiment, not the much larger decorative bench/floor.
        visible=np.array([[o["visible"] for o in frame["objects"]] for frame in frames],dtype=bool)
        lower,upper=diagram_bounds(projected,extents,visible,[o["shape"] for o in scene["objects"]])
        span = np.maximum(upper-lower, .6)
        scale = min(5.5/span[0], 3.3/span[1])
        middle = (lower+upper)/2
        tracker = ValueTracker(0)

        def point(position):
            xy = np.array([position[0]+0.35*position[2], position[1]+0.15*position[2]])
            return np.array([(xy[0]-middle[0])*scale-3.6, (xy[1]-middle[1])*scale+0.2,0])

        pieces=[]
        body_dimensions=[]
        body_angles=[]
        for obj in scene["objects"]:
            color=obj["color"] if re.fullmatch(r"#[0-9a-fA-F]{6}",obj["color"]) else MINT
            size=obj["size"]
            if obj["id"] == "orbitPlane":
                body=Circle(radius=max(.05,size["radius"]*scale),color=color,fill_opacity=0)
            elif obj["shape"] == "plane":
                body=Line([-min(2,size["x"]*scale/2),0,0],[min(2,size["x"]*scale/2),0,0],color=color)
            elif obj["shape"] == "capacitor":
                body=VGroup(Line([-.4,0,0],[-.1,0,0],color=color),Line([.1,0,0],[.4,0,0],color=color),Line([-.1,-.25,0],[-.1,.25,0],color=color),Line([.1,-.25,0],[.1,.25,0],color=color))
            elif obj["shape"] in ("resistor","inductor"):
                body=VMobject(color=color).set_points_as_corners([[-.4+i*.08,0 if i in (0,10) else (.12 if i%2 else -.12),0] for i in range(11)])
            elif obj["shape"] in ("sphere","planet","pendulumBob","pulley"):
                body=Circle(radius=max(0.05,size["radius"]*scale),color=color,fill_opacity=0.6)
            elif obj["shape"] == "cone":
                body=Triangle(color=color,fill_opacity=.6).stretch_to_fit_width(max(.12,size["radius"]*2*scale)).stretch_to_fit_height(max(.08,size["y"]*scale))
            else:
                body=Rectangle(width=max(0.12,size["x"]*scale),height=max(0.08,size["y"]*scale),color=color,fill_opacity=0.3)
            # Projection can put a falling ball over its support. Apparatus must
            # not paint over the moving body simply because it appears later in JSON.
            body.set_z_index(20 if obj["shape"] in ("sphere","planet","pendulumBob") else 0)
            label=Text(obj["label"],font="Arial",font_size=14,color=CREAM) if obj["label"] else VGroup()
            if label.width>2: label.scale_to_fit_width(2)
            if obj["label"]: label.add_background_rectangle(color=GREEN,opacity=.95,buff=.05)
            label.set_z_index(40)
            pieces.append((body,label))
            body_dimensions.append((body.width,body.height))
            body_angles.append(0)
        leaders=[Line([0,0,0],[.01,0,0],color=MINT,stroke_width=1).set_z_index(30) for _ in pieces]
        connections=[(connector,VMobject(color=CREAM,stroke_width=2)) for connector in scene["connectors"]]

        def update_diagram(group):
            t = tracker.get_value()
            progress = np.clip(t/scene["duration"]*240,0,240)
            a = int(progress)
            b = min(a+1,240)
            blend = progress-a
            for index, obj in enumerate(scene["objects"]):
                first = frames[a]["objects"][index]
                position = (1-blend)*np.array(first["position"])+blend*np.array(frames[b]["objects"][index]["position"])
                body,label=pieces[index]
                factors=(1-blend)*np.array(first.get("scale",[1,1,1]))+blend*np.array(frames[b]["objects"][index].get("scale",[1,1,1]))
                original_width,original_height=body_dimensions[index]
                body.rotate(-body_angles[index])
                if original_width>0: body.stretch_to_fit_width(max(.00001,original_width*factors[0]))
                if original_height>0: body.stretch_to_fit_height(max(.00001,original_height*factors[1]))
                angle=(1-blend)*first["rotation"][2]+blend*frames[b]["objects"][index]["rotation"][2]
                body.rotate(angle)
                body_angles[index]=angle
                body.set_opacity(1 if first["visible"] else 0)
                label.set_opacity(1 if first["visible"] else 0)
                body.move_to(point(position))
                if obj["label"]:
                    label.next_to(body,UP,buff=0.08)

            def endpoint(value):
                if value in [o["id"] for o in scene["objects"]]:
                    index=next(i for i,o in enumerate(scene["objects"]) if o["id"]==value)
                    first=frames[a]["objects"][index]
                    if not first["visible"]: return None
                    position=(1-blend)*np.array(first["position"])+blend*np.array(frames[b]["objects"][index]["position"])
                    return point(position)
                return point([float(n) for n in value.split(",")])
            for connector,line in connections:
                start,end=endpoint(connector["from"]),endpoint(connector["to"])
                if start is None or end is None or np.linalg.norm(end-start)<1e-6:
                    line.set_opacity(0);continue
                line.set_opacity(1)
                axis=end-start
                normal=np.array([-axis[1],axis[0],0])/np.linalg.norm(axis)
                count=81 if connector["kind"]=="spring" else 2
                points=[]
                for i in range(count):
                    u=i/(count-1)
                    offset=math.sin(u*math.pi*20)*min(.12,np.linalg.norm(axis)/12) if connector["kind"]=="spring" else 0
                    points.append(start+u*axis+normal*offset)
                line.set_points_as_corners(points)

            # Keep object captions inside the diagram, below the step heading.
            placed=[]
            for leader in leaders: leader.set_opacity(0)
            active=next((step for step in scene["steps"] if step["tStart"]<=t<step["tEnd"]),scene["steps"][-1])
            focus=set(active.get("focus",[]))
            focused_points=[o["id"] for o in scene["objects"] if o["id"] in payload.get("pointIds",[]) and o["id"] in focus]
            if len(focused_points)>3:
                focused_points=[focused_points[0],focused_points[len(focused_points)//2],focused_points[-1]]
            point_focus=set(focused_points)
            repeated=sum(bool(re.match(r"^(marker|tracer) \d+$",obj["label"],re.I)) for obj in scene["objects"])
            named=set()
            order=sorted(range(len(pieces)),key=lambda index: scene["objects"][index]["id"] not in focus)
            for index in order:
                body,label=pieces[index]
                obj=scene["objects"][index]
                if not len(label) or not frames[a]["objects"][index]["visible"]:
                    continue
                if obj["label"] in named or (obj["id"] in payload.get("pointIds",[]) and obj["id"] not in point_focus) or (focus and obj["id"] not in focus):
                    label.set_opacity(0)
                    continue
                named.add(obj["label"])
                if repeated>=4 and re.match(r"^(marker|tracer) \d+$",obj["label"],re.I) and obj["id"] not in focus:
                    label.set_opacity(0)
                    continue
                slot=place_caption(label.get_center()[0],label.get_center()[1],label.width,label.height,placed)
                if slot is None: label.set_opacity(0)
                else:
                    label.move_to([slot[0],slot[1],0])
                    # A short callout preserves the association when captions
                    # need to move sideways to avoid a nearby caption.
                    start=body.get_top()
                    end=label.get_bottom()
                    if np.linalg.norm(end-start)>.14:
                        leaders[index].put_start_and_end_on(start,end).set_opacity(.65)

        # Captions render above every body, so a nearby body cannot hide them.
        drawing=VGroup(*leaders,*[line for connector,line in connections],*[body for body,label in pieces],*[label for body,label in pieces])
        drawing.add_updater(update_diagram)
        update_diagram(drawing)
        divider=Line([-.5,2.1,0],[-.5,-2.6,0],color="#3A6B5D")
        self.add(drawing,divider)
        for index,step in enumerate(scene["steps"]):
            status(status="rendering",message=f"Rendering explanation step {index+1} of {len(scene['steps'])}.")
            heading=paragraph(f"{index+1}. {step['title']}",width=55,size=28).move_to([0,2.75,0])
            if heading.height > .75: heading.scale_to_fit_height(.75)
            # Narration is spoken in full; the concise card complements it.
            card=paragraph(step["narration"],width=44,size=20,max_width=5.8)
            if card.height>1.65: card.scale_to_fit_height(1.65)
            card.move_to([3.0,1.15,0])
            formulas=VGroup(*[equation(e) for e in step["equations"][:4]])
            if len(formulas):
                formulas.arrange(DOWN,buff=.22)
                if formulas.height>1.8: formulas.scale_to_fit_height(1.8)
                formulas.move_to([3,-1.25,0])
            tracker.set_value(step["tStart"])
            self.play(FadeIn(heading),FadeIn(card),Write(formulas),run_time=.7)
            self.voice(index+1)
            duration=max(5,audio_duration(index+1,8))
            self.play(tracker.animate.set_value(step["tEnd"]),run_time=duration,rate_func=linear)
            self.play(FadeOut(heading),FadeOut(card),FadeOut(formulas),run_time=.4)
        self.remove(drawing,divider)
        heading=Text("The result",font="Arial",font_size=38,color=MINT).move_to([0,2.5,0])
        rows=[]
        for answer,value in zip(scene["answers"],payload["answers"]):
            rows.append(paragraph(f"{answer['question']}: {value:.4g} {answer['unit']}",width=60,size=27))
        answers=VGroup(*rows).arrange(DOWN,buff=.3).move_to([0,.2,0])
        if answers.height>3.5: answers.scale_to_fit_height(3.5)
        self.play(Write(heading),FadeIn(answers),run_time=1)
        self.voice(len(scene["steps"])+1)
        self.wait(max(5,audio_duration(len(scene["steps"])+1,7)))

    def voice(self,index):
        file=directory/f"voice-{index}.wav"
        if file.exists(): self.add_sound(str(file))

try:
    segments=[scene["problemText"]]+[step["narration"] for step in scene["steps"]]+["The calculated answers are. "+" ".join(f"{answer['question']}: {value:.3f} {answer['unit']}." for answer,value in zip(scene["answers"],payload["answers"]))]
    # Windows PowerShell rejects dictionaries with case-distinct physics symbols m/M.
    # Speech receives strings only; the complete case-sensitive payload stays in Python.
    (directory/"narration.json").write_text(json.dumps(segments,ensure_ascii=False),encoding="utf-8")
    narration=False
    if os.name=="nt":
        voice_script=Path(__file__).with_name("narrate-video.ps1")
        result=subprocess.run(["powershell.exe","-NoProfile","-File",str(voice_script),"-Directory",str(directory)],capture_output=True,text=True,timeout=120)
        narration=result.returncode==0 and all((directory/f"voice-{i}.wav").exists() for i in range(len(segments)))
        if not narration:
            (directory/"narration-error.log").write_text(result.stderr[-4000:],encoding="utf-8")
            raise RuntimeError("Narration could not be generated. Please retry the video; the speech error was recorded locally.")
    status(status="rendering",message="Narration ready. Rendering video frames." if narration else "Rendering video frames with written explanations.")
    with tempconfig({"media_dir":str(directory/"media"),"output_file":"explanation","pixel_width":1280,"pixel_height":720,"frame_rate":24,"disable_caching":True,"verbosity":"WARNING"}):
        movie=Explanation()
        movie.render()
        shutil.copyfile(movie.renderer.file_writer.movie_file_path,directory/"explanation.mp4")
    status(status="ready",narration=narration,message="Your explanation video is ready." if narration else "Video ready with written explanation; no local speech voice was available.")
except Exception as error:
    status(status="error",message=str(error)[-700:])
    raise
