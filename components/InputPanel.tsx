"use client";

// The only place a problem enters Chalk. The reader types it, picks a photo,
// or holds a book page up to the camera, and this panel hands the text and one
// resized image to /api/solve. The server does the reading, the solving and the
// scene building, and the panel shows what came back. Nothing here invents a
// result. Calculated answers stream to the current notebook page, and an error
// leaves the typed problem and the photo exactly where they were.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SolveResult } from "@/lib/gemini";
import {readSolveStream} from "@/lib/solve-stream";

export type { SolveResult };

export interface InputPanelProps {
  subject?: "physics"|"chemistry"|"mathematics";
  initialProblemText?: string;
  onStarted: (problemText: string) => string;
  onAnswers: (result: Omit<SolveResult,"scene">, pageId: string) => void;
  onFailed: (message: string, pageId: string) => void;
  onSolved: (result: SolveResult, pageId: string) => void;
}

const MAX_TEXT_CHARS = 6000;
const MAX_EDGE_PX = 1600;
const MAX_IMAGE_BYTES = 1.8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 600_000;
const QUALITIES = [0.9, 0.82, 0.72, 0.6, 0.5];
const WORKING_STATUS =
  "Reading your problem, calculating the answer, and building the 3D scene.";

function decodedBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.floor((body.length / 4) * 3) - padding;
}

/**
 * Draws whatever the device gave us into a canvas no wider than 1600 pixels and
 * walks the JPEG quality down until the encoded picture fits the request. The
 * resize happens here so a phone photo never becomes a 3MB upload.
 */
function encodeJpeg(source: CanvasImageSource, width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  // A screenshot can be transparent, and JPEG has no transparency, so the
  // picture would otherwise arrive at the model as black text on black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of QUALITIES) {
    let encoded: string;
    try {
      encoded = canvas.toDataURL("image/jpeg", quality);
    } catch {
      return null;
    }
    if (decodedBytes(encoded) <= MAX_IMAGE_BYTES) return encoded;
  }
  return null;
}

function readFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image. Try a PNG, JPEG or WebP photo."));
    };
    image.src = url;
  });
}

async function readFailure(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  } catch {
    // A proxy or a crash can answer with a body that is not JSON at all.
  }
  return `The service answered ${response.status} without a reason. Try again.`;
}

