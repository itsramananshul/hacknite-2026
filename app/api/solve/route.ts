// POST /api/solve: the whole server side pipeline for one problem.
//
// Call A solves the problem with the code execution tool, Call B turns that
// verified solution into a Scene Script, and every failure leaves as the same
// {error, code} body. The key is only ever read on the server, inside the
// request, so nothing here runs at build time.
import { errorResponse, parseSolveRequest, readRequestJson, solveProblem } from "@/lib/gemini";

export const runtime = "nodejs";
// Three Gemini calls at 45s each is the worst case: solve, scene, repair.
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRequestJson(request);
    return Response.json(await solveProblem(parseSolveRequest(body)));
  } catch (error) {
    return errorResponse(error);
  }
}
