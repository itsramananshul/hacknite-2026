import {requireUser} from "@/lib/request-auth";
import {requireVideoOwner} from "@/lib/video";
import { errorResponse,RouteError } from "@/lib/gemini";
import { videoStatus } from "@/lib/video";
import {videoClient,hostedVideoStatus} from "@/lib/video-hosted";
import {syncLocalVideo} from "@/lib/video-sync";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {const {user,token}=await requireUser(request);const {id}=await context.params;
    let local=false;
    if(!process.env.VERCEL){try{await requireVideoOwner(id,user.id);local=true;}catch(error){if(!(error instanceof RouteError) || error.status!==404)throw error;}}
    if(!local){const job=await hostedVideoStatus(videoClient(token),user.id,id);return Response.json({status:job.status,message:job.message,narration:job.narration},{headers:{"Cache-Control":"no-store"}});}
    const status=await videoStatus(id);
    if(status.status==="ready"){
      try{await syncLocalVideo(videoClient(token),user.id,id);}catch{status.message="Video ready on this computer. Cloud upload will retry when you open it again.";}
    }
    return Response.json(status,{headers:{"Cache-Control":"no-store"}});}
  catch(error){return errorResponse(error);}
}
