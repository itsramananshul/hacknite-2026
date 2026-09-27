import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileScene } from "./expressions";
import { validateSceneScript } from "./validate";
import { RouteError } from "./gemini";

const root = join(process.cwd(), ".chalk-work", "videos");
const identifier = /^[a-f0-9-]{36}$/;
const active = new Set<string>();

export function videoDirectory(id:string) {
  if (!identifier.test(id)) throw new RouteError(400,"invalid_video","Invalid video identifier.");
  return join(root,id);
}

export function videoPayload(raw:unknown, values:Record<string,number> = {}, solution = "") {
  const scene=validateSceneScript(raw).scene;
  const compiled=compileScene(scene);
  const allowed=new Set(scene.variables.map(v=>v.name));
  for(const [name,value] of Object.entries(values)) {
    const variable=scene.variables.find(v=>v.name===name);
    if(!allowed.has(name) || !Number.isFinite(value) || !variable || value<variable.min || value>variable.max) {
      throw new RouteError(400,"invalid_video_values","Use parameter values within the scene's limits.");
    }
  }
  const frames=Array.from({length:241},(_,index)=>{
    const t=scene.duration*index/240;
    return {t,...compiled.sample(t,values)};
  });
  const answers=compiled.answerValues(values);
  const steps=scene.steps.length ? scene.steps : [{title:"Solution",narration:solution || scene.problemText,equations:[],tStart:0,tEnd:scene.duration}];
  if(steps.reduce((sum,s)=>sum+s.narration.length,0)>9000) {
    throw new RouteError(422,"video_too_long","This explanation is too long for one local video. Use a shorter problem or fewer explanation steps.");
  }
  return {scene:{...scene,steps},frames,answers,values,solution};
}

export async function startVideo(raw:unknown,values:Record<string,number>,solution:string) {
  if(process.env.VERCEL) throw new RouteError(503,"video_local_only","Video rendering currently runs on your laptop. Open the local Chalk app to generate an MP4.");
  if(active.size>=2) throw new RouteError(429,"video_busy","Two videos are rendering. Wait for one to finish.");
  const python=process.env.CHALK_VIDEO_PYTHON || join(process.cwd(),".chalk-work","video-venv",process.platform==="win32" ? "Scripts/python.exe" : "bin/python");
  if(!existsSync(python)) throw new RouteError(503,"video_setup","Install the local Manim runtime with npm run setup:video first.");
  const payload=videoPayload(raw,values,solution);
  const id=randomUUID();
  const directory=videoDirectory(id);
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,"input.json"),JSON.stringify(payload));
  await writeFile(join(directory,"status.json"),JSON.stringify({status:"rendering",message:"Creating narration and rendering the explanation frames."}));
  active.add(id);
  const child=spawn(python,[join(process.cwd(),"scripts","render-explanation.py"),directory],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
  let detail="";
  child.stderr.on("data",chunk=>{detail=(detail+String(chunk)).slice(-4000);});
  let finished=false;
  const finish=async(error?:string)=>{
    if(finished) return;
    finished=true;
    clearTimeout(timer);
    active.delete(id);
    if(error) await writeFile(join(directory,"status.json"),JSON.stringify({status:"error",message:error}));
  };
  const timer=setTimeout(()=>{
    if(process.platform==="win32" && child.pid) execFile("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true},()=>{});
    else child.kill();
    void finish("The video took longer than 10 minutes to render. Try a shorter explanation.");
  },600_000);
  child.on("error",error=>void finish(error.message));
  child.on("close",code=>void finish(code===0 ? undefined : `Video rendering failed. ${detail.slice(-700)}`));
  return {id,status:"rendering"};
}

export async function videoStatus(id:string) {
  try { return JSON.parse(await readFile(join(videoDirectory(id),"status.json"),"utf8")); }
  catch(error) {
    if(error instanceof RouteError) throw error;
    throw new RouteError(404,"video_missing","This video is not available on this computer.");
  }
}
