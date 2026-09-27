"use client";
import {authFetch} from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import type { SceneScript } from "@/lib/schema";

import {readVideoReference,type SavedVideo} from "@/lib/video-reference";
export type {SavedVideo} from "@/lib/video-reference";
export default function ExplanationVideo({scene,values,solution,savedJob:rawJob,savedVideos=[],active=true,onDelete,onJob}:{scene:SceneScript;values:Record<string,number>;solution:string;savedJob?:SavedVideo;savedVideos?:SavedVideo[];active?:boolean;onDelete?:(id:string)=>void;onJob?:(job:SavedVideo)=>void}) {
  const savedJob=readVideoReference(rawJob);
  const firstVideo=savedVideos.map(readVideoReference).find(Boolean) ?? savedJob;
  const [job,setJob]=useState<string|null>(firstVideo?.id ?? null);
  const [status,setStatus]=useState(firstVideo ? "rendering" : "idle");
  const [message,setMessage]=useState("");
  const [captured,setCaptured]=useState(firstVideo?.fingerprint ?? "");
  const fingerprint=JSON.stringify({scene,values});
  const pending=useRef(false);
  const previousSavedId=useRef(savedJob?.id);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [playbackError,setPlaybackError]=useState("");
  const [playerRevision,setPlayerRevision]=useState(0);
  useEffect(()=>setPlaybackError(""),[job]);
  useEffect(()=>{
    if(!active)return;
    setJob(firstVideo?.id ?? null);setCaptured(firstVideo?.fingerprint ?? "");
    setMessage("");setStatus(firstVideo?"rendering":"idle");setConfirmDelete(false);
  },[active]);
  useEffect(()=>{
    const changed=previousSavedId.current!==savedJob?.id;previousSavedId.current=savedJob?.id;
    if(changed && savedJob && savedJob.id!==job){setJob(savedJob.id);setCaptured(savedJob.fingerprint);setMessage("");setStatus("rendering");}
  },[savedJob?.id]);
  useEffect(()=>{
    if(!job || status!=="rendering") return;
    let stopped=false;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const response=await authFetch(`/api/video/${job}`,{signal:controller.signal});
        const result=await response.json();
        if(stopped) return;
        if(!response.ok) throw new Error(response.status===404?"This video has not reached cloud storage yet. Open the local Chalk app to upload the existing video, then select it again here. You do not need to regenerate it.":result.error || "Could not check the video.");
        if(result.status==="ready"){
          // Native media requests use the HttpOnly cookie, whereas this poll uses a bearer token.
          const session=await authFetch("/api/session",{method:"POST",signal:controller.signal});
          if(!session.ok)throw new Error("Sign-in could not be refreshed for video playback. Reload the video to try again.");
          if(stopped)return;
        }
        setMessage(result.message);
        if(result.status!=="rendering") setStatus(result.status);
        else timer=setTimeout(poll,5000);
      }catch(error){if(!stopped){setStatus("error");setMessage(error instanceof Error?error.message:"Video status failed.");}}
    };
    void poll();
    return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[job,status]);
  const generate=async()=>{
    if(pending.current) return;
    pending.current=true;
    setStatus("rendering");setMessage("Preparing your explanation video…");setJob(null);
    try {
      const response=await authFetch("/api/video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scene,values,solution})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || "Could not create the video.");
      setCaptured(fingerprint);setJob(result.id);onJob?.({id:result.id,fingerprint});
    }catch(error){setStatus("error");setMessage(error instanceof Error?error.message:"Video generation failed.");}
    finally{pending.current=false;}
  };
  return <section className="explanation-video" aria-label="Explanation video">
    {savedVideos.length>1?<label className="nb-field">Saved videos<select className="nb-input" aria-label="Saved videos" value={job ?? ""} onChange={event=>{const selected=savedVideos.find(video=>video.id===event.target.value);if(selected){setConfirmDelete(false);setJob(selected.id);setCaptured(selected.fingerprint);setMessage("");setStatus("rendering");}}}>{savedVideos.map((video,index)=><option key={video.id} value={video.id}>Video {index+1}</option>)}</select></label>:null}
    <div className="video-heading"><div><h2>Explanation video</h2><p>A narrated film of the problem, reasoning, equations, and answer.</p></div>
    <button type="button" className="btn btn-primary" disabled={status==="rendering"} onClick={generate}>{status==="rendering"?"Generating video…":job?"Generate a new video":"Generate explanation video"}</button></div>
    {job && onDelete?<div className="video-delete">
      {confirmDelete?<><p>Delete this video from this question? Other videos and simulations will be kept.</p><button type="button" className="btn btn-quiet" onClick={()=>setConfirmDelete(false)}>Cancel</button><button type="button" className="btn btn-quiet" onClick={()=>{
        const removed=job;const next=savedVideos.find(video=>video.id!==removed);
        onDelete(removed);setJob(next?.id ?? null);setCaptured(next?.fingerprint ?? "");setStatus(next?"rendering":"idle");setMessage("");setConfirmDelete(false);
      }}>Confirm delete video</button></>:<button type="button" className="btn btn-quiet" onClick={()=>setConfirmDelete(true)}>Delete video</button>}
    </div>:null}
    {message?<p role={status==="error"?"alert":"status"}>{message}</p>:null}
    {captured && captured!==fingerprint?<p>The scene has changed. Generate again to include the current values.</p>:null}
    {job && (status==="ready" || status==="error")?<button type="button" className="btn btn-quiet" onClick={()=>{setPlaybackError("");setPlayerRevision(previous=>previous+1);setStatus("rendering");setMessage("Reloading your saved video…");}}>Reload video</button>:null}
    {playbackError?<p role="alert">{playbackError}</p>:null}
    {job && status==="ready"?<><video key={`${job}:${playerRevision}`} controls preload="auto" onError={()=>setPlaybackError("The player could not load this saved video. Choose Reload video to refresh its access and try again; you do not need to regenerate it.")} src={`/api/video/${job}/file`} aria-label="Explanation video"/><a className="btn btn-quiet" href={`/api/video/${job}/file?download=1`} download>Download MP4</a></>:null}
  </section>;
}
