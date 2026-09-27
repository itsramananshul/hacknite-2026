import {requireUser} from "@/lib/request-auth";
import {requireVideoOwner} from "@/lib/video";
import { errorResponse } from "@/lib/gemini";
import { videoStatus } from "@/lib/video";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {const {user}=await requireUser(request);const {id}=await context.params;await requireVideoOwner(id,user.id);return Response.json(await videoStatus(id),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return errorResponse(error);}
}
