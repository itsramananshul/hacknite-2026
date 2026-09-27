import {mkdir,readFile,writeFile,rename,readdir} from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import type {SolveRequest,SolveResult} from "./gemini";
import type {SceneScript} from "./schema";

export interface GenerationJob {
  id:string; userId:string; pageId:string; status:"queued"|"solving"|"building"|"complete"|"error";
  updatedAt:string; request?:SolveRequest; edit?:{scene:SceneScript;instruction:string};
  answers?:Omit<SolveResult,"scene">; result?:SolveResult; error?:string;
  published?:boolean;
}
const root=path.join(process.cwd(),".chalk-work","generations");
function file(userId:string,pageId:string){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(userId)||!/^[a-zA-Z0-9-]{1,100}$/.test(pageId))throw new Error("Invalid generation identifier.");
  return path.join(root,userId,`${pageId}.json`);
}
export async function readGeneration(userId:string,pageId:string):Promise<GenerationJob|null>{
  try{return JSON.parse(await readFile(file(userId,pageId),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
export async function saveGeneration(job:GenerationJob){
  const target=file(job.userId,job.pageId);await mkdir(path.dirname(target),{recursive:true});
  const temp=`${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp,JSON.stringify({...job,updatedAt:new Date().toISOString()}));await rename(temp,target);
}
export async function listGenerations(userId:string){
  const directory=path.dirname(file(userId,"list"));
  let names:string[];try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const jobs=await Promise.all(names.filter(name=>name.endsWith(".json")).map(name=>readGeneration(userId,name.slice(0,-5))));
  return jobs.filter((job):job is GenerationJob=>!!job);
}
export async function startGeneration(input:Pick<GenerationJob,"userId"|"pageId"|"request"|"edit">){
  const current=await readGeneration(input.userId,input.pageId);
  if(current && ["queued","solving","building"].includes(current.status))return current;
  const job:GenerationJob={...input,id:crypto.randomUUID(),status:"queued",updatedAt:new Date().toISOString()};
  await saveGeneration(job);
  // A separate process owns the work, independent of browser connections and logout.
  const child=spawn(process.execPath,["--import","tsx",path.join(process.cwd(),"scripts","generation-worker.ts"),job.userId,job.pageId,job.id],{cwd:process.cwd(),env:{...process.env,OPENCODE_TIMEOUT_MS:"1000000",OLLAMA_TIMEOUT_MS:"1000000"},detached:true,stdio:"ignore",windowsHide:true});
  child.on("error",error=>{void saveGeneration({...job,status:"error",error:error.message});});child.unref();
  return job;
}
