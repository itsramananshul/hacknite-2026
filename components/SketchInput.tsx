"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { cropSprites, toRequestImage } from "@/lib/sprites";
import { describeSceneError, validateScene, type Scene } from "@/lib/schema";
import "tldraw/tldraw.css";

// The drawing pad. tldraw is loaded in the browser only because it touches
// window while it mounts, and the licence key is passed straight through so the
// watermark behaves exactly as tldraw intends.
const Tldraw = dynamic(() => import("tldraw").then((module) => module.Tldraw), {
  ssr: false,
  loading: () => <p className="canvas-note">Loading the drawing pad.</p>,
});

const LICENSE_KEY = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const ACCEPT = ACCEPTED.join(",");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

const GUIDANCE = [
  "Draw one simple scene: an incline with a box on it, a ball leaving the ground, a ball dropped from a height, or a mass hanging on a spring.",
  "Use straight chalk lines and plain shapes, one moving object, no shading and no 3D.",
  "Write the numbers next to the shapes, for example 5 kg, 30 deg, 0.2, 10 m/s at 45 deg, 20 N/m, or a height in metres.",
  "The pad and a photo of paper go down the same path, so drawing in the app and photographing your notes both work.",
].join(" ");

const INSTRUCTION_HINT = "Optional: anything the picture cannot show, for example the ball starts 3 m above the ground.";

export interface SketchInputProps {
  onScene: (scene: Scene, sprites: Record<string, string>) => void;
}

type Stage = "idle" | "preparing" | "reading" | "crops";

// A production build with no key cannot run the pad, and saying so plainly is
// better than shipping a drawing surface that refuses to export. Uploads are not
// affected, so the panel still does its job in that configuration.
const drawingAvailable = Boolean(LICENSE_KEY) || process.env.NODE_ENV !== "production";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : false;
}

// The server returns a short sanitised message with every failure. Anything
// that is not one of those is replaced here, so a provider stack trace or a key
// can never reach the screen.
async function readFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === "string" && payload.error.trim().length > 0) return payload.error.trim();
  } catch {
    // The body was not the JSON error shape, so fall through to the status text.
  }
  if (response.status === 413) return "That drawing is larger than the reading service accepts. Clear part of it and try again.";
  if (response.status === 429) return "The reading service is busy. Wait a moment and try again.";
  if (response.status === 503) return "The reading service is not configured or is temporarily unavailable.";
  return `The reading service answered with status ${response.status}. Your scene was not changed.`;
}

