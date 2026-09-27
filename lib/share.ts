// Share links for a scene.
//
// The whole scene is compressed into the URL hash, so nothing is uploaded and no
// server ever sees the link. A hash is also never sent to the origin server, so
// the compressed scene cannot leak through referrers or access logs.
//
// What travels is the scene description only: the boxes, the ramp, the world
// and the question. Sprite pixels are deliberately left out, because a data URL
// of a cropped picture would add hundreds of kilobytes to every link. That is
// why a shared link reopens as clean vector shapes rather than as the hand drawn
// chalk that produced them, which is also the point of sharing it.
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { describeSceneError, validateScene, type Scene } from "./schema";

// A compressed scene of a supported problem is a couple of kilobytes at most, so
// these caps only ever reject a hand edited or hostile hash. They are checked
// before decompressing and again after, which is what keeps a zip bomb out of
// the client.
export const MAX_ENCODED_LENGTH = 20_000;
const MAX_DECODED_LENGTH = 100_000;

export function encodeScene(scene: Scene): string {
  // Validating first means a link can never be built for a scene that would be
  // rejected the moment it is opened again.
  const checked = validateScene(scene);
  return compressToEncodedURIComponent(JSON.stringify(checked));
}

// Returns null for anything that is not a scene we can open, so the caller can
// fall back to a preset instead of rendering a broken diagram.
export function decodeScene(encoded: string): Scene | null {
  if (typeof encoded !== "string") return null;
  const trimmed = encoded.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ENCODED_LENGTH) return null;
  let json: string;
  try {
    json = decompressFromEncodedURIComponent(trimmed);
  } catch {
    return null;
  }
  if (typeof json !== "string" || json.length === 0 || json.length > MAX_DECODED_LENGTH) return null;
  try {
    return validateScene(JSON.parse(json));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("Shared scene rejected:", describeSceneError(error));
    return null;
  }
}

export const SHARE_HASH_PREFIX = "#scene=";

export function createShareUrl(scene: Scene): string {
  if (typeof window === "undefined") {
    throw new Error("A share link can only be built in the browser.");
  }
  return `${window.location.origin}${window.location.pathname}${SHARE_HASH_PREFIX}${encodeScene(scene)}`;
}

// Reads our own fragment back. Returns null when the page was opened without a
// scene in the hash, which is the normal case for a plain visit.
export function readShareHash(hash?: string): Scene | null {
  if (typeof window === "undefined") return null;
  const raw = hash ?? window.location.hash;
  const start = raw.indexOf(SHARE_HASH_PREFIX);
  if (start < 0) return null;
  return decodeScene(raw.slice(start + SHARE_HASH_PREFIX.length));
}
