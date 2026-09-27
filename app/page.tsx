"use client";

import dynamic from "next/dynamic";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InputPanel, { type SolveResult } from "@/components/InputPanel";
import StepsPanel, { activeStepIndex, StepDetail } from "@/components/StepsPanel";
import Timeline from "@/components/Timeline";
import VariableSliders from "@/components/VariableSliders";
import { compileScene } from "@/lib/expressions";
import { presetList, presets, type PresetKey } from "@/lib/presets";
import type { SceneScript, SceneVariable } from "@/lib/schema";
import { validateSceneScript } from "@/lib/validate";

const SceneCanvas = dynamic(() => import("@/components/SceneCanvas"), {
  ssr: false,
  loading: () => <div className="stage stage-loading">Loading the 3D board.</div>,
});

interface Prepared {
  scene: SceneScript;
  compiled: ReturnType<typeof compileScene>;
  warnings: string[];
  error: null;
}

interface Broken {
  scene: null;
  compiled: null;
  warnings: string[];
  error: string;
}

function initialValues(scene: SceneScript): Record<string, number> {
  return Object.fromEntries(scene.variables.map((variable) => [variable.name, variable.value]));
}

function prepare(scene: SceneScript): Prepared | Broken {
  try {
    const result = validateSceneScript(scene);
    return {
      scene: result.scene,
      compiled: compileScene(result.scene),
      warnings: result.warnings,
      error: null,
    };
  } catch (error) {
    return {
      scene: null,
      compiled: null,
      warnings: [],
      error: error instanceof Error ? error.message : "This scene could not be prepared.",
    };
  }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function firstSentence(text: string): string {
  const cut = text.search(/[.!?](\s|$)/);
  return cut >= 0 ? text.slice(0, cut + 1) : text;
}

function cancelSpeech(): void {
  if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
    window.speechSynthesis.cancel();
  }
}