export default function SketchInput({ onScene }: SketchInputProps) {
  const editorRef = useRef<Editor | null>(null);
  const runningRef = useRef(false);
  const [instruction, setInstruction] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);

  const busy = stage !== "idle";

  // One path for both sources. The pad and an uploaded photo are prepared and
  // read exactly the same way, so neither can drift from the other, and the
  // running flag makes a second click while one is in flight a no-op.
  const submit = useCallback(
    async (source: string | Blob, name: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setError(null);
      setPreviewName(name);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        setStage("preparing");
        setStatus("Resizing the drawing to 1600 pixels and checking it stays under 1.8 MB.");
        const image = await toRequestImage(source);
        setPreview(image);

        setStage("reading");
        setStatus("Sending the drawing to be read.");
        const trimmed = instruction.trim();
        const response = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trimmed.length > 0 ? { image, instruction: trimmed } : { image }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readFailure(response));

        const payload = (await response.json()) as { scene?: unknown };
        if (!payload?.scene) throw new Error("The reading service did not return a scene, so nothing was changed.");

        setStage("crops");
        setStatus("Checking the scene, then cutting out the drawn objects.");
        // The same validator the server runs, so the scene handed upwards is a
        // real Scene and not whatever the response happened to contain.
        const scene = validateScene(payload.scene);
        const sprites = await cropSprites(image, scene);
        onScene(scene, sprites);
        setStatus(`Scene ready: ${scene.problemType} with ${scene.bodies.length} objects and ${Object.keys(sprites).length} cut out.`);
      } catch (caught) {
        setError(
          isAbort(caught)
            ? "The reading request passed 60 seconds and was stopped. Your scene was not changed."
            : caught instanceof Error
              ? caught.message
              : describeSceneError(caught),
        );
        setStatus(null);
      } finally {
        clearTimeout(timer);
        runningRef.current = false;
        setStage("idle");
      }
    },
    [instruction, onScene],
  );

  const exportDrawing = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      setError("The drawing pad has not finished loading. Try again in a moment.");
      return;
    }
    const selected = editor.getSelectedShapeIds();
    // A selection is what the user means by "this part"; with nothing selected
    // the whole page is exported rather than an empty picture.
    const ids: TLShapeId[] = selected.length > 0 ? selected : Array.from(editor.getCurrentPageShapeIds());
    if (ids.length === 0) {
      setError("There is nothing on the pad yet. Draw the scene first.");
      return;
    }
    setError(null);
    setStage("preparing");
    setStatus("Exporting your drawing from the pad.");
    try {
      const { blob } = await editor.toImage(ids, { format: "png", background: true });
      await submit(blob, "Drawing from the pad");
    } catch (caught) {
      setError(caught instanceof Error ? `The pad could not export that drawing. ${caught.message}` : describeSceneError(caught));
      setStatus(null);
      setStage("idle");
    }
  }, [submit]);

  const clearPad = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.deleteShapes(Array.from(editor.getCurrentPageShapeIds()));
    editor.selectNone();
    setError(null);
    setStatus(null);
  }, []);

  const chooseFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!ACCEPTED.includes(file.type)) {
        setError("Pick a PNG, JPEG or WebP picture of the drawing. Nothing was sent.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("That file is larger than 10 MB. Photograph the page again at a smaller size, or crop it first.");
        return;
      }
      let prepared: string;
      try {
        // Prepared here so a file that cannot be decoded is reported before
        // anything is sent, and so the resize and the re-encode happen once.
        prepared = await toRequestImage(file);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : describeSceneError(caught));
        return;
      }
      await submit(prepared, file.name);
    },
    [submit],
  );

  return (
    <section className="panel" aria-labelledby="sketch-heading">
      <h3 id="sketch-heading">Draw or upload your own scene</h3>
      <p className="canvas-note" id="sketch-guidance">
        {GUIDANCE}
      </p>

      {drawingAvailable ? (
        <>
          <div
            style={{
              position: "relative",
              height: 420,
              marginTop: 12,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(242, 247, 241, 0.16)",
            }}
          >
            <Tldraw
              onMount={(editor: Editor) => {
                editorRef.current = editor;
              }}
              licenseKey={LICENSE_KEY}
              persistenceKey="chalk-sketch"
            />
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={exportDrawing} disabled={busy}>
              Read my drawing
            </button>
            <button type="button" className="btn" onClick={clearPad} disabled={busy}>
              Clear the pad
            </button>
          </div>
        </>
      ) : (
        <div className="notice" style={{ marginTop: 12 }}>
          <p>
            <strong>The drawing pad needs a tldraw licence key.</strong> This build has no
            NEXT_PUBLIC_TLDRAW_LICENSE_KEY, so the pad is switched off rather than shown without its licence
            watermark. Add the key to the environment and rebuild to turn it back on.
          </p>
          <p>Uploading a photo of your notes below works exactly the same way and is not affected.</p>
        </div>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label className="canvas-note" htmlFor="sketch-instruction">
          {INSTRUCTION_HINT}
        </label>
        <textarea
          id="sketch-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          maxLength={600}
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 44,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(242, 247, 241, 0.22)",
            background: "rgba(12, 24, 19, 0.5)",
            color: "var(--color-chalk)",
            font: "inherit",
            resize: "vertical",
          }}
        />

        <div className="toolbar">
          <label className="canvas-note" htmlFor="sketch-file">
            Or upload a picture of your notes, PNG, JPEG or WebP up to 10 MB.
          </label>
          <input
            id="sketch-file"
            type="file"
            accept={ACCEPT}
            disabled={busy}
            aria-describedby="sketch-guidance"
            onClick={(event) => {
              // A second pick of the same file has to fire a change event.
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
            }}
            style={{ minHeight: 44, color: "var(--color-chalk-dim)", maxWidth: "100%" }}
          />
        </div>

        {preview ? (
          <figure style={{ margin: 0, display: "grid", gap: 6 }}>
            <img
              src={preview}
              alt={`The drawing that will be read${previewName ? `, from ${previewName}` : ""}, resized to 1600 pixels on the long edge.`}
              style={{
                width: "100%",
                maxHeight: 220,
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid rgba(242, 247, 241, 0.16)",
                background: "#ffffff",
              }}
            />
            <figcaption className="canvas-note">This is the resized picture that gets sent, not the original file.</figcaption>
          </figure>
        ) : null}

        <p role="status" aria-live="polite" className="canvas-note" style={{ minHeight: 22 }}>
          {status ?? ""}
        </p>
        {error ? (
          <p role="alert" style={{ color: "var(--color-peach)", fontSize: "0.88rem", overflowWrap: "anywhere" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
