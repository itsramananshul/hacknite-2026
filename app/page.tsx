"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SimulationCanvas from "@/components/SimulationCanvas";
import { getDuration, sampleScene, type AnalyticalFrame } from "@/lib/engine";
import { presetList, presets, type PresetKey } from "@/lib/presets";
import { describeSceneError, resolveScene, type LabelApplication, type Scene } from "@/lib/schema";
import { parameterSpecs, updateSceneParameter, type ParameterField, type ParameterSpec } from "@/lib/scene-controls";
import { createShareUrl, readShareHash, SHARE_HASH_PREFIX } from "@/lib/share";
import { solveScene, type SolverResult } from "@/lib/solvers";

// The board is a client rendered teaching surface over the analytical core. A
// preset and a scene read from a picture take the identical route through
// resolveScene, getDuration, sampleScene and solveScene, so the drawing, the
// sliders and the answer can never describe different physics.

// The drawing board and the annotation board carry their own editors, so they
// load only when the reader asks for them and the canvas stays the first paint.
const SketchInput = dynamic(() => import("@/components/SketchInput"), {
  ssr: false,
  loading: () => <p className="hint">Loading the drawing board.</p>,
});

const AnnotationPanel = dynamic(() => import("@/components/AnnotationPanel"), {
  ssr: false,
  loading: () => <p className="hint">Loading the annotation board.</p>,
});

interface CatalogueEntry {
  key: PresetKey;
  name: string;
  blurb: string;
  preset: Scene;
}

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

// The catalogue is built from whatever the engine exports, so a preset the
// analytical core adds later shows up without any change here.
const catalogue: CatalogueEntry[] = (Object.keys(presets) as PresetKey[])
  .filter((key) => Boolean(presets[key]))
  .map((key) => {
    const listed = presetList.find((item) => item.key === key);
    return {
      key,
      name: listed?.name ?? capitalise(key),
      blurb: listed?.blurb ?? presets[key].question.text,
      preset: presets[key],
    };
  });

const DEFAULT_KEY: PresetKey = catalogue.some((item) => item.key === "incline") ? "incline" : catalogue[0].key;

// A source is either a preset that ships with the app or a scene read from the
// reader's own drawing, together with the crops cut out of that drawing.
interface Source {
  kind: "preset" | "custom";
  title: string;
  blurb: string;
  scene: Scene;
  sprites: Record<string, string>;
}

interface Model {
  title: string;
  blurb: string;
  scene: Scene | null;
  labels: LabelApplication[];
  duration: number;
  answer: SolverResult | null;
  answerError: string | null;
  error: string | null;
}

function buildModel(source: Source): Model {
  const empty: Model = {
    title: source.title,
    blurb: source.blurb,
    scene: null,
    labels: [],
    duration: 0,
    answer: null,
    answerError: null,
    error: null,
  };
  try {
    // Presets are shared module state, so every scene is edited on a copy.
    const draft = structuredClone(source.scene) as Scene;
    const resolved = resolveScene(draft);
    const duration = getDuration(resolved.scene);
    sampleScene(resolved.scene, 0);
    let answer: SolverResult | null = null;
    let answerError: string | null = null;
    try {
      answer = solveScene(resolved.scene);
    } catch (error) {
      // A scene without a closed form answer is a normal state, not a failure.
      answerError = describeSceneError(error);
    }
    return {
      title: source.title,
      blurb: source.blurb,
      scene: resolved.scene,
      labels: resolved.labels,
      duration,
      answer,
      answerError,
      error: null,
    };
  } catch (error) {
    return { ...empty, error: describeSceneError(error) };
  }
}

const number = (value: number, digits = 3): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "not available";

interface MetricRow {
  label: string;
  value: string;
}

