import {randomUUID} from "node:crypto";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {start,getRun} from "workflow/api";
import {videoWorkflow} from "./video-workflow";
import {videoPayload} from "./video";
import {RouteError} from "./gemini";
import {Sandbox} from "@vercel/sandbox";

export function videoClient(token:string){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});}
export async function startHostedVideo(client:SupabaseClient,userId:string,scene:unknown,values:Record<string,number>,solution:string){
  const payload=videoPayload(scene,values,solution);
  const busy=await client.from("video_jobs").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("status","rendering").gte("created_at",new Date(Date.now()-25*60_000).toISOString());
  if(busy.error)throw new Error(busy.error.message);
  if((busy.count ?? 0)>=2)throw new RouteError(429,"video_busy","Two videos are rendering in your account. Wait for one to finish.");
  const id=randomUUID(),objectPath=`${userId}/${id}.mp4`;
  const upload=await client.storage.from("chalk-videos").createSignedUploadUrl(objectPath);
  if(upload.error)throw new Error(upload.error.message);
  const saved=await client.from("video_jobs").insert({id,user_id:userId,object_path:objectPath});
  if(saved.error)throw new Error(saved.error.message);
  try{
    const run=await start(videoWorkflow,[{id,payload,uploadUrl:upload.data.signedUrl}]);
    const update=await client.from("video_jobs").update({run_id:run.runId}).eq("user_id",userId).eq("id",id);
    if(update.error)throw new Error(update.error.message);
    return {id,status:"rendering"};
  }catch(error){await client.from("video_jobs").update({status:"error",message:"Cloud video generation could not start. Please retry."}).eq("user_id",userId).eq("id",id);throw error;}
}
export async function hostedVideoStatus(client:SupabaseClient,userId:string,id:string){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new RouteError(400,"invalid_video","Invalid video identifier.");
  const {data,error}=await client.from("video_jobs").select("status,message,narration,run_id,object_path").eq("user_id",userId).eq("id",id).maybeSingle();
  if(error)throw new Error(error.message);
  if(!data)throw new RouteError(404,"video_missing","This video is not available in your account.");
  if(data.status==="rendering" && data.run_id){
    const run=getRun<{status:string;message:string;narration?:boolean}>(data.run_id);
    const state=await run.status;
    let result:{status:string;message:string;narration?:boolean}|undefined;
    if(state==="completed")result=await run.returnValue;
    else if(state==="failed" || state==="cancelled")result={status:"error",message:"Cloud video rendering could not finish. Your saved simulation is intact; retry the video."};
    if(result){
      data.status=result.status;data.message=result.message;data.narration=result.narration ?? false;
      const update=await client.from("video_jobs").update({status:data.status,message:data.message,narration:data.narration}).eq("user_id",userId).eq("id",id);
      if(update.error)throw new Error(update.error.message);
    }else{
      // Show actual progress without storing a user's session in the workflow.
      try{
        const sandbox=await Sandbox.get({name:`chalk-video-${id}`});
        const buffer=await sandbox.readFileToBuffer({path:"/vercel/sandbox/video/status.json"});
        const progress=buffer?JSON.parse(buffer.toString("utf8")):null;
        if(progress?.status==="rendering" && typeof progress.message==="string")data.message=progress.message;
      }catch{ /* Launch and cleanup may briefly leave no readable sandbox. */ }
    }
  }
  return data;
}
