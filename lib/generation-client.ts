import {authFetch} from "./auth-fetch";
import type {SolveResult} from "./gemini";

export async function waitForGeneration(pageId:string,onAnswers:(answer:Omit<SolveResult,"scene">)=>void,signal?:AbortSignal):Promise<SolveResult>{
  let delivered="";
  while(!signal?.aborted){
    const response=await authFetch(`/api/generation?pageId=${encodeURIComponent(pageId)}`,{signal,cache:"no-store"});
    const job=await response.json();
    if(!response.ok)throw new Error(job.error || "Could not read generation progress.");
    if(job.answers && JSON.stringify(job.answers)!==delivered){delivered=JSON.stringify(job.answers);onAnswers(job.answers);}
    if(job.status==="complete")return job.result;
    if(job.status==="error")throw new Error(job.error || "Generation failed.");
    await new Promise<void>(resolve=>{const timer=setTimeout(done,2000);function done(){clearTimeout(timer);signal?.removeEventListener("abort",done);resolve();}signal?.addEventListener("abort",done,{once:true});});
  }
  throw new DOMException("Progress subscription stopped.","AbortError");
}
export async function generateInBackground(pageId:string,body:Record<string,unknown>,onAnswers:(answer:Omit<SolveResult,"scene">)=>void){
  const response=await authFetch("/api/generation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,pageId})});
  if(!response.ok){const error=await response.json();throw new Error(error.error || "Could not start generation.");}
  return waitForGeneration(pageId,onAnswers);
}
