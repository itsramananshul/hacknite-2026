"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import type { SceneStep } from "@/lib/schema";

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export function activeStepIndex(steps: SceneStep[], time: number): number {
  if (steps.length === 0) return -1;
  const found = steps.findIndex((step) => time >= step.tStart && time < step.tEnd);
  if (found >= 0) return found;
  const last = steps.length - 1;
  return time >= steps[last].tStart ? last : 0;
}

function Tex({ latex, display }: { latex: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        errorColor: "#e8b49c",
        strict: "ignore",
        trust: false,
      });
    } catch {
      return null;
    }
  }, [latex, display]);

  if (html === null) {
    return <code className="tex-plain">{latex}</code>;
  }
  return <span className={display ? "tex tex-display" : "tex"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function StepDetail({
  step,
  index,
  highlighted,
  onHighlight,
}: {
  step: SceneStep | null;
  index: number;
  highlighted: boolean;
  onHighlight: (index: number) => void;
}) {
  if (!step) {
    return (
      <section className="step-detail" aria-live="polite">
        <p className="muted">This scene has no narrated steps yet. The board, the timeline and the answers still work.</p>
      </section>
    );
  }
  return (
    <section className="step-detail" aria-live="polite">
      <p className="step-count">Step {index + 1}</p>
      <h2 className="step-title">{step.title}</h2>
      <p className="step-narration">{step.narration}</p>
      {step.equations.length > 0 ? (
        <div className="equations">
          {step.equations.map((latex, position) => (
            <button
              key={`${index}-${position}`}
              type="button"
              className="equation"
              aria-pressed={highlighted}
              title="Highlight this step"
              onClick={() => onHighlight(index)}
            >
              <Tex latex={latex} display />
            </button>
          ))}
        </div>
      ) : null}
      <div className="step-actions">
        <button
          type="button"
          className="btn btn-quiet"
          aria-pressed={highlighted}
          onClick={() => onHighlight(index)}
        >
          {highlighted ? "Step highlighted" : "Highlight this step"}
        </button>
        <p className="muted">
          Choosing an equation or this button lights the objects and the arrows the scene author listed for this step.
          Nothing here is guessed from the equation itself.
        </p>
      </div>
    </section>
  );
}

export default function StepsPanel({
  steps,
  time,
  onSeek,
}: {
  steps: SceneStep[];
  time: number;
  onSeek: (time: number) => void;
}) {
  const active = activeStepIndex(steps, time);
  if (steps.length === 0) {
    return <p className="muted">This scene has no steps to show.</p>;
  }
  return (
    <ol className="steps-list">
      {steps.map((step, index) => {
        const isActive = index === active;
        return (
          <li key={`${step.title}-${step.tStart}`}>
            <button
              type="button"
              className="step-button"
              aria-current={isActive ? "step" : undefined}
              onClick={() => onSeek(clamp(step.tStart, 0, step.tEnd))}
            >
              <span className="step-span">
                {step.tStart.toFixed(1)} s to {step.tEnd.toFixed(1)} s
              </span>
              <span className="step-name">{step.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