function digits(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

export default function Page() {
  const [presetKey, setPresetKey] = useState<PresetKey>("projectile");
  const [scene, setScene] = useState<SceneScript>(() => presets.projectile);
  const [values, setValues] = useState<Record<string, number>>(() => initialValues(presets.projectile));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(true);
  const [shots, setShots] = useState(true);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);
  const [compareValues, setCompareValues] = useState<Record<string, number>>({});
  const [comparePick, setComparePick] = useState("");
  const [predict, setPredict] = useState(false);
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [solution, setSolution] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");

  const sharedClock = useRef(0);
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get("scene");
    if (!encoded || encoded.length > 30000) return;
    try {
      const decoded = decompressFromEncodedURIComponent(encoded);
      if (!decoded || decoded.length > 100000) throw new Error("Invalid shared scene");
      const shared = validateSceneScript(JSON.parse(decoded)).scene;
      setScene(shared);
      setNotice("Shared scene loaded. Press play to explore it.");
    } catch {
      setNotice("This shared scene could not be loaded. The presets are available.");
    }
  }, []);
  const prepared = useMemo(() => prepare(scene), [scene]);
  const live = prepared.scene;
  const compiled = prepared.compiled;
  const steps = useMemo(() => live?.steps ?? [], [live]);
  const adjustable = useMemo(
    () => (live?.variables ?? []).filter((variable) => variable.adjustable),
    [live],
  );
  const duration = live?.duration ?? 1;

  const answers = useMemo(() => {
    if (!compiled) return [];
    try {
      return compiled.answerValues(values);
    } catch {
      return [];
    }
  }, [compiled, values]);

  const baselineAnswers = useMemo(() => {
    if (!compiled || !baseline) return [];
    try {
      return compiled.answerValues(baseline);
    } catch {
      return [];
    }
  }, [compiled, baseline]);

  const compareAnswers = useMemo(() => {
    if (!compiled || !compare) return [];
    try {
      return compiled.answerValues(compareValues);
    } catch {
      return [];
    }
  }, [compiled, compare, compareValues]);

  const index = useMemo(() => activeStepIndex(steps, time), [steps, time]);
  const step = index >= 0 ? steps[index] : null;
  const narration = step?.narration ?? "";
  const shot = shots && !manual && step?.camera ? step.camera : null;
  const chosen = selected !== null ? steps[selected] : null;
  const focus = chosen ?? step;
  const highlight = focus ? { objects: focus.focus, vectors: focus.showVectors } : null;

  const target = useMemo(() => {
    if (!live) return null;
    for (let position = 0; position < live.answers.length; position += 1) {
      if (Number.isFinite(answers[position])) {
        return { position, question: live.answers[position].question, unit: live.answers[position].unit };
      }
    }
    return null;
  }, [live, answers]);

  const guessNumber = Number.parseFloat(guess);
  const actual = target ? answers[target.position] : Number.NaN;
  const openGuess = predict && Number.isFinite(guessNumber) && Number.isFinite(actual);
  const close = openGuess && Math.abs(guessNumber - actual) <= Math.max(Math.abs(actual) * 0.02, 0.01);
  const finished = time >= duration - 1e-3;
  const canReveal = revealed || finished;
  const answersHidden = predict && !canReveal;
  const guessMissing = predict && !canReveal && !Number.isFinite(guessNumber);

  const narrationReady = useMemo(
    () => typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined",
    [],
  );

  useEffect(() => {
    if (!live) return;
    setValues(initialValues(live));
    setTime(0);
    setPlaying(false);
    setManual(false);
    setSelected(null);
    setCompare(false);
    setBaseline(null);
    setGuess("");
    setRevealed(false);
  }, [live]);

  useEffect(() => {
    setManual(false);
  }, [index]);

  useEffect(() => {
    if (muted || !playing || narration.length === 0) {
      cancelSpeech();
      return;
    }
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.rate = 0.99;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return cancelSpeech;
  }, [muted, playing, narration]);

  const resetPrediction = useCallback(() => {
    setGuess("");
    setRevealed(false);
  }, []);

  const handleTime = useCallback((next: number) => {
    setTime((previous) => (Math.abs(previous - next) < 1e-4 ? previous : next));
  }, []);

  const handleComplete = useCallback(() => setPlaying(false), []);

  const handleLoop = useCallback(() => {
    if (live?.loop) setRevealed(true);
  }, [live]);

  const seek = useCallback((next: number) => {
    setPlaying(false);
    setManual(false);
    setTime(Math.min(Math.max(next, 0), duration));
  }, [duration]);

  const reset = useCallback(() => {
    setPlaying(false);
    setManual(false);
    setTime(0);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((previous) => {
      if (previous) return false;
      if (guessMissing) return false;
      if (time >= duration - 1e-3) setTime(0);
      return true;
    });
  }, [time, duration, guessMissing]);

  const togglePredict = useCallback(() => {
    const next = !predict;
    setPredict(next);
    if (next) {
      setPlaying(false);
      setManual(false);
      setTime(0);
      setGuess("");
      setRevealed(false);
    }
  }, [predict]);

  const changeValue = useCallback(
    (name: string, value: number) => {
      if (compare) {
        setCompareValues((previous) => ({ ...previous, [name]: value }));
      } else {
        setValues((previous) => ({ ...previous, [name]: value }));
      }
      setTime(0);
      setPlaying(false);
      resetPrediction();
    },
    [compare, resetPrediction],
  );

  const applyCompareValue = useCallback(
    (name: string, value: number) => {
      setCompareValues((previous) => ({ ...previous, [name]: value }));
      setTime(0);
      setPlaying(false);
      resetPrediction();
    },
    [resetPrediction],
  );

  const toggleCompare = useCallback(() => {
    if (compare) {
      setCompare(false);
      setBaseline(null);
      return;
    }
    setBaseline(values);
    setCompareValues(values);
    setComparePick(adjustable[0]?.name ?? "");
    setCompare(true);
  }, [compare, values, adjustable]);

  const highlightStep = useCallback(
    (position: number) => {
      setSelected((previous) => (previous === position ? null : position));
      const targetStep = steps[position];
      if (targetStep) seek(targetStep.tStart);
    },
    [steps, seek],
  );

  const selectPreset = useCallback((key: PresetKey) => {
    setPresetKey(key);
    setScene(presets[key]);
    setNotice(null);
    setSolution("");
    setEditError(null);
  }, []);

  const reloadPreset = useCallback(() => {
    setScene(presets[presetKey] ?? presets.projectile);
    setNotice("The preset is back on the board. The numbers, the steps and the answers are unchanged.");
  }, [presetKey]);

  const handleSolved = useCallback((result: SolveResult) => {
    setSolution(result.solutionText);
    if (result.scene) {
      setScene(result.scene);
      setNotice(
        result.warnings.length > 0
          ? `The scene is on the board with a warning: ${result.warnings.join(" ")}`
          : "Your problem is on the board, paused at the start.",
      );
      return;
    }
    setNotice(
      "This answer has no scene Chalk can draw yet, so the board is unchanged. The solution is in the panel on the right and every preset still loads with no key of any kind.",
    );
  }, []);

  const runEdit = useCallback(async () => {
    const instruction = editText.trim();
    if (instruction.length === 0 || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene, instruction }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `The service answered ${response.status}.`;
        throw new Error(message);
      }
      const result = payload as SolveResult;
      if (result.scene) {
        setScene(result.scene);
        setNotice(
          result.warnings.length > 0
            ? `The change is on the board with a warning: ${result.warnings.join(" ")}`
            : "The change is on the board, paused at the start.",
        );
      } else {
        setNotice("That change could not be turned into a scene, so the board is unchanged. The reasoning is in the panel on the right.");
      }
      if (result.solutionText) setSolution(result.solutionText);
      setEditText("");
    } catch (error) {
      setEditError(describe(error, "The change could not be applied."));
    } finally {
      setEditBusy(false);
    }
  }, [editText, editBusy, scene]);

  const blurb =
    firstSentence(live?.problemText?.trim() || "") ||
    presetList.find((item) => item.key === presetKey)?.blurb ||
    "Explore a projectile launched from a cliff.";

  const picked: SceneVariable | null = adjustable.find((item) => item.name === comparePick) ?? adjustable[0] ?? null;

  const share = async () => {
    if (!live || !compiled) return;
    try {
      const sharedValues = compare && baseline ? baseline : values;
      const evaluated = compiled.answerValues(sharedValues);
      const shared = validateSceneScript({ ...live,
        variables: live.variables.map((variable) => ({ ...variable, value: sharedValues[variable.name] ?? variable.value })),
        answers: live.answers.map((answer, index) => ({ ...answer, value: evaluated[index] })),
      }).scene;
      const encoded = compressToEncodedURIComponent(JSON.stringify(shared));
      if (encoded.length > 30000) throw new Error("This scene is too large for a share link.");
      const url = new URL(window.location.href);
      url.hash = `scene=${encoded}`;
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("Link copied");
    } catch {
      setShareStatus("Could not copy the link");
    }
  };

  const answerRows = (rows: number[]) =>
    (live?.answers ?? []).map((answer, position) => (
      <div key={answer.question}>
        <dt>{answer.question}</dt>
        <dd className="num">
          {Number.isFinite(rows[position]) ? rows[position].toFixed(3) : "not available"}
          {answer.unit ? ` ${answer.unit}` : ""}
        </dd>
      </div>
    ));

  const answerList = (rows: number[] | null, heading: string) => (
    <div className="answer-column">
      <p className="compare-head">{heading}</p>
      {rows === null ? (
        <p className="muted">Hidden until you reveal the answer.</p>
      ) : (
        <dl className="hud-list">{answerRows(rows)}</dl>
      )}
    </div>
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <p className="wordmark">Chalk</p>
          <p className="tagline">Sketch a physics problem. Watch it move.</p>
        </div>
        <div className="masthead-right">
          <a className="btn btn-quiet" href="#explanation">Explain</a>
          <button className="btn btn-quiet" type="button" onClick={share}>Share</button>
          <span className="share-status" role="status">{shareStatus}</span>
        </div>
      </header>

      <div className="modebar">
        <span className="mode-label">Simulate in 3D</span>
        <button className="btn btn-primary" type="button" onClick={() => document.getElementById("chalk-problem")?.focus()}>Give a problem</button>
          <label className="field scene-picker">
            <span>Scene</span>
            <select value={presetKey} onChange={(event) => selectPreset(event.target.value as PresetKey)}>
              {presetList.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        <button type="button" className="btn btn-quiet" aria-pressed={compare} onClick={toggleCompare}>
          {compare ? "Close the comparison" : "Compare a change"}
        </button>
        <button type="button" className="btn btn-quiet" aria-pressed={predict} onClick={togglePredict}>
          {predict ? "Hide the prediction" : "Predict before you play"}
        </button>
        {selected !== null ? (
          <button type="button" className="btn btn-quiet" onClick={() => setSelected(null)}>
            Clear the highlight
          </button>
        ) : null}
      </div>

      <main className="workspace">
        <div className="primary">
          {prepared.error || !live || !compiled ? (
            <div className="stage">
              <div className="board-fallback" role="alert">
                <h2>This scene could not be prepared</h2>
                <p>{prepared.error ?? "The scene script is not usable."}</p>
                <p>
                  A scene is only shown after every expression parses and every sampled value is finite, so nothing
                  broken is ever drawn.
                </p>
                <button type="button" className="btn btn-primary" onClick={reloadPreset}>
                  Reload the preset
                </button>
              </div>
            </div>
          ) : (
            <>
              {compare ? (
                <div className="stages">
                  <figure className="stage-figure">
                    <div className="stage" id="simulation">
                      <SceneCanvas
                        scene={live}
                        values={baseline ?? values}
                        playing={playing}
                        time={time}
                        speed={speed}
                        onTime={handleTime}
                        onComplete={handleComplete}
                        onLoop={handleLoop}
                        shot={shot}
                        onManualOrbit={() => setManual(true)}
                        sharedClock={sharedClock}
                        highlight={highlight}
                      />
                    </div>
                    <figcaption className="stage-caption">Original, the values as they were</figcaption>
                  </figure>
                  <figure className="stage-figure">
                    <div className="stage">
                      <SceneCanvas
                        scene={live}
                        values={compareValues}
                        playing={playing}
                        time={time}
                        speed={speed}
                        onTime={() => undefined}
                        onComplete={() => undefined}
                        onLoop={() => undefined}
                        shot={shot}
                        onManualOrbit={() => setManual(true)}
                        sharedClock={sharedClock}
                        follower
                        highlight={highlight}
                      />
                    </div>
                    <figcaption className="stage-caption">Changed, the same scene and the same clock</figcaption>
                  </figure>
                </div>
              ) : (
                <div className="stage" id="simulation">
                  <SceneCanvas
                    scene={live}
                    values={values}
                    playing={playing}
                    time={time}
                    speed={speed}
                    onTime={handleTime}
                    onComplete={handleComplete}
                    onLoop={handleLoop}
                    shot={shot}
                    onManualOrbit={() => setManual(true)}
                    sharedClock={sharedClock}
                    highlight={highlight}
                  />
                  <div className="board-hint">Drag to orbit · Scroll to zoom</div>
                </div>
              )}

              <Timeline
                duration={duration}
                time={time}
                playing={playing}
                speed={speed}
                muted={muted}
                narrationReady={narrationReady}
                shots={shots}
                playBlocked={guessMissing}
                onPlay={togglePlay}
                onPause={() => setPlaying(false)}
                onSeek={seek}
                onSpeed={setSpeed}
                onReset={reset}
                onMute={setMuted}
                onShots={setShots}
              />

              {compare ? (
                <section className="compare-strip">
                  {answerList(answersHidden ? null : baselineAnswers, "Original")}
                  {answerList(answersHidden ? null : compareAnswers, "Changed")}
                </section>
              ) : null}

              <StepDetail
                step={step}
                index={index}
                highlighted={selected === index}
                onHighlight={highlightStep}
              />
            </>
          )}

          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {prepared.warnings.length > 0 ? (
            <p className="notice notice-warn" role="status">
              Scene warnings: {prepared.warnings.join(" ")}
            </p>
          ) : null}
          {editError ? (
            <p className="notice notice-warn" role="alert">
              {editError}
            </p>
          ) : null}
        </div>

        <aside className="inspector">
          <section className="answer-paper" aria-label="Calculated answers">
            <div className="answer-eyebrow"><span>Answer</span><span>{solution ? "Your problem" : "Preset"}</span></div>
            <p className="answer-question">{target?.question ?? live?.title ?? "Physics problem"}</p>
            <p className="answer-big num">{answersHidden ? "?" : Number.isFinite(actual) ? actual.toFixed(3) : "…"}<span>{target?.unit ?? ""}</span></p>
            <p className="answer-model">{answersHidden ? "Make your prediction, then watch the scene unfold." : blurb}</p>
            {!answersHidden ? <dl className="hud-list paper-results">{answerRows(answers)}</dl> : null}
          </section>
          <section className="panel">
            <h2 className="panel-title">Ask for a problem</h2>
            <InputPanel onSolved={handleSolved} />
          </section>

          <section className="panel">
            <h2 className="panel-title">Change this scene</h2>
            <label className="field field-stacked" htmlFor="edit-instruction">
              <span>Instruction</span>
              <textarea
                id="edit-instruction"
                rows={2}
                maxLength={1000}
                placeholder="make the ramp steeper"
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-wide"
              disabled={editBusy || editText.trim().length === 0}
              onClick={runEdit}
            >
              {editBusy ? "Applying the change" : "Apply the change"}
            </button>
          </section>

          {predict ? (
            <section className="panel">
              <h2 className="panel-title">Predict before you play</h2>
              {target ? (
                <>
                  <p className="question">{target.question}</p>
                  <p className="muted">
                    Give a number in {target.unit || "the unit of the question"}. Your number stays yours until you
                    reveal the answer or the run finishes.
                  </p>
                  <label className="field field-stacked" htmlFor="prediction">
                    <span>Your answer</span>
                    <input
                      id="prediction"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="number-input"
                      value={guess}
                      onChange={(event) => setGuess(event.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!Number.isFinite(guessNumber) || canReveal}
                      onClick={() => setRevealed(true)}
                    >
                      Reveal the answer
                    </button>
                    <button type="button" className="btn" onClick={resetPrediction}>
                      Clear
                    </button>
                  </div>
                  {!canReveal ? (
                    <p className="muted">
                      {finished
                        ? "The run is over, so the answer can be revealed."
                        : "The answer stays hidden until you reveal it or the run reaches the end."}
                    </p>
                  ) : null}
                  {guessMissing ? (
                    <p className="notice notice-warn" role="status">
                      Enter a prediction before you press play, or reveal the answer first.
                    </p>
                  ) : null}
                  {canReveal ? (
                    <p className="verdict">
                      The board gives{" "}
                      <b className="num">
                        {Number.isFinite(actual) ? actual.toFixed(3) : "not available"} {target.unit}
                      </b>
                      .
                      {!openGuess ? (
                        " Enter a number above to compare it with the board."
                      ) : close ? (
                        <>
                          {" "}
                          Your {guessNumber} is inside 2 percent of it. Well judged.
                        </>
                      ) : (
                        <>
                          {" "}
                          Yours was {guessNumber}, which is {Math.abs(guessNumber - actual).toFixed(3)} away. Play it
                          again and watch which part of the motion decides it.
                        </>
                      )}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted">This scene has no finite answer to predict.</p>
              )}
            </section>
          ) : null}

          {compare ? (
            <section className="panel">
              <h2 className="panel-title">Compare a change</h2>
              {adjustable.length > 1 ? (
                <label className="field field-stacked" htmlFor="compare-pick">
                  <span>Quantity to change</span>
                  <select
                    id="compare-pick"
                    value={picked?.name ?? ""}
                    onChange={(event) => setComparePick(event.target.value)}
                  >
                    {adjustable.map((variable) => (
                      <option key={variable.name} value={variable.name}>
                        {variable.label || variable.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {picked ? (
                <div className="control">
                  <label htmlFor="compare-value">
                    <span>{picked.label || picked.name}</span>
                    <span className="num">
                      {(compareValues[picked.name] ?? picked.value).toFixed(digits(picked.step))}
                      {picked.unit ? ` ${picked.unit}` : ""}
                    </span>
                  </label>
                  <input
                    id="compare-value"
                    type="range"
                    min={picked.min}
                    max={picked.max}
                    step={picked.step}
                    value={compareValues[picked.name] ?? picked.value}
                    onChange={(event) => applyCompareValue(picked.name, Number(event.target.value))}
                  />
                  <p className="muted">
                    Original {(baseline?.[picked.name] ?? picked.value).toFixed(digits(picked.step))}
                    {picked.unit ? ` ${picked.unit}` : ""}. Both boards run on the same clock and the same scene.
                  </p>
                </div>
              ) : (
                <p className="muted">This scene fixes every quantity, so there is nothing to compare.</p>
              )}
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-title">{compare ? "Changed variables" : "Variables"}</h2>
            <VariableSliders
              variables={live?.variables ?? []}
              values={compare ? compareValues : values}
              onChange={changeValue}
            />
            <p className="muted">
              Moving a slider re-evaluates the closed form answer with no call to any service.
              {compare ? " It moves the changed board, and the original keeps the values it was given." : ""}
            </p>
          </section>

          <section className="panel" id="explanation">
            <h2 className="panel-title">Derivation</h2>
            <p className="muted">Choose a step to jump the board to the moment it explains.</p>
            <StepsPanel steps={steps} time={time} onSeek={seek} />
          </section>

          <details className="panel">
            <summary>Model and assumptions</summary>
            {live?.problemText ? <p className="solution">{live.problemText}</p> : null}
            {solution ? <p className="solution">{solution}</p> : null}
            <p className="muted">
              These boards use closed form ideal models chosen for the situation, and they are not a fluid or turbulence
              simulation. A scene that passes every check is not a promise that its model fits the real world.
            </p>
          </details>
        </aside>
      </main>
    </div>
  );
}
