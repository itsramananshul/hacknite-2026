import {requireUser} from "@/lib/request-auth";
// POST /api/edit: one change to a scene that is already on the board.
//
// The change goes through the same two calls as a solve, so the scene and the
// answer panel move to the new numbers together, and it comes back in the same
// shape as /api/solve.
import { errorResponse, parseEditRequest, readRequestJson } from "@/lib/gemini";
import { editProblem } from "@/lib/solver";

export const runtime = "nodejs";
// Each model request may run for up to 1,000 seconds.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    const {user}=await requireUser(request);
    const body = await readRequestJson(request);
    const { scene, instruction } = parseEditRequest(body);
    return Response.json(await editProblem(scene, instruction));
  } catch (error) {
    return errorResponse(error);
  }
}
