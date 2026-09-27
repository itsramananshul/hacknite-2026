import { resolveScene, type Scene, type SceneBody } from "./schema";
import {
  findGround,
  findRamp,
  flightAcceleration,
  flightPeakHeight,
  flightSetup,
  flightStateAt,
  heightReference,
  inclineSetup,
  inclineStateAt,
  springSetup,
  type FlightSetup,
  type InclineSetup,
  type SpringSetup,
} from "./geometry";

// Deterministic closed form answers. These are the official answers in the UI;
// every number comes from the shared helpers in lib/geometry, which is also what
// lib/engine.ts samples, so an answer and the matching frame can never disagree.

export interface SolverResult {
  value: number;
  unit: string;
  title: string;
  distance: number;
  finalSpeed: number;
  time: number;
  maxHeight?: number;
  acceleration?: number;
  period?: number;
  amplitude?: number;
  steps: string[];
  assumptions: string[];
}

const fixed = (value: number): string => value.toFixed(3);
const round = (value: number, digits = 6): number => Number(value.toFixed(digits));

export function questionBody(scene: Scene): SceneBody {
  const body = scene.bodies.find((item) => item.id === scene.question.bodyId);
  if (!body) throw new Error("The question must refer to a body in the scene.");
  if (body.isStatic) throw new Error("The question must refer to a moving body.");
  return body;
}

// One moving body is the whole analytical model, so a scene with more than one
// has no single answer to give.
function singleBody(scene: Scene): SceneBody {
  const moving = scene.bodies.filter((item) => !item.isStatic);
  if (moving.length > 1) {
    throw new Error(
      `The analytical core solves one moving body, but this scene has ${moving.length}: ${moving.map((item) => item.id).join(", ")}.`,
    );
  }
  return questionBody(scene);
}

function noConstraints(scene: Scene, what: string): void {
  if (scene.constraints.length === 0) return;
  throw new Error(`A ${what} answer cannot use constraints, but this scene has ${scene.constraints.length}.`);
}

export function solveIncline(input: Scene): SolverResult {
  const { scene } = resolveScene(input);
  const body = singleBody(scene);
  const ramp = findRamp(scene);
  if (!ramp) throw new Error("Incline problems need a ramp body in the scene.");
  if (body.restitution > 0) throw new Error("A bouncing block on a ramp is not supported yet.");
  noConstraints(scene, "ramp");
  const setup: InclineSetup = inclineSetup(scene, body, ramp);
  const { params } = setup;
  const window = scene.question.timeWindow;
  const stuck = setup.stopTime === 0 && setup.acceleration <= 0;

  // The physical run ends at the foot of the ramp, so the answer can never be
  // longer than the ramp itself.
  const span = Math.min(window, setup.stopTime, setup.endTime);
  const end = inclineStateAt(params, span);
  const distance = stuck ? 0 : Math.max(0, setup.startAlong - end.along);
  const finalSpeed = stuck ? 0 : end.speed;
  // What the same window would have produced on an endless ramp, quoted only to
  // explain the limit when the ramp runs out first.
  const endlessSpan = Math.min(window, setup.stopTime);
  const endlessDistance = stuck
    ? 0
    : Math.max(0, params.startSpeed * endlessSpan + 0.5 * setup.acceleration * endlessSpan * endlessSpan);
  const rampEndsFirst = setup.endTime < window;
  const target = scene.question.target;
  if (!["distance", "finalSpeed", "time"].includes(target)) {
    throw new Error(`The incline solver answers distance, final speed or stopping time, not "${target}".`);
  }
  if (target === "time" && setup.stopTime === Infinity) {
    throw new Error("Nothing on this slope slows the box down, so there is no stopping time to report.");
  }
  const value = target === "finalSpeed" ? finalSpeed : target === "time" ? (stuck ? 0 : setup.stopTime) : distance;
  const unit = target === "finalSpeed" ? "m/s" : target === "time" ? "s" : "m";
  const title =
    target === "finalSpeed"
      ? "Speed at the end of the run"
      : target === "time"
        ? "Time to come to rest"
        : "Distance slid along the ramp";

  const assumptions = [
    `One friction field, so the static and the kinetic coefficient are both mu = ${fixed(body.friction)}: the box holds still when g·sinθ is at or below mu·g·cosθ.`,
    `The normal force is N = m·g·cosθ − F·n̂, and friction is mu·N, so a = g·sinθ + F_along/m − mu·N/m.`,
    `Friction removes mu·N per metre slid, so the energy balance is ½mv² + m·g·h + mu·N·s = m·g·h₀.`,
    `Heights are measured from the foot of the ramp, which is the zero of the gravitational potential.`,
  ];
  if (stuck) {
    assumptions.push(`The box never starts moving, so it stays ${fixed(setup.startHeight)} m above the foot of the ramp for the whole window.`);
  } else if (rampEndsFirst) {
    assumptions.push(
      `The box reaches the foot of the ramp after ${fixed(setup.endTime)} s, so the run stops there with ${fixed(distance)} m of ramp travelled. The requested ${fixed(window)} s window would need ${fixed(endlessDistance)} m of an endless ramp, which this scene does not have, and the animation stops with the box on the ramp rather than sliding off the end.`,
    );
  } else if (setup.stopTime < window) {
    assumptions.push(`The box slows to a stop after ${fixed(setup.stopTime)} s and holds there, ${fixed(setup.startAlong - distance)} m above the foot of the ramp.`);
  } else {
    assumptions.push(
      `The window ends after ${fixed(window)} s while the box is still speeding up, and the ${fixed(setup.startAlong)} m of ramp below it is more than the ${fixed(distance)} m it needs.`,
    );
  }

  return {
    value: round(value),
    unit,
    title,
    distance: round(distance),
    finalSpeed: round(finalSpeed),
    time: round(span),
    acceleration: round(setup.acceleration),
    steps: [
      stuck
        ? `g·sinθ = ${fixed(params.gravity * Math.sin(params.theta))} m/s² is below mu·g·cosθ = ${fixed(body.friction * params.gravity * Math.cos(params.theta))} m/s², so the box never starts sliding.`
        : `a = g(sinθ − mu cosθ) = ${fixed(setup.acceleration)} m/s²`,
      `s = v₀t + ½at² = ${fixed(distance)} m after ${fixed(span)} s`,
      `v = ${fixed(finalSpeed)} m/s at the end of the run`,
    ],
    assumptions,
  };
}

