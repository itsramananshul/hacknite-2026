import type {SupabaseClient} from "@supabase/supabase-js";
import {start,getRun} from "workflow/api";
import {generationWorkflow} from "./generation-workflow";
import type {GenerationJob} from "./generation-jobs";

export async function saveHostedGeneration(client:SupabaseClient,job:GenerationJob){
  const {error}=await client.from("generation_jobs").update({payload:job,updated_at:new Date().toISOString()}).eq("user_id",job.userId).eq("page_id",job.pageId);
  if(error)throw new Error(error.message);
}
export async function hostedGenerations(client:SupabaseClient,userId:string,pageId?:string){
  let query=client.from("generation_jobs").select("run_id,payload").eq("user_id",userId);
  if(pageId)query=query.eq("page_id",pageId);
  const {data,error}=await query;
  if(error)throw new Error(error.message);
  return await Promise.all((data??[]).map(async row=>{
    const job=row.payload as GenerationJob;
    if(!row.run_id||["complete","error"].includes(job.status))return job;
    const run=getRun(row.run_id);
    const status=await run.status;
    if(status==="completed"){
      const output=await getRun<{result?:import("./gemini").SolveResult;answers?:Omit<import("./gemini").SolveResult,"scene">;error?:string}>(row.run_id).returnValue;
      // Accept earlier runs that predate the staged workflow response.
      const result=output.result ?? ("scene" in output?output as unknown as import("./gemini").SolveResult:undefined);
      const completed:GenerationJob={...job,status:result?"complete":"error",result,answers:output.answers,error:output.error,updatedAt:new Date().toISOString()};
      await saveHostedGeneration(client,completed);return completed;
    }
    if(status==="failed"||status==="cancelled"){
      const failed:GenerationJob={...job,status:"error",error:"Generation could not finish on the server. Your question is saved; retry the simulation.",updatedAt:new Date().toISOString()};
      await saveHostedGeneration(client,failed);return failed;
    }
    return {...job,status:"building" as const};
  }));
}
export async function startHostedGeneration(client:SupabaseClient,input:Pick<GenerationJob,"userId"|"pageId"|"request"|"edit">){
  const previous=(await hostedGenerations(client,input.userId,input.pageId))[0];
  if(previous&&["queued","solving","building"].includes(previous.status))return previous;
  const job:GenerationJob={id:crypto.randomUUID(),userId:input.userId,pageId:input.pageId,status:"queued",updatedAt:new Date().toISOString()};
  const {error}=await client.from("generation_jobs").upsert({user_id:job.userId,page_id:job.pageId,payload:job,run_id:null},{onConflict:"user_id,page_id"});
  if(error)throw new Error(error.message);
  try{
    const run=await start(generationWorkflow,[{request:input.request,edit:input.edit}]);
    const saved=await client.from("generation_jobs").update({run_id:run.runId}).eq("user_id",job.userId).eq("page_id",job.pageId);
    if(saved.error)throw new Error(saved.error.message);
    return job;
  }catch(error){await saveHostedGeneration(client,{...job,status:"error",error:"The server could not start generation. Please retry."});throw error;}
}