// The frame reports the state at that instant, so a partial run is described as
// "so far" and the finished value is the solver answer in the other column.
function metricRows(frame: AnalyticalFrame, problemType: Scene["problemType"]): MetricRow[] {
  const metrics = frame.metrics;
  const rows: MetricRow[] = [{ label: "Time elapsed", value: `${number(metrics.time)} s` }];
  if (problemType === "incline") {
    rows.push({ label: "Distance along the ramp so far", value: `${number(metrics.distance)} m` });
    rows.push({ label: "Speed now", value: `${number(metrics.finalSpeed)} m/s` });
  } else if (problemType === "projectile" || problemType === "freefall") {
    rows.push({ label: "Horizontal range so far", value: `${number(metrics.range)} m` });
    rows.push({ label: "Highest point so far", value: `${number(metrics.maxHeight)} m` });
    rows.push({ label: "Speed now", value: `${number(metrics.finalSpeed)} m/s` });
  } else {
    rows.push({ label: "Distance travelled so far", value: `${number(metrics.distance)} m` });
    rows.push({ label: "Speed now", value: `${number(metrics.finalSpeed)} m/s` });
    if (metrics.period !== null) rows.push({ label: "Period", value: `${number(metrics.period)} s` });
  }
  return rows;
}

const ENERGY_ROWS = [
  { key: "kinetic", label: "Kinetic", colour: "var(--color-peach)" },
  { key: "potential", label: "Potential, against the reference plane", colour: "var(--color-lavender)" },
  { key: "dissipated", label: "Dissipated by friction", colour: "var(--color-mint)" },
] as const;

const Readout = memo(function Readout({
  frame,
  duration,
  problemType,
}: {
  frame: AnalyticalFrame;
  duration: number;
  problemType: Scene["problemType"];
}) {
  const rows = metricRows(frame, problemType);
  const energy = frame.energy;
  const peak = Math.max(Math.abs(energy.kinetic), Math.abs(energy.potential), Math.abs(energy.dissipated), 1e-9);
  const belowPlane = energy.potential < 0;
  return (
    <div className="readout">
      <div className="readout-head">
        <span className="num">t = {number(frame.time)} s</span>
        <span className="num">of {number(duration)} s in this scene</span>
        <span>{frame.finished ? "End of the scene" : "State at the current instant"}</span>
      </div>
      <dl className="metrics">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className="num">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="energy">
        {ENERGY_ROWS.map((row) => {
          const value = energy[row.key];
          const share = Math.max(0, Math.min(1, Math.abs(value) / peak));
          return (
            <div className="energy-row" key={row.key}>
              <div className="energy-label">
                <span>{row.label}</span>
                <span className="num">{number(value, 2)} J</span>
              </div>
              <div
                className="energy-track"
                role="img"
                aria-label={`${row.label}: ${number(value, 2)} joules`}
              >
                <div className="energy-fill" style={{ width: `${share * 100}%`, background: row.colour }} />
              </div>
            </div>
          );
        })}
        <p className="energy-note">
          Bars are scaled to the largest of the three values.
          {belowPlane
            ? " Potential is negative because this body sits below the plane the potential energy is measured from."
            : ""}
        </p>
      </div>
    </div>
  );
});

const GIVEN_COPY: Record<LabelApplication["field"], string> = {
  mass: "mass",
  angleDeg: "angle",
  friction: "friction coefficient",
  speed: "launch speed",
  launchAngleDeg: "launch angle",
  height: "starting height",
  stiffness: "stiffness",
};

interface Notice {
  tone: "info" | "error";
  text: string;
}

type Panel = "sketch" | "experiment" | null;

const CANVAS_QUERY = 'canvas[data-chalk-simulation]';

// The model and the solver only understand the numbers, so a crop from a
// previous picture is kept only while its body still exists in the new scene.
function keepSprites(sprites: Record<string, string>, scene: Scene): Record<string, string> {
  const ids = new Set(scene.bodies.map((body) => body.id));
  return Object.fromEntries(Object.entries(sprites).filter(([id]) => ids.has(id)));
}

function sliderDigits(step: number): number {
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

const Controls = memo(function Controls({
  specs,
  onChange,
}: {
  specs: ParameterSpec[];
  onChange: (field: ParameterField, value: number) => void;
}) {
  if (specs.length === 0) {
    return <p className="hint">This scene has no single number that can be swept. Every other control still works.</p>;
  }
  return (
    <div className="controls">
      {specs.map((spec) => {
        const id = `control-${spec.field}`;
        return (
          <div className="control" key={spec.field}>
            <label htmlFor={id}>
              <span>{spec.label}</span>
              <span className="num">
                {spec.value.toFixed(sliderDigits(spec.step))}
                {spec.unit ? ` ${spec.unit}` : ""}
              </span>
            </label>
            <input
              id={id}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={spec.value}
              onChange={(event) => onChange(spec.field, Number(event.target.value))}
            />
          </div>
        );
      })}
    </div>
  );
});

async function readFailure(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.trim().length > 0) return error.trim();
    }
  } catch {
    // A proxy or a crash can answer with a body that is not JSON at all.
  }
  return `The service answered ${response.status} ${response.statusText || "without a reason"}.`;
}

