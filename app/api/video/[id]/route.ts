import {requireUser} from "@/lib/request-auth";
import {requireVideoOwner} from "@/lib/video";
import { errorResponse } from "@/lib/gemini";
import { videoStatus } from "@/lib/video";
import {videoClient,hostedVideoStatus} from "@/lib/video-hosted";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {const {user,token}=await requireUser(request);const {id}=await context.params;
    if(process.env.VERCEL){const job=await hostedVideoStatus(videoClient(token),user.id,id);return Response.json({status:job.status,message:job.message,narration:job.narration},{headers:{"Cache-Control":"no-store"}});}
    await requireVideoOwner(id,user.id);return Response.json(await videoStatus(id),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return errorResponse(error);}
}
