// Live scene controls.
//
// A slider is not a direct write to a body field. Every control here goes
// through the same labeledValues path the model reader uses, so what the
// diagram shows and what the labelled diagram says can never disagree: the
// label is the source of truth, resolveScene re-derives the geometry from it and
// the result is the same scene the closed form solvers will read.
//
// That is also why setting the ramp angle fixes the ramp height and moves the
// block back onto the new slope. It all happens inside resolveScene, so there
// is no second copy of that rule to keep in step.
import { clamp, toDegrees } from "./geometry";
import { describeSceneError, resolveScene, type LabelField, type Scene } from "./schema";

export type ParameterField = "mass" | "friction" | "speed" | "launchAngleDeg" | "stiffness" | "angleDeg";

export type ParameterUnit = "kg" | "" | "m/s" | "deg" | "N/m";

export interface ParameterSpec {
  field: ParameterField;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: ParameterUnit;
}

// Written onto a scene the caller does not own, so the ranges here are the
// ranges validateScene narrows to anyway. An angle outside these bounds would
// be rejected by the ramp rule, and a mass or stiffness outside them would be
// silently clamped, which would make the slider lie.
const LIMITS: Record<ParameterField, { min: number; max: number; unit: ParameterUnit; symbol: string; label: string }> = {
  mass: { min: 0.01, max: 1000, unit: "kg", symbol: "m", label: "Mass" },
  friction: { min: 0, max: 1, unit: "", symbol: "μ", label: "Friction coefficient" },
  speed: { min: 0, max: 100, unit: "m/s", symbol: "v₀", label: "Launch speed" },
  launchAngleDeg: { min: -360, max: 360, unit: "deg", symbol: "θ", label: "Launch angle" },
  stiffness: { min: 0.001, max: 1000, unit: "N/m", symbol: "k", label: "Spring stiffness" },
  angleDeg: { min: 0.5, max: 84.5, unit: "deg", symbol: "θ", label: "Ramp angle" },
};

const LABEL_FIELD: Record<ParameterField, LabelField> = {
  mass: "mass",
  friction: "friction",
  speed: "speed",
  launchAngleDeg: "launchAngleDeg",
  stiffness: "stiffness",
  angleDeg: "angleDeg",
};

// The labelledValue for a field is created if it is missing and rewritten in
// place if it is already there. Pushing a second label for the same body and
// field would make resolveScene throw, because two labels that disagree about
// one quantity are an error rather than a merge.
function upsertLabel(
  scene: Scene,
  appliesTo: string,
  field: ParameterField,
  value: number,
  symbol: string,
  unit: ParameterUnit,
): void {
  const existing = scene.labeledValues.find((label) => label.appliesTo === appliesTo && label.field === LABEL_FIELD[field]);
  if (existing) {
    existing.value = value;
    return;
  }
  scene.labeledValues.push({ symbol, value, unit, appliesTo, field: LABEL_FIELD[field] });
}

// A slider does not name a body, so each field resolves to the body that owns
// it: the ramp for its slope, the hanging mass for the spring constant, and the
// body the question is about for everything else.
export function parameterBodyId(scene: Scene, field: ParameterField): string | null {
  if (field === "angleDeg") return scene.bodies.find((body) => body.kind === "ramp")?.id ?? null;
  if (field === "stiffness") {
    const spring = scene.constraints.find((constraint) => constraint.kind === "spring");
    if (!spring) return null;
    const attached = spring.bodyB ?? spring.bodyA;
    return scene.bodies.some((body) => body.id === attached) ? attached : null;
  }
  return scene.bodies.some((body) => body.id === scene.question.bodyId) ? scene.question.bodyId : null;
}

export function readParameter(scene: Scene, field: ParameterField): number | null {
  const bodyId = parameterBodyId(scene, field);
  const body = bodyId ? scene.bodies.find((item) => item.id === bodyId) : undefined;
  if (!body) return null;
  if (field === "mass") return body.mass;
  if (field === "friction") return body.friction;
  if (field === "angleDeg") return body.angleDeg;
  if (field === "stiffness") {
    const spring = scene.constraints.find(
      (constraint) => constraint.kind === "spring" && (constraint.bodyA === body.id || constraint.bodyB === body.id),
    );
    return spring?.stiffness ?? null;
  }
  if (field === "speed") return Math.hypot(body.initialVelocity.x, body.initialVelocity.y);
  return toDegrees(Math.atan2(body.initialVelocity.y, body.initialVelocity.x));
}