function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message.length > 0 ? message : fallback;
}

export default function Page() {
  const [presetKey, setPresetKey] = useState<PresetKey>(DEFAULT_KEY);
  const [custom, setCustom] = useState<{ scene: Scene; sprites: Record<string, string> } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [frame, setFrame] = useState<AnalyticalFrame | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; copied: boolean } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const explainAbort = useRef<AbortController | null>(null);
  const explainRequest = useRef(0);

  const source = useMemo<Source | null>(() => {
    if (custom) {
      return {
        kind: "custom",
        title: "Your sketch",
        blurb: "The scene read from the picture you drew.",
        scene: custom.scene,
        sprites: custom.sprites,
      };
    }
    const entry = catalogue.find((item) => item.key === presetKey) ?? catalogue[0];
    return { kind: "preset", title: entry.name, blurb: entry.blurb, scene: entry.preset, sprites: {} };
  }, [custom, presetKey]);

  const model = useMemo<Model | null>(() => (source ? buildModel(source) : null), [source, resetKey]);

  // Everything the panels say about a scene is tied to the numbers, so a link,
  // a slider or an edited board retires the previous share link and the previous
  // explanation instead of leaving them to describe a board that no longer exists.
  const sceneSignature = useMemo(
    () =>
      model?.scene
        ? JSON.stringify([
            model.scene.problemType,
            model.scene.question,
            model.scene.bodies,
            model.scene.constraints,
            model.scene.appliedForces ?? [],
            model.scene.labeledValues,
          ])
        : "",
    [model?.scene],
  );

  const specs = useMemo(() => (model?.scene ? parameterSpecs(model.scene) : []), [model?.scene]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.location.hash;
    if (!raw.includes(SHARE_HASH_PREFIX)) return;
    const opened = readShareHash(raw);
    if (opened) {
      setCustom({ scene: opened, sprites: {} });
      setResetKey((value) => value + 1);
      setNotice({
        tone: "info",
        text: "Opened the scene from the link and paused it at the start. A link carries the numbers only, so this board shows the chalk shapes rather than the picture that was drawn.",
      });
      return;
    }
    setNotice({
      tone: "error",
      text: "That link does not hold a scene Chalk can open, so the incline preset is on the board instead. Choose a preset, or draw a new problem.",
    });
  }, []);

  useEffect(() => {
    // A board that changed under the reader retires both the in flight request
    // and whatever it was going to say.
    setExplanation(null);
    setExplainError(null);
    explainAbort.current?.abort();
  }, [sceneSignature]);

  useEffect(() => () => explainAbort.current?.abort(), []);

  // Every scene change pauses the clock and rewinds to the first frame, so a new
  // board never inherits the instant an older one was left at.
  const adopt = useCallback((next: { scene: Scene; sprites: Record<string, string> }, message?: string) => {
    setCustom(next);
    setPlaying(false);
    setFrame(null);
    setResetKey((value) => value + 1);
    setShare(null);
    setExplanation(null);
    setExplainError(null);
    if (message) setNotice({ tone: "info", text: message });
  }, []);

  const selectPreset = useCallback((key: PresetKey) => {
    setPresetKey(key);
    setCustom(null);
    setPlaying(false);
    setFrame(null);
    setResetKey((value) => value + 1);
    setShare(null);
    setExplanation(null);
    setExplainError(null);
    setAnnotating(false);
    setNotice(null);
    setControlError(null);
  }, []);

  const togglePlay = useCallback(() => setPlaying((value) => !value), []);

  const reset = useCallback(() => {
    setPlaying(false);
    setFrame(null);
    setResetKey((value) => value + 1);
  }, []);

  const handleFrame = useCallback((next: AnalyticalFrame) => {
    // A pause, a reset and the first paint of a new scene can all report the
    // same instant, so keeping the identity stable avoids pointless re-renders.
    setFrame((previous) => (previous && previous.time === next.time ? previous : next));
  }, []);

  const handleComplete = useCallback(() => setPlaying(false), []);

  const handleSketch = useCallback(
    (scene: Scene, sprites: Record<string, string>) => {
      adopt(
        { scene, sprites },
        `Your drawing is on the board, paused at the start with ${Object.keys(sprites).length} cropped ${
          Object.keys(sprites).length === 1 ? "piece" : "pieces"
        }. Press Play to watch it move.`,
      );
    },
    [adopt],
  );

  const changeParameter = useCallback(
    (field: ParameterField, value: number) => {
      if (!model?.scene) return;
      try {
        const next = updateSceneParameter(model.scene, field, value);
        // The crops belong to the picture, not to the numbers, so a slider keeps them.
        adopt({ scene: next, sprites: custom?.sprites ?? {} });
        setControlError(null);
      } catch (error) {
        setControlError(errorText(error, "That control cannot be used on this scene."));
      }
    },
    [model, custom, adopt],
  );

  const shareScene = useCallback(() => {
    if (!model?.scene) return;
    try {
      const url = createShareUrl(model.scene);
      setNotice(null);
      setShare({ url, copied: false });
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => setShare({ url, copied: true }),
          () => setShare({ url, copied: false }),
        );
      }
    } catch (error) {
      setShare(null);
      setNotice({ tone: "error", text: errorText(error, "This scene is too large to put in a link.") });
    }
  }, [model]);

  const askExplain = useCallback(async () => {
    if (!model?.scene) return;
    explainAbort.current?.abort();
    const controller = new AbortController();
    explainAbort.current = controller;
    const ticket = explainRequest.current + 1;
    explainRequest.current = ticket;
    setExplainBusy(true);
    setExplainError(null);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: model.scene }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readFailure(response));
      const payload: unknown = await response.json();
      const text =
        payload && typeof payload === "object" && "explanation" in payload
          ? (payload as { explanation?: unknown }).explanation
          : undefined;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("The explanation service answered without any text.");
      }
      // A slower answer for a board that has moved on is dropped, never shown.
      if (explainRequest.current !== ticket) return;
      setExplanation(text);
    } catch (error) {
      if (controller.signal.aborted || explainRequest.current !== ticket) return;
      setExplanation(null);
      setExplainError(errorText(error, "The explanation could not be read."));
    } finally {
      if (explainRequest.current === ticket) setExplainBusy(false);
    }
  }, [model]);

  const getSnapshot = useCallback((): string | null => {
    if (typeof document === "undefined") return null;
    const canvas = document.querySelector<HTMLCanvasElement>(CANVAS_QUERY);
    if (!canvas) return null;
    try {
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }, []);

  const startAnnotation = useCallback(() => {
    // The snapshot is taken from a board that is already still.
    setPlaying(false);
    setAnnotating(true);
  }, []);

  const applyAnnotated = useCallback((scene: Scene) => {
    setCustom((previous) => ({ scene, sprites: previous ? keepSprites(previous.sprites, scene) : {} }));
    setAnnotating(false);
    setPlaying(false);
    setFrame(null);
    setResetKey((value) => value + 1);
    setNotice({ tone: "info", text: "The new board is on the chalk, paused at the start." });
  }, []);

  const live = frame;
  const answer = model?.answer ?? null;
  const springExtra = (answer ?? {}) as { period?: number; amplitude?: number };
  const scene = model?.scene ?? null;
  const confidence = scene ? Math.round(Math.max(0, Math.min(1, scene.confidence)) * 100) : 0;
  const notes = scene?.notes.trim() ?? "";
  const status = model?.error
    ? "Scene could not be loaded"
    : live?.finished
      ? "Finished"
      : playing
        ? "Playing"
        : "Paused";

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Physics teaching board</p>
          <h1 className="wordmark">Chalk</h1>
          <p className="lede">Draw a physics problem. Watch your own sketch move.</p>
          <p className="canvas-note">
            The built in presets work offline with no keys of any kind. Gemini reads a picture when you sketch or
            upload one, and needs a server key before it can answer.
          </p>
        </div>
        <div className="preset-switch" role="group" aria-label="Offline preset">
          {catalogue.map((item) => (
            <button
              type="button"
              key={item.key}
              className="chip"
              aria-pressed={custom === null && item.key === presetKey}
              onClick={() => selectPreset(item.key)}
            >
              <span className="chip-name">{item.name}</span>
              <span className="chip-blurb">{item.blurb}</span>
            </button>
          ))}
        </div>
      </header>

      <main id="simulation" className="workbench">
        <section className="stage" aria-labelledby="stage-heading">
          <h2 className="section-heading" id="stage-heading">
            {model?.title ?? "Board"} on the board
          </h2>

          <div className="toolbar" role="group" aria-label="Playback">
            <button type="button" className="btn btn-primary" onClick={togglePlay} disabled={!scene}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="btn" onClick={reset} disabled={!scene}>
              Reset
            </button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showOverlays}
                onChange={(event) => setShowOverlays(event.target.checked)}
              />
              Force arrows
            </label>
            <p className="status" role="status">
              {status}
            </p>
          </div>

          {notice ? (
            <div className={notice.tone === "error" ? "notice notice-error" : "notice"} role="status">
              <p>{notice.text}</p>
              {notice.tone === "error" ? (
                <div className="notice-actions">
                  <button type="button" className="btn" onClick={() => selectPreset(DEFAULT_KEY)}>
                    Load the incline preset
                  </button>
                  <button type="button" className="btn" onClick={() => setNotice(null)}>
                    Keep the board
                  </button>
                </div>
              ) : (
                <div className="notice-actions">
                  <button type="button" className="btn" onClick={() => setNotice(null)}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {model?.error || !scene ? (
            <div className="notice notice-error" role="status">
              <p>
                <strong>{model?.title ?? "This scene"} could not be prepared.</strong>{" "}
                {model?.error ?? "The scene is not usable."}
              </p>
              <div className="notice-actions">
                <button type="button" className="btn" onClick={reset}>
                  Reset scene
                </button>
                <button type="button" className="btn" onClick={() => selectPreset(DEFAULT_KEY)}>
                  Back to the incline preset
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="board">
                <SimulationCanvas
                  scene={scene}
                  playing={playing}
                  resetKey={resetKey}
                  showOverlays={showOverlays}
                  sprites={source?.sprites}
                  onFrame={handleFrame}
                  onComplete={handleComplete}
                />
              </div>
              <p className="canvas-note">
                The diagram uses metres with the origin at the lower left corner. Body names and force arrows are
                drawn on the board, and the same quantities appear as text below.
              </p>
              {live ? <Readout frame={live} duration={model?.duration ?? 0} problemType={scene.problemType} /> : null}
            </>
          )}

          <div className="input-switch" role="group" aria-label="Board input">
            <button
              type="button"
              className="chip"
              aria-pressed={panel === "sketch"}
              onClick={() => setPanel((value) => (value === "sketch" ? null : "sketch"))}
            >
              <span className="chip-name">Draw a problem</span>
              <span className="chip-blurb">Sketch a board or upload a photo of a problem</span>
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={panel === "experiment"}
              onClick={() => setPanel((value) => (value === "experiment" ? null : "experiment"))}
            >
              <span className="chip-name">Experiment</span>
              <span className="chip-blurb">Change a number, share the board, ask for the reasoning</span>
            </button>
          </div>

          {panel === "sketch" ? (
            <section className="panel" aria-label="Draw a problem">
              <h3>Draw a problem</h3>
              <p className="hint">
                Draw the problem on the pad, or upload a photo of a chalk problem already on a board. Chalk reads the
                objects and the numbers, then cuts a small picture of each object for the board.
              </p>
              <SketchInput onScene={handleSketch} />
            </section>
          ) : null}

          {panel === "experiment" ? (
            <section className="panel" aria-label="Experiment">
              <h3>Experiment</h3>
              <p className="hint">
                Every slider edits the same scene the solver answers, so the board and the answer always agree. The
                crops from your drawing stay on the objects they came from.
              </p>
              <Controls specs={specs} onChange={changeParameter} />
              {controlError ? (
                <p className="hint hint-error" role="status">
                  {controlError}
                </p>
              ) : null}

              <div className="actions">
                <button type="button" className="btn" onClick={shareScene} disabled={!scene}>
                  Share scene
                </button>
                <button type="button" className="btn" onClick={startAnnotation} disabled={!scene || annotating}>
                  {annotating ? "Annotating" : "Annotate the board"}
                </button>
                <button type="button" className="btn" onClick={askExplain} disabled={!scene || explainBusy}>
                  {explainBusy ? "Asking Gemini" : "Explain this board"}
                </button>
              </div>

              {share ? (
                <div className="share">
                  <label htmlFor="share-url">Share link</label>
                  <input
                    id="share-url"
                    className="share-input"
                    type="text"
                    readOnly
                    value={share.url}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <p className="hint">
                    {share.copied
                      ? "The link is on your clipboard."
                      : "Copy the selected link by hand, the clipboard refused."}{" "}
                    A link carries the numbers of the scene only. The picture you drew is not embedded in it, so a
                    board opened from a link shows the chalk shapes.
                  </p>
                </div>
              ) : null}

              {explainError ? (
                <p className="hint hint-error" role="status">
                  {explainError} The local answer below is unaffected and still comes from the solver.
                </p>
              ) : null}

              {explanation ? (
                <div className="explain">
                  <h4>Why the answer is what it is</h4>
                  <p className="explain-body">{explanation}</p>
                  <p className="hint">The local solver steps under the board are computed here, not written by Gemini.</p>
                </div>
              ) : null}

              {annotating && scene ? (
                <div className="annotate">
                  <h4>Annotate the paused board</h4>
                  <p className="hint">
                    The board is still. Draw a force arrow and a label on the snapshot, and Gemini turns them into a
                    force on the scene. Nothing is sent until you press the button in the panel.
                  </p>
                  <AnnotationPanel scene={scene} onScene={applyAnnotated} getSnapshot={getSnapshot} />
                </div>
              ) : null}
            </section>
          ) : null}
        </section>

        <aside className="column" aria-labelledby="answer-heading">
          <section className="panel">
            <h3 id="answer-heading">Question</h3>
            <p className="question">{scene?.question.text ?? source?.blurb ?? ""}</p>
            {model && model.labels.length > 0 ? (
              <ul className="given">
                {model.labels.map((label) => (
                  <li key={`${label.appliesTo}-${label.field}`}>
                    <span className="given-symbol">{label.symbol}</span>
                    <span className="num">{label.display}</span>
                    <span className="sr-only">{GIVEN_COPY[label.field]}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {source?.kind === "custom" && scene ? (
              <div className="confidence">
                <div className="energy-label">
                  <span>Read from the picture</span>
                  <span className="num">{confidence}% confident</span>
                </div>
                <div
                  className="energy-track"
                  role="img"
                  aria-label={`The picture was read with ${confidence} percent confidence`}
                >
                  <div
                    className="energy-fill"
                    style={{ width: `${confidence}%`, background: "var(--color-sand)" }}
                  />
                </div>
              </div>
            ) : null}

            {notes ? (
              <p className="hint">
                <span className="hint-label">{source?.kind === "custom" ? "Reading notes" : "Preset notes"}</span>{" "}
                {notes}
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h3>Closed form answer</h3>
            {model?.error ? (
              <p>No answer is available because this scene could not be prepared.</p>
            ) : answer ? (
              <>
                <p className="answer-title">{answer.title}</p>
                <p className="answer-value num">
                  {number(answer.value)}
                  <span> {answer.unit}</span>
                </p>
                <ol className="steps">
                  {answer.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <ul className="assumptions">
                  {answer.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <ul className="assumptions">
                  <li className="num">Distance {number(answer.distance)} m</li>
                  <li className="num">Speed at the end {number(answer.finalSpeed)} m/s</li>
                  <li className="num">Time in the scene {number(answer.time)} s</li>
                  {springExtra.period !== undefined ? <li className="num">Period {number(springExtra.period)} s</li> : null}
                  {springExtra.amplitude !== undefined ? (
                    <li className="num">Amplitude {number(springExtra.amplitude)} m</li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p>{model?.answerError ?? "This scene does not ask for a quantity the solver can answer."}</p>
            )}
          </section>

          {live && live.assumptions.length > 0 ? (
            <details className="panel">
              <summary>What the diagram assumes</summary>
              <ul className="assumptions">
                {live.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </aside>
      </main>

      <footer className="foot">
        <p>
          Positions on the board come from the closed form solution of the problem, evaluated at the current instant,
          so the picture and the answer share one model whether the scene is a preset or your own drawing. Reading a
          picture, annotating a board and asking Gemini for the reasoning all need a Gemini key on the server, so those
          three controls answer with a readable error until one is set. A shared link carries the numbers of the scene
          and nothing else.
        </p>
      </footer>
    </div>
  );
}
