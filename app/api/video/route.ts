import {requireUser} from "@/lib/request-auth";
import { errorResponse, readRequestJson, RouteError } from "@/lib/gemini";
import { startVideo } from "@/lib/video";
import { z } from "zod";

export const runtime="nodejs";
const schema=z.strictObject({scene:z.unknown(),values:z.record(z.string(),z.number().finite()).default({}),solution:z.string().max(12000).default("")});
export async function POST(request:Request) {
  try {
    const {user}=await requireUser(request);
    const parsed=schema.safeParse(await readRequestJson(request));
    if(!parsed.success) throw new RouteError(400,"invalid_video_request","Send a valid scene, numerical parameter values, and solution text.");
    const body=parsed.data;
    return Response.json(await startVideo(body.scene,body.values,body.solution,user.id),{status:202});
  } catch(error) {return errorResponse(error);}
}
