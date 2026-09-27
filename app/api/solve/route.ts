import {requireUser} from "@/lib/request-auth";
// POST /api/solve: the whole server side pipeline for one problem.
//
// Call A solves the problem with the code execution tool, Call B turns that
// verified solution into a Scene Script, and every failure leaves as the same
// {error, code} body. The key is only ever read on the server, inside the
// request, so nothing here runs at build time.
import { errorResponse, parseSolveRequest, readRequestJson } from "@/lib/gemini";
import { solveProblem } from "@/lib/solver";

export const runtime = "nodejs";
// Each model request may run for up to 1,000 seconds.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const {user}=await requireUser(request);
    const body = await readRequestJson(request);
    const parsed=parseSolveRequest(body);
    if(request.headers.get("accept")?.includes("application/x-ndjson")) {
      const encoder=new TextEncoder();
      let cancelled=false;
      let heartbeat:ReturnType<typeof setInterval>|undefined;
      const stream=new ReadableStream({
        start(controller) {
          const send=(event:unknown)=>{if(!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event)+"\n"));};
          heartbeat=setInterval(()=>send({type:"progress"}),10000);
          void solveProblem(parsed,result=>send({type:"answers",result})).then(result=>{
            send({type:"complete",result});
          }).catch(async error=>{
            const response=errorResponse(error);
            send({type:"error",...(await response.json())});
          }).finally(()=>{clearInterval(heartbeat);if(!cancelled) controller.close();});
        },
        cancel(){cancelled=true;clearInterval(heartbeat);},
      });
      return new Response(stream,{headers:{"Content-Type":"application/x-ndjson","Cache-Control":"no-store"}});
    }
    return Response.json(await solveProblem(parsed));
  } catch (error) {
    return errorResponse(error);
  }
}
