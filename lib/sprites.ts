// Browser image plumbing for the sketch milestone.
//
// Two jobs live here and nothing else. First, the shared resizing used by every
// request we send: the server accepts PNG, JPEG or WebP under 2 MB once decoded,
// so a drawing is flattened onto a white background, shrunk to fit a 1600 px
// long edge and re-encoded as JPEG before it leaves the browser. Second,
// cropSprites cuts the small transparent pictures of the objects Gemini pointed
// at with the normalized body bounding boxes, so the canvas can later draw the
// user's own chalk over the exact shape it will simulate.
//
// Both are browser only. There is no canvas on the server, so cropSprites
// returns an empty map rather than pretending to have cropped anything, and no
// function here performs any network IO or touches a file outside its arguments.
import type { Scene } from "./schema";

export const REQUEST_MAX_EDGE = 1600;
export const REQUEST_MAX_BYTES = 1_800_000;
const BASE_QUALITY = 0.85;
const FLOOR_QUALITY = 0.42;
const MAX_ATTEMPTS = 8;

// A crop is dropped rather than shrunk without limit, because a sprite is only
// useful while it still looks like the object it was cut from.
const MAX_CROP_PIXELS = 1_100_000;
const MIN_CROP_EDGE = 3;
const MAX_CROP_SHARE = 0.98;
const MIN_INK_PIXELS = 8;
const MIN_INK_SHARE = 0.0015;
const INK_ALPHA = 24;

export interface RequestImageOptions {
  maxEdge?: number;
  maxBytes?: number;
  quality?: number;
}

// Approximate decoded size of a base64 data URL, which is what actually decides
// whether a request fits under the server cap.
export function dataUrlBytes(dataURL: string): number {
  const comma = dataURL.indexOf(",");
  if (comma < 0) return Math.ceil((dataURL.length * 3) / 4);
  const base64 = dataURL.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("This browser could not read the drawing back out of the pad."));
    };
    reader.onerror = () => reject(new Error("This browser could not read the drawing back out of the pad."));
    reader.readAsDataURL(blob);
  });
}

export function loadImage(source: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const fromBlob = typeof source !== "string";
    const url = fromBlob ? URL.createObjectURL(source) : source;
    const done = (): void => {
      if (fromBlob) URL.revokeObjectURL(url);
    };
    image.onload = () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        done();
        reject(new Error("That file decoded to an image with no pixels in it."));
        return;
      }
      done();
      resolve(image);
    };
    image.onerror = () => {
      done();
      reject(new Error("That image could not be decoded. Use a PNG, JPEG or WebP picture of the drawing."));
    };
    image.src = url;
  });
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser did not give us a 2D canvas, so the drawing cannot be prepared.");
  return { canvas, ctx };
}

// Flattens onto white, scales to the long edge cap and re-encodes as JPEG. If
// the result is still over the byte cap the quality drops and then the whole
// image shrinks, and when even that is not enough the caller is told rather than
// sent an oversized request.
export async function toRequestImage(source: string | Blob, options: RequestImageOptions = {}): Promise<string> {
  if (typeof document === "undefined") throw new Error("Image resizing only runs in the browser.");
  const maxEdge = Math.max(64, options.maxEdge ?? REQUEST_MAX_EDGE);
  const maxBytes = Math.max(1024, options.maxBytes ?? REQUEST_MAX_BYTES);
  const image = await loadImage(source);
  let scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));

  for (let attempt = 0; attempt < MAX_ATTEMPTS && scale > 0.02; attempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const { canvas, ctx } = makeCanvas(width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    let quality = options.quality ?? BASE_QUALITY;
    let dataURL = canvas.toDataURL("image/jpeg", quality);
    while (dataUrlBytes(dataURL) > maxBytes && quality > FLOOR_QUALITY) {
      quality = Math.round((quality - 0.07) * 100) / 100;
      dataURL = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrlBytes(dataURL) <= maxBytes) return dataURL;
    scale *= 0.8;
  }
  throw new Error("The drawing is still too large to send after resizing. Clear part of it and try again.");
}

interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The normalized box is clamped into the picture and rounded to whole pixels,
// so a model that runs slightly past an edge still produces a real crop.
function cropRect(box: Scene["bodies"][number]["boundingBox"], width: number, height: number): CropRect | null {
  if (!box) return null;
  const left = Math.max(0, Math.min(width, Math.floor(box.x * width)));
  const top = Math.max(0, Math.min(height, Math.floor(box.y * height)));
  const right = Math.max(left, Math.min(width, Math.ceil((box.x + box.width) * width)));
  const bottom = Math.max(top, Math.min(height, Math.ceil((box.y + box.height) * height)));
  const span = { left, top, width: right - left, height: bottom - top };
  if (span.width < MIN_CROP_EDGE || span.height < MIN_CROP_EDGE) return null;
  // A box that covers the whole picture is the model describing the drawing
  // rather than one object in it, so it is not a sprite.
  if ((span.width * span.height) / (width * height) > MAX_CROP_SHARE) return null;
  return span;
}

// Luminance runs 0 for black ink and 255 for the white page, so 255 minus the
// luminance is exactly the ink coverage. Writing that straight into the alpha
// channel keeps the antialiased edge pixels instead of cutting them to a hard
// black and white line.
function inkToAlpha(data: Uint8ClampedArray): number {
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    const alpha = 255 - luminance;
    data[index + 3] = alpha;
    if (alpha > INK_ALPHA) ink += 1;
  }
  return ink;
}

// Cuts one transparent picture per body that carries a bounding box, keyed by
// body id so the canvas can look a sprite up by the id the engine moves. A crop
// that is too small, too large or has no ink in it is left out instead of being
// returned as a blank square, so a partial result is always honest about what
// it managed to cut.
export async function cropSprites(dataURL: string, scene: Scene): Promise<Record<string, string>> {
  if (typeof document === "undefined") return {};
  const targets = scene.bodies.filter((body) => body.boundingBox);
  if (targets.length === 0) return {};

  const image = await loadImage(dataURL);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const sprites: Record<string, string> = {};

  for (const body of targets) {
    const rect = cropRect(body.boundingBox, width, height);
    if (!rect) continue;
    const scale = Math.min(1, Math.sqrt(MAX_CROP_PIXELS / (rect.width * rect.height)));
    const cropWidth = Math.max(1, Math.round(rect.width * scale));
    const cropHeight = Math.max(1, Math.round(rect.height * scale));
    if (cropWidth < MIN_CROP_EDGE || cropHeight < MIN_CROP_EDGE) continue;

    const { canvas, ctx } = makeCanvas(cropWidth, cropHeight);
    ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height, 0, 0, cropWidth, cropHeight);
    const pixels = ctx.getImageData(0, 0, cropWidth, cropHeight);
    const ink = inkToAlpha(pixels.data);
    if (ink < MIN_INK_PIXELS || ink / (cropWidth * cropHeight) < MIN_INK_SHARE) continue;
    ctx.putImageData(pixels, 0, 0);
    sprites[body.id] = canvas.toDataURL("image/png");
  }

  return sprites;
}