// Returns a new scene. Nothing in the argument is touched, and the same call
// with the same value always produces the same scene, so a slider that is
// dragged back and forth cannot accumulate edits.
export function updateSceneParameter(input: Scene, field: ParameterField, value: number): Scene {
  if (!Number.isFinite(value)) throw new Error("That control needs a finite number.");
  const bodyId = parameterBodyId(input, field);
  if (!bodyId) {
    throw new Error(`This scene has no body for the ${LIMITS[field].label.toLowerCase()}, so that control cannot be used.`);
  }

  const limits = LIMITS[field];
  const next = clamp(value, limits.min, limits.max);
  const draft = structuredClone(input) as Scene;
  const body = draft.bodies.find((item) => item.id === bodyId);
  if (!body) throw new Error(`This scene has no body called "${bodyId}".`);

  if (field === "speed") {
    // A speed on a body that has never moved leaves the direction open, and
    // resolveScene refuses to guess it. The existing launch direction is kept
    // when the scene already has one, and a plain 45 degree launch is written
    // down otherwise so the control always has a single honest meaning.
    const atRest = Math.hypot(body.initialVelocity.x, body.initialVelocity.y) <= 1e-9;
    const hasAngle = draft.labeledValues.some(
      (label) => label.appliesTo === bodyId && label.field === "launchAngleDeg",
    );
    if (atRest && !hasAngle) {
      upsertLabel(draft, bodyId, "launchAngleDeg", 45, LIMITS.launchAngleDeg.symbol, "deg");
    }
  }

  // The body field is written as well so the draft stays self consistent, but it
  // is the label that survives resolveScene and that the solvers end up reading.
  // The ramp angle is the exception: it is left on the body untouched on purpose.
  // resolveScene finds a body resting on a ramp by comparing the two angles
  // first, so tilting the ramp here would hide the block from that check and the
  // block would be left behind on the old slope. Written as a label only, the
  // tilt, the new height and the block riding up the slope all happen together
  // inside resolveScene.
  if (field === "mass") body.mass = next;
  else if (field === "friction") body.friction = next;
  else if (field === "stiffness") {
    const spring = draft.constraints.find(
      (constraint) => constraint.kind === "spring" && (constraint.bodyA === bodyId || constraint.bodyB === bodyId),
    );
    if (!spring) throw new Error(`"${bodyId}" has no spring constraint, so a stiffness cannot be set on it.`);
    spring.stiffness = next;
  } else if (field === "launchAngleDeg") {
    const current = Math.hypot(body.initialVelocity.x, body.initialVelocity.y);
    // With no speed of its own the direction is still open, so a single metre
    // per second is written down rather than leaving a launch nobody can read.
    const magnitude = current > 1e-9 ? current : 1;
    const radians = next * (Math.PI / 180);
    body.initialVelocity.x = magnitude * Math.cos(radians);
    body.initialVelocity.y = magnitude * Math.sin(radians);
    if (current <= 1e-9) {
      upsertLabel(draft, bodyId, "speed", magnitude, LIMITS.speed.symbol, "m/s");
    }
  }

  upsertLabel(draft, bodyId, field, next, limits.symbol, limits.unit);

  try {
    return resolveScene(draft).scene;
  } catch (error) {
    throw new Error(`That ${limits.label.toLowerCase()} does not describe a scene Chalk can simulate. ${describeSceneError(error)}`);
  }
}

// The controls that make sense for a problem type. Nothing else is offered,
// because a spring constant on a ramp or a launch angle on a freefall would
// only change a number the model ignores.
const BY_PROBLEM: Record<Scene["problemType"], ParameterField[]> = {
  incline: ["mass", "friction", "angleDeg"],
  projectile: ["speed", "launchAngleDeg"],
  freefall: ["mass"],
  spring: ["mass", "stiffness"],
  unknown: [],
};

const SLIDER_RANGE: Record<ParameterField, { min: number; max: number; step: number }> = {
  mass: { min: 0.1, max: 40, step: 0.1 },
  friction: { min: 0, max: 1, step: 0.01 },
  speed: { min: 1, max: 60, step: 0.5 },
  launchAngleDeg: { min: 5, max: 85, step: 1 },
  stiffness: { min: 5, max: 200, step: 1 },
  angleDeg: { min: 5, max: 80, step: 1 },
};

// Pure read. The value handed back is the current effective one, clamped into
// the slider range, so a control never opens on a position its input cannot
// represent.
export function parameterSpecs(scene: Scene): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  for (const field of BY_PROBLEM[scene.problemType] ?? []) {
    const value = readParameter(scene, field);
    if (value === null) continue;
    const limits = LIMITS[field];
    const range = SLIDER_RANGE[field];
    specs.push({
      field,
      label: limits.label,
      min: range.min,
      max: range.max,
      step: range.step,
      value: clamp(value, range.min, range.max),
      unit: limits.unit,
    });
  }
  return specs;
}
