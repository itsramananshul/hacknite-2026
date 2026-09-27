import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse, RouteError } from "@/lib/gemini";
import { videoDirectory, videoStatus } from "@/lib/video";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const {id}=await context.params;
    if((await videoStatus(id)).status!=="ready") throw new RouteError(409,"video_pending","The video is still rendering.");
    const bytes=await readFile(join(videoDirectory(id),"explanation.mp4"));
    const range=request.headers.get("range");
    const headers:Record<string,string>={"Content-Type":"video/mp4","Accept-Ranges":"bytes","Cache-Control":"private, max-age=3600"};
    if(new URL(request.url).searchParams.has("download")) headers["Content-Disposition"]='attachment; filename="Chalk-explanation.mp4"';
    if(range) {
      const match=/^bytes=(\d+)-(\d*)$/.exec(range);
      if(!match) return new Response(null,{status:416,headers:{"Content-Range":`bytes */${bytes.length}`}});
      const start=Number(match[1]);
      const end=Math.min(match[2] ? Number(match[2]) : bytes.length-1,bytes.length-1);
      if(start>end || start>=bytes.length) return new Response(null,{status:416,headers:{"Content-Range":`bytes */${bytes.length}`}});
      headers["Content-Range"]=`bytes ${start}-${end}/${bytes.length}`;
      headers["Content-Length"]=String(end-start+1);
      return new Response(bytes.subarray(start,end+1),{status:206,headers});
    }
    headers["Content-Length"]=String(bytes.length);
    return new Response(bytes,{headers});
  } catch(error){return errorResponse(error);}
}
