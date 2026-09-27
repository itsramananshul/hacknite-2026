import {readGeneration,saveGeneration} from "../lib/generation-jobs";
import {solveProblem,editProblem} from "../lib/solver";

async function main(){
  const [userId,pageId,id]=process.argv.slice(2);
  const job=await readGeneration(userId,pageId);if(!job || job.id!==id)return;
  let writes=Promise.resolve();
  const save=()=>{const snapshot=structuredClone(job);writes=writes.then(()=>saveGeneration(snapshot));return writes;};
  try{
    job.status="solving";await save();
    job.result=job.edit ? await editProblem(job.edit.scene,job.edit.instruction) : await solveProblem(job.request!,answers=>{job.answers=answers;job.status="building";void save();});
    job.status="complete";delete job.request;delete job.edit;await save();
  }catch(error){job.status="error";job.error=error instanceof Error?error.message:"Generation failed.";delete job.request;delete job.edit;await save();}
}
void main();
