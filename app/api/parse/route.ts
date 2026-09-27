import {
  errorResponse,
  parseImageDataUrl,
  parsePrompt,
  parseRequest,
  parseRequestSchema,
  readRequestJson,
  requestScene,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = parseRequest(parseRequestSchema, await readRequestJson(request));
    const image = parseImageDataUrl(body.image);
    const { scene } = await requestScene({ image, prompt: parsePrompt(body.instruction) });
    return Response.json({ scene });
  } catch (error) {
    return errorResponse(error);
  }
}
