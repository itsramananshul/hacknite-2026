import {requireUser} from "@/lib/request-auth";
import {videoClient} from "@/lib/video-hosted";
import {syncLocalVideos} from "@/lib/video-sync";
import {errorResponse} from "@/lib/gemini";

export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const {user,token}=await requireUser(request);
    if(process.env.VERCEL)return Response.json({synced:0,failed:0});
    return Response.json(await syncLocalVideos(videoClient(token),user.id),{headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}
