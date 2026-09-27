"use client";

import type { SceneVariable } from "@/lib/schema";

function digits(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

export default function VariableSliders({
  variables,
  values,
  onChange,
}: {
  variables: SceneVariable[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  const adjustable = variables.filter((variable) => variable.adjustable);
  if (adjustable.length === 0) {
    return <p className="muted">This scene fixes every quantity, so there is nothing to sweep.</p>;
  }
  return (
    <div className="sliders">
      {adjustable.map((variable) => {
        const id = `variable-${variable.name}`;
        const current = values[variable.name] ?? variable.value;
        const places = digits(variable.step);
        return (
          <div className="control" key={variable.name}>
            <label htmlFor={id}>
              <span>{variable.label || variable.name}</span>
              <span className="num">
                {current.toFixed(places)}
                {variable.unit ? ` ${variable.unit}` : ""}
              </span>
            </label>
            <input
              id={id}
              type="range"
              min={variable.min}
              max={variable.max}
              step={variable.step}
              value={current}
              onChange={(event) => onChange(variable.name, Number(event.target.value))}
            />
          </div>
        );
      })}
    </div>
  );
}
