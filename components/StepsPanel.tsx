"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useMemo, useState } from "react";
import type { SceneStep } from "@/lib/schema";
import { equationLatex } from "@/lib/equations";

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
      return katex.renderToString(equationLatex(latex), {
        displayMode: display,
        throwOnError: false,
        errorColor: "#b3261e",
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

function Chevron() {
  return (
    <svg className="nb-step-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function StepsPanel({
  steps,
  time,
  selected,
  onSeek,
  onHighlight,
}: {
  steps: SceneStep[];
  time: number;
  selected: number | null;
  onSeek: (time: number) => void;
  onHighlight: (index: number) => void;
}) {
  const active = activeStepIndex(steps, time);
  const [open, setOpen] = useState<number | null>(active >= 0 ? active : null);

  useEffect(() => {
    if (active >= 0) setOpen(active);
  }, [active]);

  if (steps.length === 0) {
    return <p className="nb-note">This scene has no narrated steps yet. The board, the timeline and the answers still work.</p>;
  }

  return (
    <ol className="nb-steps">
      {steps.map((step, index) => {
        const isActive = index === active;
        const isOpen = open === index;
        const isHighlighted = selected === index;
        return (
          <li
            key={`${step.title}-${step.tStart}`}
            className="nb-step"
            data-active={isActive ? "true" : undefined}
            data-open={isOpen ? "true" : undefined}
          >
            <button
              type="button"
              className="nb-step-head"
              aria-expanded={isOpen}
              aria-current={isActive ? "step" : undefined}
              onClick={() => {
                setOpen(isOpen ? null : index);
                onSeek(clamp(step.tStart, 0, step.tEnd));
              }}
            >
              <span className="nb-step-num" aria-hidden="true">{index + 1}</span>
              <span className="nb-step-title">{step.title}</span>
              <Chevron />
            </button>
            {isOpen ? (
              <div className="nb-step-body">
                <p className="nb-step-narration">{step.narration}</p>
                {step.equations.length > 0 ? (
                  <div className="nb-equations">
                    {step.equations.map((latex, position) => (
                      <button
                        key={`${index}-${position}`}
                        type="button"
                        className="nb-equation"
                        aria-pressed={isHighlighted}
                        title="Highlight this step in the simulation"
                        onClick={() => onHighlight(index)}
                      >
                        <Tex latex={latex} display />
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="nb-highlight"
                  aria-pressed={isHighlighted}
                  onClick={() => onHighlight(index)}
                >
                  {isHighlighted ? "Highlighted in simulation" : "Highlight in simulation"}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
