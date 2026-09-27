import { errorResponse } from "@/lib/gemini";
import { videoStatus } from "@/lib/video";
export const runtime="nodejs";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  try {return Response.json(await videoStatus((await context.params).id),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return errorResponse(error);}
}
