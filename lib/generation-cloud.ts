import type {SupabaseClient} from "@supabase/supabase-js";
import type {GenerationJob} from "./generation-jobs";
import {saveGeneration} from "./generation-jobs";
import {keepSimulation} from "./simulation-history";

export async function publishGeneration(client:SupabaseClient,job:GenerationJob,persist=saveGeneration){
  if(job.published || !["complete","error"].includes(job.status))return;
  const {data,error}=await client.from("question_pages").select("payload").eq("user_id",job.userId).eq("id",job.pageId).maybeSingle();
  if(error)throw new Error(error.message);
  // Deleting a question/notebook must not recreate it when its worker finishes.
  if(!data){await persist({...job,published:true});return;}
  const payload=data.payload;
  const result=job.result;
  if(result){
    const values=result.scene?Object.fromEntries(result.scene.variables.map(variable=>[variable.name,variable.value])):{};
    const history=result.scene?keepSimulation(payload.questionPage.simulations ?? [],result.scene,values,result.solutionText):null;
    payload.questionPage={...payload.questionPage,status:result.scene?"ready":"answer-only",answers:result,error:null,...(history?{simulations:history.versions,selectedSimulation:history.id,video:undefined}:{})};
    payload.scene=result.scene;payload.values=values;payload.solution=result.solutionText;
  }else payload.questionPage={...payload.questionPage,status:"error",error:job.error};
  const update=await client.from("question_pages").update({payload,status:payload.questionPage.status,...(result?.scene?{title:result.scene.title}:{}),updated_at:new Date().toISOString()}).eq("user_id",job.userId).eq("id",job.pageId);
  if(update.error)throw new Error(update.error.message);
  await persist({...job,published:true});
}
