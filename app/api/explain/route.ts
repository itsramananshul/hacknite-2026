import {
  acceptModelScene,
  errorResponse,
  explainRequestSchema,
  explanationPrompt,
  parseRequest,
  readRequestJson,
  requestExplanation,
} from "@/lib/gemini";
import { resolveScene } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = parseRequest(explainRequestSchema, await readRequestJson(request));
    // The scene is resolved and solved here, so the explanation is grounded in
    // the same numbers the answer panel shows rather than in the model's own
    // physics.
    const { scene: current, labels } = resolveScene(body.scene);
    const { answer } = acceptModelScene(current);
    const explanation = await requestExplanation([
      { text: explanationPrompt(current, labels, answer) },
    ]);
    return Response.json({ explanation });
  } catch (error) {
    return errorResponse(error);
  }
}
