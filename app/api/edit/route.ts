// POST /api/edit: one change to a scene that is already on the board.
//
// The change goes through the same two calls as a solve, so the scene and the
// answer panel move to the new numbers together, and it comes back in the same
// shape as /api/solve.
import { errorResponse, parseEditRequest, readRequestJson } from "@/lib/gemini";
import { editProblem } from "@/lib/solver";

export const runtime = "nodejs";
// Three Gemini calls at 45s each is the worst case: solve, scene, repair.
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRequestJson(request);
    const { scene, instruction } = parseEditRequest(body);
    return Response.json(await editProblem(scene, instruction));
  } catch (error) {
    return errorResponse(error);
  }
}
