import {Sandbox} from "@vercel/sandbox";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {sleep} from "workflow";
import type {videoPayload} from "./video";

type Input={id:string;payload:ReturnType<typeof videoPayload>;uploadUrl:string};
async function launch(input:Input){
  "use step";
  const snapshotId=process.env.CHALK_VIDEO_SNAPSHOT_ID;
  const options={name:`chalk-video-${input.id}`,persistent:false,timeout:25*60_000,resources:{vcpus:2}};
  const sandbox=await Sandbox.create(snapshotId?{...options,source:{type:"snapshot",snapshotId}}:options);
  try{
    const directory="/vercel/sandbox/video";
    await sandbox.writeFiles([
      {path:`${directory}/input.json`,content:Buffer.from(JSON.stringify(input.payload))},
      {path:`${directory}/upload.json`,content:Buffer.from(JSON.stringify({url:input.uploadUrl}))},
      {path:`${directory}/status.json`,content:Buffer.from(JSON.stringify({status:"rendering",message:"Preparing the cloud renderer."}))},
      ...await Promise.all(["render-explanation.py","video_layout.py","render-cloud-video.py","setup-cloud-video.py"].map(async name=>({path:`/vercel/sandbox/scripts/${name}`,content:await readFile(join(process.cwd(),"scripts",name))}))),
      {path:"/vercel/sandbox/public/brand/chalk-logo.png",content:await readFile(join(process.cwd(),"public","brand","chalk-logo.png"))},
    ]);
    await sandbox.runCommand({cmd:"python3",args:["/vercel/sandbox/scripts/render-cloud-video.py",directory],detached:true});
    return sandbox.name;
  }catch(error){await sandbox.stop();throw error;}
}
async function progress(name:string){
  "use step";
  const sandbox=await Sandbox.get({name});
  const file=await sandbox.readFileToBuffer({path:"/vercel/sandbox/video/status.json"});
  return file?JSON.parse(file.toString("utf8")) as {status:string;message:string;cloudUploaded?:boolean;narration?:boolean}:null;
}
async function stop(name:string){
  "use step";
  // An expired sandbox must not turn a successfully uploaded video into an error.
  try{await (await Sandbox.get({name})).stop();}catch{ /* The sandbox also has a hard expiry. */ }
}
export async function videoWorkflow(input:Input){
  "use workflow";
  const name=await launch(input);
  try{
    for(let count=0;count<140;count++){
      await sleep("10s");
      const state=await progress(name);
      if(state?.status==="error" || state?.cloudUploaded)return state;
    }
    return {status:"error",message:"Cloud rendering exceeded its time limit. Retry a shorter video."};
  }finally{await stop(name);}
}