export function solveProjectile(input: Scene): SolverResult {
  const { scene } = resolveScene(input);
  const body = singleBody(scene);
  if (!findGround(scene)) {
    throw new Error("Projectile problems need a ground body in the scene to measure the height against.");
  }
  if (body.restitution > 0) throw new Error("A bouncing projectile is not supported yet.");
  noConstraints(scene, "projectile");
  const setup: FlightSetup = flightSetup(scene, body);
  const { params, landingTime } = setup;
  const state = flightStateAt(params, landingTime);
  const range = Math.abs(state.x);
  const maxHeight = flightPeakHeight(params);
  const finalSpeed = Math.hypot(state.vx, state.vy);
  const target = scene.question.target;
  if (!["range", "time", "maxHeight", "finalSpeed"].includes(target)) {
    throw new Error(`The projectile solver answers range, time of flight, maximum height or impact speed, not "${target}".`);
  }
  return {
    value: round(target === "time" ? landingTime : target === "maxHeight" ? maxHeight : target === "finalSpeed" ? finalSpeed : range),
    unit: target === "time" ? "s" : target === "finalSpeed" ? "m/s" : "m",
    title:
      target === "time"
        ? "Time of flight"
        : target === "maxHeight"
          ? "Highest point above the ground"
          : target === "finalSpeed"
            ? "Speed at touchdown"
            : "Horizontal range",
    distance: round(range),
    finalSpeed: round(finalSpeed),
    time: round(landingTime),
    maxHeight: round(maxHeight),
    acceleration: round(-flightAcceleration(params).y),
    steps: [
      `Launch height above the ground: ${fixed(setup.startHeight)} m`,
      `y₀ + vᵧt + ½aᵧt² = 0 gives the first non negative root t = ${fixed(landingTime)} s`,
      `x = vₓt + ½aₓt² gives a horizontal range of ${fixed(range)} m`,
      `The peak is ${fixed(maxHeight)} m above the ground, reached after ${fixed(setup.peakTime)} s`,
    ],
    assumptions: [
      "No air resistance, constant gravity and a flat ground, so both axes integrate independently.",
      "The launch height is measured from the bottom of the body to the top of the ground, and the ground is a flat reference plane.",
      setup.groundSpan
        ? `The body lands at x = ${fixed(body.x + range)} m, which is inside the ground spanning ${fixed(setup.groundSpan.left)} m to ${fixed(setup.groundSpan.right)} m.`
        : "The scene has no ground body, so y = 0 is used as the reference plane.",
      "The engine stops at the first touchdown, so the measured range is compared against this value.",
    ],
  };
}

