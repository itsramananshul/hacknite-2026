"use client";
import {authFetch} from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import type { SceneScript } from "@/lib/schema";

import {readVideoReference,type SavedVideo} from "@/lib/video-reference";
export type {SavedVideo} from "@/lib/video-reference";
export default function ExplanationVideo({scene,values,solution,savedJob:rawJob,savedVideos=[],onJob}:{scene:SceneScript;values:Record<string,number>;solution:string;savedJob?:SavedVideo;savedVideos?:SavedVideo[];onJob?:(job:SavedVideo)=>void}) {
  const savedJob=readVideoReference(rawJob);
  const [job,setJob]=useState<string|null>(savedJob?.id ?? null);
  const [status,setStatus]=useState(savedJob ? "rendering" : "idle");
  const [message,setMessage]=useState("");
  const [captured,setCaptured]=useState(savedJob?.fingerprint ?? "");
  const fingerprint=JSON.stringify({scene,values});
  const pending=useRef(false);
  useEffect(()=>{
    if(savedJob && savedJob.id!==job){setJob(savedJob.id);setCaptured(savedJob.fingerprint);setStatus("rendering");}
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
        if(!response.ok) throw new Error(result.error || "Could not check the video.");
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
    {savedVideos.length>1?<label className="nb-field">Saved videos<select className="nb-input" aria-label="Saved videos" value={job ?? ""} onChange={event=>{const selected=savedVideos.find(video=>video.id===event.target.value);if(selected){setJob(selected.id);setCaptured(selected.fingerprint);setStatus("rendering");}}}>{savedVideos.map((video,index)=><option key={video.id} value={video.id}>Video {index+1}</option>)}</select></label>:null}
    <div className="video-heading"><div><h2>Explanation video</h2><p>A narrated film of the problem, reasoning, equations, and answer.</p></div>
    <button type="button" className="btn btn-primary" disabled={status==="rendering"} onClick={generate}>{status==="rendering"?"Generating video…":job?"Generate a new video":"Generate explanation video"}</button></div>
    {message?<p role={status==="error"?"alert":"status"}>{message}</p>:null}
    {captured && captured!==fingerprint?<p>The scene has changed. Generate again to include the current values.</p>:null}
    {job && status==="ready"?<><video controls preload="metadata" src={`/api/video/${job}/file`} aria-label="Explanation video"/><a className="btn btn-quiet" href={`/api/video/${job}/file?download=1`} download>Download MP4</a></>:null}
  </section>;
}