export default function InputPanel({ initialProblemText = "", subject = "physics", onStarted, onAnswers, onFailed, onSolved }: InputPanelProps) {
  const [problemText, setProblemText] = useState(initialProblemText);
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The flag is what actually blocks a second submit: a disabled button is not
  // enough while the click and the state update are still in the same tick.
  const inFlight = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOpen || !video || !stream) return;
    video.srcObject = stream;
    const started = video.play();
    if (started && typeof started.catch === "function") started.catch(() => undefined);
  }, [cameraOpen]);

  const acceptFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    if (file.size > 24 * 1024 * 1024) {
      setImageError("That photo is larger than 24MB. Take the picture again at a lower resolution.");
      return;
    }
    try {
      const picture = await readFile(file);
      const encoded = encodeJpeg(picture, picture.naturalWidth, picture.naturalHeight);
      if (!encoded) {
        setImageError("That photo could not be prepared. Try a different picture.");
        return;
      }
      setImage(encoded);
    } catch (problem) {
      setImageError(problem instanceof Error ? problem.message : "That file could not be read as an image.");
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "This browser will not open the camera here. A camera needs HTTPS or localhost, so upload a photo of the problem instead.",
      );
      return;
    }
    try {
      // The camera is only ever opened by this button, never on load.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setCameraError(
        "The camera could not be started. Allow camera access for this page, or upload a photo of the problem instead.",
      );
    }
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const encoded = encodeJpeg(video, video.videoWidth, video.videoHeight);
    stopCamera();
    if (!encoded) {
      setImageError("That frame could not be captured. Try again with the page in focus.");
      return;
    }
    setImage(encoded);
    setImageError(null);
  }, [stopCamera]);

  const clearImage = useCallback(() => {
    setImage(null);
    setImageError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const solve = useCallback(async () => {
    const text = problemText.trim();
    if (inFlight.current || (!text && !image)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus(WORKING_STATUS);
    const pageId = onStarted(text);
    const controller = new AbortController();
    let ranOut = false;
    const timer = setTimeout(() => {
      ranOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept":"application/x-ndjson" },
        body: JSON.stringify({ problemText: text || undefined, image: image ?? undefined, subject }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await readFailure(response));
      }
      const payload: unknown = response.headers.get("content-type")?.includes("application/x-ndjson")
        ? await readSolveStream(response,result=>{
          onAnswers(result,pageId);
          setStatus("Your answer is calculated. Building the 3D explanation…");
        })
        : await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("The service answered without a solution.");
      }
      const result = payload as {
        scene?: SolveResult["scene"];
        solutionText?: unknown;
        answers?: unknown;
        warnings?: unknown;
      };
      if (typeof result.solutionText !== "string") {
        throw new Error("The service answered without a solution.");
      }
      const answers = Array.isArray(result.answers) ? (result.answers as SolveResult["answers"]) : [];
      const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
      setStatus(
        result.scene
          ? "Done. The scene is on the board."
          : "Solved. There is no animation for this one, so the numbers and the written solution are below.",
      );
      onSolved({
        scene: result.scene ?? null,
        solutionText: result.solutionText,
        answers,
        warnings,
      },pageId);
    } catch (failure) {
      setStatus(null);
      const message =
        ranOut
          ? `The solver did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds, so the request was stopped. Your problem is still here, press Solve again.`
          : failure instanceof Error ? failure.message : "The request to the server did not finish. Your problem is still here, press Solve again.";
      setError(message);
      onFailed(message,pageId);
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setBusy(false);
    }
  }, [image, onStarted, onAnswers, onFailed, onSolved, problemText, subject]);

  const canSolve = (problemText.trim().length > 0 || image !== null) && !busy;

  return (
    <section className="panel" aria-label="Give Chalk a problem">
      <p className="panel-title">Your problem</p>

      <div className="field-stacked">
        <label className="field" htmlFor="chalk-problem">
          Type the problem
        </label>
        <textarea
          id="chalk-problem"
          value={problemText}
          maxLength={MAX_TEXT_CHARS}
          rows={5}
          placeholder="A 2 kg block slides down a 30 degree incline with mu = 0.2. How fast is it going after it falls 3 m?"
          onChange={(event) => setProblemText(event.target.value)}
        />
        <p className="muted">
          {problemText.length} of {MAX_TEXT_CHARS} characters. A photo on its own is enough.
        </p>
      </div>

      <div className="field-stacked" style={{ marginTop: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          tabIndex={-1}
          hidden
          onChange={(event) => {
            void acceptFile(event.target.files?.[0]);
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Upload a photo
          </button>
          {cameraOpen ? (
            <>
              <button type="button" className="btn btn-primary" onClick={captureFrame}>
                Take the photo
              </button>
              <button type="button" className="btn" onClick={stopCamera}>
                Close the camera
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => void startCamera()}>
              Use the camera
            </button>
          )}
        </div>
        <p className="muted">
          PNG, JPEG or WebP. The picture is resized to 1600 pixels on this device before it is sent, and the
          camera only opens when you ask it to.
        </p>
      </div>

      {cameraOpen ? (
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview of the problem"
          style={{ width: "100%", maxHeight: 260, marginTop: 10, borderRadius: 12, background: "#000" }}
        />
      ) : null}

      {cameraError ? (
        <p className="notice notice-warn" role="status" style={{ marginTop: 10 }}>
          {cameraError}
        </p>
      ) : null}

      {image ? (
        <div style={{ marginTop: 10 }}>
          <img
            src={image}
            alt="The problem you attached"
            style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 12 }}
          />
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={clearImage}>
            Remove the photo
          </button>
        </div>
      ) : null}

      {imageError ? (
        <p className="notice notice-warn" role="status" style={{ marginTop: 10 }}>
          {imageError}
        </p>
      ) : null}

      <button type="button" className="btn btn-primary btn-wide" disabled={!canSolve} onClick={() => void solve()}>
        {busy ? "Solving" : "Solve it"}
      </button>

      {status ? (
        <p className="muted" role="status" aria-live="polite" style={{ marginTop: 10 }}>
          {status}
        </p>
      ) : null}

      {error ? (
        <p className="notice notice-warn" role="status" style={{ marginTop: 10 }}>
          {error}
        </p>
      ) : null}

      {error ? (
        <p className="muted" style={{ marginTop: 8 }}>
          The presets in the corner load without a key and without a network, so the board is never empty.
        </p>
      ) : null}
    </section>
  );
}
