"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeSceneError, validateScene, type Scene } from "@/lib/schema";
import { loadImage, toRequestImage } from "@/lib/sprites";

// Annotate the paused board.
//
// The annotation starts from whatever the simulation canvas is showing right
// now, read through the getSnapshot the coordinator supplies, so what is
// annotated is exactly the frame the user is looking at. The marks are drawn
// on top of that picture on the same canvas, never on a blank sheet, and the
// composite is what gets sent.
//
// A drawn arrow is not read as a force here. The only number the panel can
// state is the one the user types, for example 20 N, and that text is the
// instruction; the reading service decides what the mark means. Nothing is
// inferred locally and nothing is invented, so a successful apply means the
// service returned a scene.

const TIMEOUT_MS = 60_000;
const STROKE_WIDTH = 4;
const INK = "#f2f7f1";

export interface AnnotationPanelProps {
  scene: Scene;
  onScene: (scene: Scene) => void;
  // The coordinator reads its own paused canvas, so a snapshot is never taken
  // from a frame that is still moving. It returns null when there is nothing to
  // annotate.
  getSnapshot: () => string | null;
}

interface Point {
  x: number;
  y: number;
}

type Stroke = Point[];
type Stage = "idle" | "sending";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : false;
}

async function readFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === "string" && payload.error.trim().length > 0) return payload.error.trim();
  } catch {
    // The body was not the JSON error shape, so fall through to the status text.
  }
  if (response.status === 413) return "That annotated picture is larger than the service accepts. Try a smaller board.";
  if (response.status === 429) return "The service is busy. Wait a moment and try again.";
  if (response.status === 503) return "The service is not configured or is temporarily unavailable.";
  return `The service answered with status ${response.status}. Your scene was not changed.`;
}

export default function AnnotationPanel({ scene, onScene, getSnapshot }: AnnotationPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const runningRef = useRef(false);
  const [active, setActive] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inkCount, setInkCount] = useState(0);

  const busy = stage !== "idle";

  // Identity of what the paused board shows, so the effect below reacts to a real
  // change of scene rather than to a parent handing over a fresh object.
  const layoutKey = useMemo(
    () => scene.bodies.map((body) => `${body.id}:${body.x.toFixed(4)}:${body.y.toFixed(4)}:${body.angleDeg.toFixed(4)}`).join("|"),
    [scene],
  );
  const layoutRef = useRef(layoutKey);

  // Repaint is a pure function of the background picture and the stroke list,
  // so every change is a full redraw and the marks can never drift off the
  // picture they belong to.
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = INK;
    for (const stroke of strokesRef.current) {
      ctx.beginPath();
      stroke.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (stroke.length === 1) {
        // A tap with no drag still leaves a dot, so a short arrow head is not
        // silently thrown away.
        const only = stroke[0];
        ctx.moveTo(only.x + 0.1, only.y);
        ctx.lineTo(only.x, only.y);
      }
      ctx.stroke();
    }
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setInkCount(0);
    setStatus(null);
    setError(null);
    strokesRef.current = [];
    imageRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);
    const snapshot = getSnapshot();
    if (!snapshot) {
      setError("There is no paused board to annotate yet. Load a scene and pause it first.");
      return;
    }
    try {
      const image = await loadImage(snapshot);
      imageRef.current = image;
      strokesRef.current = [];
      setInkCount(0);
      setActive(true);
      setStatus("Draw on the picture, then apply. The numbers you type are the only force values used.");
    } catch (caught) {
      imageRef.current = null;
      setActive(false);
      setError(caught instanceof Error ? caught.message : describeSceneError(caught));
    }
  }, [getSnapshot]);

  useEffect(() => {
    // The canvas only exists once the panel is showing, so it is sized from the
    // snapshot on the way in rather than at the moment the snapshot arrives.
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!active || !canvas || !image) return;
    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }
    repaint();
  }, [active, repaint]);

  useEffect(() => {
    // A new scene means the paused picture behind the marks is gone, so the
    // panel closes rather than annotating a board that is no longer on screen.
    // The key is the layout rather than the object identity, so a parent that
    // rebuilds an identical scene each render does not close the panel.
    if (layoutRef.current === layoutKey) return;
    layoutRef.current = layoutKey;
    stop();
  }, [layoutKey, stop]);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    // The backing store is the size of the snapshot, so a mark lands on the same
    // pixel whatever width the board happens to be shown at on screen.
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!active || busy) return;
    const point = positionOf(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, [point]];
    setInkCount(strokesRef.current.length);
    repaint();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) return;
    const point = positionOf(event);
    if (!point) return;
    const strokes = strokesRef.current;
    const current = strokes[strokes.length - 1];
    if (!current) return;
    current.push(point);
    repaint();
  };

  const endStroke = (): void => {
    drawingRef.current = false;
  };

  const clear = useCallback(() => {
    strokesRef.current = [];
    setInkCount(0);
    setError(null);
    setStatus("Marks cleared. The picture underneath is untouched.");
    repaint();
  }, [repaint]);

  const apply = useCallback(async () => {
    if (runningRef.current) return;
    const image = imageRef.current;
    if (!image) {
      setError("There is no picture to annotate. Start annotating first.");
      return;
    }
    runningRef.current = true;
    setError(null);
    setStage("sending");
    setStatus("Flattening the marks onto the board and resizing it.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("This browser did not give us a 2D canvas, so the marks cannot be sent.");
      const composite = canvas.toDataURL("image/png");
      const bounded = await toRequestImage(composite);

      setStatus("Sending the annotated board to be read.");
      const trimmed = instruction.trim();
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed.length > 0 ? { image: bounded, scene, instruction: trimmed } : { image: bounded, scene }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readFailure(response));

      const payload = (await response.json()) as { scene?: unknown };
      if (!payload?.scene) throw new Error("The service did not return a scene, so nothing was changed.");
      // Only a validated scene replaces the current one, so a failure can never
      // leave the board showing a half applied annotation.
      onScene(validateScene(payload.scene));
      // The confirmation is set after closing, because closing clears the status.
      stop();
      setStatus("Annotation applied.");
    } catch (caught) {
      setError(
        isAbort(caught)
          ? "The request passed 60 seconds and was stopped. Your scene was not changed."
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
  }, [instruction, onScene, scene, stop]);

  return (
    <section className="panel" aria-labelledby="annotation-heading">
      <h3 id="annotation-heading">Annotate the paused board</h3>
      <p className="canvas-note">
        Draw an arrow or a note straight onto the board, then say what it means. Only the numbers you type are used,
        for example 20 N, and the picture is left as it is drawn. There is no camera here.
      </p>

      {!active ? (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            Annotate the paused board
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="The paused board with your chalk marks drawn on top of it. Draw with a pointer or a finger."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 12,
              border: "1px solid rgba(242, 247, 241, 0.16)",
              touchAction: "none",
              cursor: "crosshair",
            }}
          />

          <label className="canvas-note" htmlFor="annotation-instruction">
            What the marks mean, for example: a 20 N push along the ramp.
          </label>
          <textarea
            id="annotation-instruction"
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
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
              Apply annotation
            </button>
            <button type="button" className="btn" onClick={clear} disabled={busy}>
              Clear marks ({inkCount})
            </button>
            <button type="button" className="btn" onClick={stop} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className="canvas-note" style={{ minHeight: 22 }}>
        {status ?? ""}
      </p>
      {error ? (
        <p role="alert" style={{ color: "var(--color-peach)", fontSize: "0.88rem", overflowWrap: "anywhere" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
