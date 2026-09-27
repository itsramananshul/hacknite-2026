import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {createConnection} from "node:net";

if(existsSync(".env.local")) process.loadEnvFile(".env.local");
const origin=process.env.OLLAMA_SERVER_URL || "http://127.0.0.1:11434";
const url=new URL(origin);
if(url.protocol!=="http:" || !["127.0.0.1","localhost","[::1]"].includes(url.hostname)) throw new Error("Ollama must run on this computer.");
const children=[];
function launch(command,args,env){const child=spawn(command,args,{env,stdio:"inherit",windowsHide:true});children.push(child);child.on("error",error=>{console.error(error.message);shutdown(1);});return child;}
function shutdown(code=0){for(const child of children) child.kill();process.exit(code);}
process.on("SIGINT",()=>shutdown());process.on("SIGTERM",()=>shutdown());
async function models(){try{const r=await fetch(`${origin}/api/tags`,{signal:AbortSignal.timeout(1500)});return r.ok?(await r.json()).models:null;}catch{return null;}}
if(!(await models())){
  if(url.port!=="11434") throw new Error("The configured Ollama connection is unavailable. If this is an SSH tunnel, start the tunnel before Chalk; no local replacement server will be started.");
  const executable=process.platform==="win32"?join(process.env.LOCALAPPDATA||"","Programs","Ollama","ollama.exe"):"ollama";
  if(process.platform==="win32"&&!existsSync(executable)) throw new Error("Install Ollama from https://ollama.com first.");
  launch(executable,["serve"],{...process.env,OLLAMA_HOST:url.host,OLLAMA_MAX_LOADED_MODELS:"1",OLLAMA_NUM_PARALLEL:"1"});
  for(let i=0;i<40 && !(await models());i++) await new Promise(resolve=>setTimeout(resolve,500));
}
const model=process.env.OLLAMA_MODEL || "qwen3.5:9b";
if(!(await models())?.some(m=>m.name===model)) throw new Error(`Download the local model first: ollama pull ${model}`);
const port=Number(process.env.PORT||3000);
const appHost=process.env.CHALK_HOST || "127.0.0.1";
const listening=await new Promise(resolve=>{const socket=createConnection({host:"127.0.0.1",port});const done=value=>{socket.destroy();resolve(value);};socket.once("connect",()=>done(true));socket.once("error",()=>done(false));socket.setTimeout(1500,()=>done(false));});
if(listening) throw new Error(`A server already uses port ${port}. Stop it before starting local mode.`);
console.log(`Chalk will use ${model} through ${origin}, with no hosted AI calls.`);
const next=launch(process.execPath,[join("node_modules","next","dist","bin","next"),"dev","--hostname",appHost,"--port",String(port)],{...process.env,CHALK_SOLVER:"ollama",OLLAMA_MODEL:model});
next.on("exit",code=>shutdown(code||0));
