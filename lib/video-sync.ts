import {readdir,readFile} from "node:fs/promises";
import {join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {requireVideoOwner,videoDirectory,videoStatus} from "./video";

const syncing=new Map<string,Promise<boolean>>();

/** Copy the existing MP4, keeping its ID so every saved reference still works. */
export async function syncLocalVideo(client:SupabaseClient,userId:string,id:string):Promise<boolean>{
  if(process.env.VERCEL)return false;
  await requireVideoOwner(id,userId);
  const key=`${userId}/${id}`;
  const pending=syncing.get(key);if(pending)return pending;
  const task=(async()=>{
    const status=await videoStatus(id);if(status.status!=="ready")return false;
    const existing=await client.from("video_jobs").select("status").eq("user_id",userId).eq("id",id).maybeSingle();
    if(existing.error)throw new Error(existing.error.message);
    if(existing.data?.status==="ready")return true;
    const bytes=await readFile(join(videoDirectory(id),"explanation.mp4"));
    const objectPath=`${userId}/${id}.mp4`;
    // Storage INSERT policy is scoped to this authenticated user's folder.
    const upload=await client.storage.from("chalk-videos").upload(objectPath,bytes,{contentType:"video/mp4",upsert:false});
    if(upload.error){
      // A previous upload may have succeeded before its database write failed.
      const object=await client.storage.from("chalk-videos").info(objectPath);
      if(object.error || Number(object.data.size)!==bytes.length)throw new Error(upload.error.message);
    }
    const saved=await client.from("video_jobs").upsert({id,user_id:userId,object_path:objectPath,status:"ready",message:"Explanation video ready.",narration:status.narration ?? false,run_id:null},{onConflict:"id"});
    if(saved.error)throw new Error(saved.error.message);
    return true;
  })();
  syncing.set(key,task);
  try{return await task;}finally{syncing.delete(key);}
}

export async function syncLocalVideos(client:SupabaseClient,userId:string){
  const folders=await readdir(join(process.cwd(),".chalk-work","videos"),{withFileTypes:true}).catch(()=>[]);
  const result={synced:0,failed:0};
  for(const folder of folders){
    if(!folder.isDirectory() || !/^[a-f0-9-]{36}$/.test(folder.name))continue;
    // Never import another user's files or unowned development fixtures.
    try{await requireVideoOwner(folder.name,userId);}catch{continue;}
    try{if(await syncLocalVideo(client,userId,folder.name))result.synced++;}catch{result.failed++;}
  }
  return result;
}
