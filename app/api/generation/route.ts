import {requireUser} from "@/lib/request-auth";
import {errorResponse,parseSolveRequest,parseEditRequest,readRequestJson} from "@/lib/gemini";
import {readGeneration,startGeneration,listGenerations} from "@/lib/generation-jobs";
import {publishGeneration} from "@/lib/generation-cloud";
import {createClient} from "@supabase/supabase-js";
import {hostedGenerations,startHostedGeneration,saveHostedGeneration} from "@/lib/generation-hosted";

function userClient(token:string){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});}

export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const {user,token}=await requireUser(request);
    const body=await readRequestJson(request) as Record<string,unknown>;
    if(typeof body.pageId!=="string"||!/^[a-zA-Z0-9-]{1,100}$/.test(body.pageId))return Response.json({error:"A saved question is required."},{status:400});
    const {pageId,notebookId,...input}=body;
    const parsed=input.scene?{edit:parseEditRequest(input)}:{request:parseSolveRequest(input)};
    const client=userClient(token);
    const existing=await client.from("question_pages").select("payload,notebook_id,title").eq("user_id",user.id).eq("id",pageId).maybeSingle();
    if(existing.error)throw new Error(existing.error.message);
    const bookId=existing.data?.notebook_id ?? notebookId;
    if(typeof bookId!=="string")return Response.json({error:"Choose a notebook before starting generation."},{status:400});
    const book=await client.from("notebooks").select("id").eq("user_id",user.id).eq("id",bookId).maybeSingle();
    if(book.error || !book.data)return Response.json({error:"This notebook is not available in your account."},{status:404});
    const payload=existing.data?.payload ?? {questionPage:{id:pageId,notebookId:bookId,problemText:typeof input.problemText==="string"?input.problemText:"",answers:null,error:null},scene:null,values:{},solution:""};
    payload.questionPage={...payload.questionPage,status:"solving",error:null};
    const saved=await client.from("question_pages").upsert({user_id:user.id,id:pageId,notebook_id:bookId,title:existing.data?.title ?? (payload.questionPage.problemText.slice(0,120)||"Problem from a photo"),status:"solving",payload,updated_at:new Date().toISOString()},{onConflict:"user_id,id"});
    if(saved.error)throw new Error(saved.error.message);
    const generation={userId:user.id,pageId:pageId as string,...parsed};
    const job=process.env.VERCEL?await startHostedGeneration(client,generation):await startGeneration(generation);
    return Response.json({id:job.id,status:job.status},{status:202});
  }catch(error){return errorResponse(error);}
}
export async function GET(request:Request){
  try{
    const {user,token}=await requireUser(request);
    const pageId=new URL(request.url).searchParams.get("pageId");
    const client=userClient(token);
    const persist=process.env.VERCEL?(job:import("@/lib/generation-jobs").GenerationJob)=>saveHostedGeneration(client,job):undefined;
    if(!pageId){const jobs=process.env.VERCEL?await hostedGenerations(client,user.id):await listGenerations(user.id);for(const job of jobs)await publishGeneration(client,job,persist);return Response.json({synced:true},{headers:{"Cache-Control":"no-store"}});}
    const job=process.env.VERCEL?(await hostedGenerations(client,user.id,pageId))[0]:await readGeneration(user.id,pageId);
    if(!job)return Response.json({error:"No background generation exists for this question."},{status:404});
    await publishGeneration(client,job,persist);
    return Response.json({id:job.id,status:job.status,answers:job.answers,result:job.result,error:job.error},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}