export function solveSpring(input: Scene): SolverResult {
  const { scene } = resolveScene(input);
  const body = singleBody(scene);
  if (body.restitution > 0) throw new Error("A bouncing mass is not supported yet.");
  const spring = scene.constraints.find((item) => item.kind === "spring");
  if (!spring) throw new Error("A spring problem needs a spring constraint in the scene.");
  if (scene.constraints.length > 1) {
    throw new Error(`A spring answer supports one spring, but this scene has ${scene.constraints.length} constraints.`);
  }
  const setup: SpringSetup = springSetup(scene, body, spring);
  const { params, model } = setup;
  const reference = heightReference(scene);
  const target = scene.question.target;
  if (!["period", "maxHeight", "distance", "time", "finalSpeed"].includes(target)) {
    throw new Error(`The spring solver answers period, amplitude, height, time or speed, not "${target}".`);
  }
  if (target === "time" && model.period <= 0) {
    throw new Error("This spring has no oscillation, so there is no period to report.");
  }
  const equilibriumHeight = model.equilibriumY - setup.support - reference.y;
  const topHeight = model.equilibriumY + model.amplitude - setup.support - reference.y;
  const bottomHeight = model.equilibriumY - model.amplitude - setup.support - reference.y;
  const value =
    target === "period"
      ? model.period
      : target === "distance"
        ? model.amplitude * 2
        : target === "time"
          ? model.period
          : target === "finalSpeed"
            ? model.amplitude * model.omega
            : topHeight;
  const unit = target === "finalSpeed" ? "m/s" : target === "period" || target === "time" ? "s" : "m";
  const title =
    target === "period" || target === "time"
      ? "Oscillation period"
      : target === "maxHeight"
        ? "Highest point of the swing"
        : target === "distance"
          ? "Travel between the two ends of the swing"
          : "Fastest speed, at the equilibrium point";
  return {
    value: round(value),
    unit,
    title,
    distance: round(model.amplitude * 2),
    finalSpeed: round(model.amplitude * model.omega),
    time: round(model.period),
    maxHeight: round(topHeight),
    acceleration: round(-model.omega * model.omega * model.amplitude),
    period: round(model.period),
    amplitude: round(model.amplitude),
    steps: [
      `Period = 2π√(m/k) = 2π√(${fixed(params.mass)}/${fixed(params.stiffness)}) = ${fixed(model.period)} s`,
      `restLength L₀ = ${fixed(params.restLength)} m, equilibrium length L₀ + (m·g − F_y)/k = ${fixed(model.equilibriumLength)} m`,
      `Static sag m·g/k = ${fixed(model.sag)} m, so the mass hangs ${fixed(equilibriumHeight)} m above the reference plane`,
      `Amplitude = √((L₀_initial − L_eq)² + (v₀/ω)²) = ${fixed(model.amplitude)} m, so the swing runs from ${fixed(bottomHeight)} m to ${fixed(topHeight)} m`,
    ],
    assumptions: [
      `k = ${fixed(params.stiffness)} N/m is a physical Hooke stiffness, so the period 2π√(m/k) = ${fixed(model.period)} s does not depend on gravity.`,
      `restLength is the unstretched length, while the equilibrium length is ${fixed(model.equilibriumLength)} m, which is the rest length plus the static sag.`,
      "The oscillation is undamped, so the amplitude is constant and the total energy stays the same over every period.",
      "Only vertical motion along the spring is modelled: no horizontal start, no sideways force and no second body.",
    ],
  };
}

export function solveScene(input: Scene): SolverResult | null {
  const { scene } = resolveScene(input);
  if (scene.question.target === "none") return null;
  if (scene.problemType === "incline") return solveIncline(scene);
  if (scene.problemType === "projectile" || scene.problemType === "freefall") return solveProjectile(scene);
  if (scene.problemType === "spring") return solveSpring(scene);
  return null;
}
