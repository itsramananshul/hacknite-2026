import {
  assertSceneIdentity,
  editPrompt,
  errorResponse,
  parseImageDataUrl,
  parseRequest,
  editRequestSchema,
  readRequestJson,
  requestScene,
} from "@/lib/gemini";
import { resolveScene } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = parseRequest(editRequestSchema, await readRequestJson(request));
    const image = parseImageDataUrl(body.image);
    // The scene is resolved first so the model edits the values the engine and
    // the solvers will actually use, not the raw labels.
    const { scene: current } = resolveScene(body.scene);
    const { scene } = await requestScene({ image, prompt: editPrompt(current, body.instruction) });
    assertSceneIdentity(current, scene);
    return Response.json({ scene });
  } catch (error) {
    return errorResponse(error);
  }
}
