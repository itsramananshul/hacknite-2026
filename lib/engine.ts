// Closed form analytical engine. There is no stepper and no physics library in
// this file: every position, velocity, force and energy is a direct function of
// the elapsed time, so a frame can be sampled in any order and always gives the
// same answer.
//
// Public contract for the UI:
//   getDuration(input)        : how long the scene runs, in seconds
//   sampleScene(input, t)     : the whole scene at t, as one frame
//   solveScene(input)         : the official closed form answer, re-exported
//   createAnalyticalModel(...) : optional, so a renderer can build the model once
//                                and sample it every frame without revalidating
import { resolveScene, type Scene, type SceneBody, type SceneConstraint } from "./schema";
import {
  bodySupport,
  findRamp,
  flightPeakHeight,
  flightStateAt,
  flightSetup,
  heightReference,
  inclineSetup,
  inclineNormalForce,
  inclineStateAt,
  movingBodies,
  rampSurfaceOffset,
  rampSurfacePoint,
  springSetup,
  springStateAt,
  springTopTime,
  totalAppliedForce,
  type FlightSetup,
  type InclineSetup,
  type SpringSetup,
  type Vec2,
} from "./geometry";
import { solveScene, type SolverResult } from "./solvers";

export { solveScene };
export type { SolverResult };

export type ForceKind = "gravity" | "normal" | "friction" | "spring" | "applied";

export interface AnalyticalBody {
  id: string;
  x: number;
  y: number;
  angleDeg: number;
}

// A force on the body, in newtons. x and y are the world vector components and
// magnitude is their length, so an arrow can be drawn from the pair directly.
export interface AnalyticalForce {
  bodyId: string;
  kind: ForceKind;
  x: number;
  y: number;
  magnitude: number;
}

export interface AnalyticalEnergy {
  kinetic: number;
  potential: number;
  dissipated: number;
}

export interface AnalyticalMetrics {
  distance: number;
  finalSpeed: number;
  time: number;
  maxHeight: number;
  range: number;
  period: number | null;
}

export interface AnalyticalFrame {
  scene: Scene;
  time: number;
  duration: number;
  finished: boolean;
  bodies: AnalyticalBody[];
  forces: AnalyticalForce[];
  energy: AnalyticalEnergy;
  metrics: AnalyticalMetrics;
  assumptions: string[];
}

export interface AnalyticalModel {
  scene: Scene;
  duration: number;
  assumptions: string[];
  period: number | null;
  sample(elapsedSeconds: number): AnalyticalFrame;
}

const fixed = (value: number): string => value.toFixed(3);

function force(bodyId: string, kind: ForceKind, x: number, y: number): AnalyticalForce {
  return { bodyId, kind, x, y, magnitude: Math.hypot(x, y) };
}

function appliedForceEntry(bodyId: string, applied: Vec2): AnalyticalForce[] {
  return Math.hypot(applied.x, applied.y) > 0 ? [force(bodyId, "applied", applied.x, applied.y)] : [];
}

interface Context {
  scene: Scene;
  body: SceneBody;
  gravity: number;
  applied: Vec2;
  support: number;
  referenceY: number;
  startX: number;
  startY: number;
}

// Every entry point goes through here, so a scene is validated, resolved and
// checked against the one moving body the analytical core supports exactly once
// per model.
function prepare(input: Scene): Context {
  const scene = resolveScene(input).scene;
  if (scene.problemType === "unknown") {
    throw new Error("The scene problem type is \"unknown\", so there is nothing to simulate.");
  }
  const moving = movingBodies(scene);
  if (moving.length === 0) throw new Error("The scene has no moving body, so there is nothing to simulate.");
  if (moving.length > 1) {
    throw new Error(
      `The analytical core simulates one moving body, but this scene has ${moving.length}: ${moving.map((item) => item.id).join(", ")}.`,
    );
  }
  const body = moving[0];
  if (body.id !== scene.question.bodyId) {
    throw new Error(`The moving body "${body.id}" has to be the body the question asks about, which is "${scene.question.bodyId}".`);
  }
  if (body.restitution > 0) throw new Error("A bouncing body is not supported, so the restitution has to be 0.");
  for (const entry of scene.appliedForces ?? []) {
    if (entry.bodyId !== body.id) {
      throw new Error(`The applied force on "${entry.bodyId}" cannot be simulated, because "${body.id}" is the only moving body.`);
    }
  }
  if (scene.problemType === "spring") {
    springConstraint(scene, body);
  } else if (scene.constraints.length > 0) {
    throw new Error(
      `A ${scene.problemType} scene cannot use ${scene.constraints.length} constraints, because only the spring model has one.`,
    );
  }
  const support = bodySupport(body);
  return {
    scene,
    body,
    gravity: scene.world.gravity,
    applied: totalAppliedForce(scene, body.id),
    support,
    referenceY: heightReference(scene).y,
    startX: body.x,
    startY: body.y,
  };
}

function springConstraint(scene: Scene, body: SceneBody): SceneConstraint {
  const springs = scene.constraints.filter((item) => item.kind === "spring");
  if (springs.length !== 1) {
    const kinds = scene.constraints.map((item) => item.kind).join(", ");
    throw new Error(
      springs.length
        ? `A spring problem supports one spring, but this scene has ${springs.length}.`
        : `A spring problem needs one spring constraint, but this scene only has ${kinds || "none"}.`,
    );
  }
  const spring = springs[0];
  if (spring.bodyA !== body.id) {
    throw new Error(`The spring has to be attached to the moving body "${body.id}", but it is attached to "${spring.bodyA}".`);
  }
  if (spring.bodyB !== null) {
    throw new Error("A spring between two bodies is not supported, so a spring needs one body and a fixed anchor.");
  }
  return spring;
}

// A body only slides when it actually sits on the slope, flat and one support
// distance off the surface, otherwise the contact model would be fiction.
function checkRampContact(context: Context, setup: InclineSetup, ramp: SceneBody): void {
  const aligned = Math.abs(((context.body.angleDeg - setup.frame.angleDeg + 540) % 360) - 180) < 0.5;
  if (!aligned) {
    throw new Error(`The body has to sit flat on the slope, so its angle should be ${fixed(setup.frame.angleDeg)} degrees.`);
  }
  const offset = rampSurfaceOffset(ramp, context.body);
  if (Math.abs(offset - context.support) > Math.max(0.02, context.support * 0.05)) {
    throw new Error(
      `The body is ${fixed(offset)} m off the slope surface, but a body of this size rests ${fixed(context.support)} m off it.`,
    );
  }
}

function staticBodies(context: Context): AnalyticalBody[] {
  return context.scene.bodies
    .filter((item) => item.isStatic)
    .map((item) => ({ id: item.id, x: item.x, y: item.y, angleDeg: item.angleDeg }));
}

function buildIncline(context: Context, ramp: SceneBody): AnalyticalModel {
  const setup = inclineSetup(context.scene, context.body, ramp);
  checkRampContact(context, setup, ramp);
  const { frame, params } = setup;
  const window = context.scene.question.timeWindow;
  const duration = Math.min(window, setup.endTime);
  const stuck = setup.params.startSpeed <= 1e-9 && setup.acceleration <= 0;
  const weight = context.body.mass * context.gravity;
  const rampEndLimited = setup.endTime < window;
  const assumptions = [
    `The scene has one friction field, so the static and the kinetic coefficient are both mu = ${fixed(context.body.friction)}. The box holds still whenever g·sinθ is at or below mu·g·cosθ.`,
    `The box is held flat on the slope, so it slides instead of tumbling, and the normal force is N = m·g·cosθ − F·n̂ = ${fixed(inclineNormalForce(setup.params))} N for the whole run.`,
    `Friction is mu·N per metre slid, so the dissipated energy is mu·N·s.`,
    `Heights are measured from the foot of the ramp, which is the zero of the gravitational potential m·g·h.`,
    `The reported distance is along the slope and the range is the horizontal shift of the body centre.`,
  ];
  if (stuck) {
    assumptions.push(`The box never starts moving, so it stays ${fixed(setup.startHeight)} m above the foot of the ramp for the whole window.`);
  } else if (rampEndLimited) {
    assumptions.push(`The box runs off the foot of the ramp after ${fixed(setup.endTime)} s, so the run stops there with ${fixed(setup.startAlong)} m of ramp travelled. A longer window needs a longer ramp.`);
  } else if (setup.stopTime < window) {
    assumptions.push(`The box slows to a stop after ${fixed(setup.stopTime)} s and holds there, because mu·N is larger than the pull down the slope.`);
  } else {
    assumptions.push(`The window ends after ${fixed(window)} s while the box is still speeding up, and the ramp is long enough for it.`);
  }

  const sample = (elapsedSeconds: number): AnalyticalFrame => {
    const time = clampTime(elapsedSeconds, duration);
    const state = inclineStateAt(params, time);
    const surface = rampSurfacePoint(ramp, state.along);
    const x = surface.x + frame.outward.x * setup.support;
    const y = surface.y + frame.outward.y * setup.support;
    const speed = state.speed;
    const slid = setup.startAlong - state.along;
    const height = y - setup.support - ramp.y;
    return {
      scene: context.scene,
      time,
      duration,
      finished: time >= duration - 1e-12,
      bodies: [...staticBodies(context), { id: context.body.id, x, y, angleDeg: frame.angleDeg }],
      forces: [
        force(context.body.id, "gravity", 0, -weight),
        force(context.body.id, "normal", state.normalForce * frame.outward.x, state.normalForce * frame.outward.y),
        force(
          context.body.id,
          "friction",
          state.frictionDownhill * frame.downhill.x,
          state.frictionDownhill * frame.downhill.y,
        ),
        ...appliedForceEntry(context.body.id, context.applied),
      ],
      energy: {
        kinetic: 0.5 * context.body.mass * speed * speed,
        potential: context.body.mass * context.gravity * height,
        dissipated: state.stuck ? 0 : Math.abs(state.frictionDownhill) * slid,
      },
      metrics: {
        distance: slid,
        finalSpeed: speed,
        time,
        maxHeight: Math.max(setup.startHeight, height),
        range: Math.abs(x - context.startX),
        period: null,
      },
      assumptions,
    };
  };
  return { scene: context.scene, duration, assumptions, period: null, sample };
}

function buildFlight(context: Context): AnalyticalModel {
  const setup: FlightSetup = flightSetup(context.scene, context.body);
  const window = context.scene.question.timeWindow;
  const duration = Math.min(window, setup.landingTime);
  const mass = context.body.mass;
  const weight = mass * context.gravity;
  const peak = flightPeakHeight(setup.params);
  const truncated = window < setup.landingTime;
  const assumptions = [
    `No air resistance. The only forces are gravity and the constant applied force, so the acceleration is constant and x = x₀ + vₓt + ½aₓt² with y = y₀ + vᵧt + ½aᵧt².`,
    setup.groundSpan
      ? `The launch height is measured from the bottom of the body to the top of the ground, and the ground is a flat reference plane spanning ${fixed(setup.groundSpan.left)} m to ${fixed(setup.groundSpan.right)} m.`
      : `The scene has no ground body, so y = 0 is used as the reference plane instead.`,
    `The flight duration is the landing time, ${fixed(setup.landingTime)} s, solved from the first non negative root of y₀ + vᵧt + ½aᵧt² = 0.`,
    truncated
      ? `The window of ${fixed(window)} s ends before touchdown, so the range is still growing when the scene stops.`
      : `The window of ${fixed(window)} s covers the whole flight, so the run ends at the landing time.`,
    `Range is the absolute horizontal displacement, maxHeight is the bottom of the body above the ground, and the reported distance is the straight line displacement from the start.`,
  ];

  const sample = (elapsedSeconds: number): AnalyticalFrame => {
    const time = clampTime(elapsedSeconds, duration);
    const state = flightStateAt(setup.params, time);
    const x = context.body.x + state.x;
    const y = setup.referenceY + setup.support + state.height;
    const pastPeak = time >= setup.peakTime;
    const maxHeight = pastPeak
      ? Math.max(setup.startHeight, peak)
      : Math.max(setup.startHeight, state.height);
    return {
      scene: context.scene,
      time,
      duration,
      finished: time >= duration - 1e-12,
      bodies: [...staticBodies(context), { id: context.body.id, x, y, angleDeg: context.body.angleDeg }],
      forces: [
        force(context.body.id, "gravity", 0, -weight),
        ...appliedForceEntry(context.body.id, context.applied),
      ],
      energy: {
        kinetic: 0.5 * mass * (state.vx * state.vx + state.vy * state.vy),
        potential: mass * context.gravity * state.height,
        dissipated: 0,
      },
      metrics: {
        distance: Math.hypot(state.x, state.height - setup.startHeight),
        finalSpeed: Math.hypot(state.vx, state.vy),
        time,
        maxHeight,
        range: Math.abs(state.x),
        period: null,
      },
      assumptions,
    };
  };
  return { scene: context.scene, duration, assumptions, period: null, sample };
}

function buildSpring(context: Context): AnalyticalModel {
  const spring = springConstraint(context.scene, context.body);
  const setup: SpringSetup = springSetup(context.scene, context.body, spring);
  const { params, model } = setup;
  const window = context.scene.question.timeWindow;
  const duration = window;
  const mass = context.body.mass;
  const weight = mass * context.gravity;
  const topTime = springTopTime(params);
  const assumptions = [
    `k = ${fixed(params.stiffness)} N/m is a physical Hooke stiffness, so the period is 2π√(m/k) = ${fixed(model.period)} s and neither gravity nor the applied force changes it.`,
    `restLength is the unstretched length L₀ = ${fixed(params.restLength)} m, while the equilibrium length is L₀ + (m·g − F_y)/k = ${fixed(model.equilibriumLength)} m, so the static sag is ${fixed(model.sag)} m.`,
    `The oscillation is undamped, so the amplitude stays at ${fixed(model.amplitude)} m, set by the initial stretch and the initial speed.`,
    `The elastic energy is ½k(L − L₀)² about the rest length and the gravitational energy is m·g·h above the reference plane at y = ${fixed(setup.referenceY)} m, so the total is constant over every period.`,
    `The mass moves along the spring only, and the reported distance is the straight line displacement from the start of the window.`,
  ];

  const sample = (elapsedSeconds: number): AnalyticalFrame => {
    const time = clampTime(elapsedSeconds, duration);
    const state = springStateAt(params, time);
    const height = state.y - setup.support - setup.referenceY;
    const springForce = params.stiffness * state.extension;
    return {
      scene: context.scene,
      time,
      duration,
      finished: time >= duration - 1e-12,
      bodies: [...staticBodies(context), { id: context.body.id, x: context.body.x, y: state.y, angleDeg: context.body.angleDeg }],
      forces: [
        force(context.body.id, "gravity", 0, -weight),
        force(context.body.id, "spring", 0, springForce),
        ...appliedForceEntry(context.body.id, context.applied),
      ],
      energy: {
        kinetic: 0.5 * mass * state.v * state.v,
        potential:
          0.5 * params.stiffness * state.extension * state.extension +
          mass * context.gravity * (state.y - setup.referenceY),
        dissipated: 0,
      },
      metrics: {
        distance: Math.abs(state.y - context.startY),
        finalSpeed: Math.abs(state.v),
        time,
        maxHeight: time >= topTime ? model.equilibriumY + model.amplitude - setup.support - setup.referenceY : Math.max(setup.startHeight, height),
        range: 0,
        period: model.period,
      },
      assumptions,
    };
  };
  return { scene: context.scene, duration, assumptions, period: model.period, sample };
}

// Time is clamped rather than rejected, so a renderer that overshoots the
// duration by a frame still shows the last valid state.
function clampTime(elapsedSeconds: number, duration: number): number {
  if (!Number.isFinite(elapsedSeconds)) throw new Error(`The elapsed time has to be a finite number, but it is ${elapsedSeconds}.`);
  return Math.min(Math.max(0, elapsedSeconds), duration);
}

// Builds the model once. A renderer that samples every frame should keep the
// model and call sample on it, because rebuilding revalidates the whole scene.
export function createAnalyticalModel(input: Scene): AnalyticalModel {
  const context = prepare(input);
  if (context.scene.problemType === "incline") {
    const ramp = findRamp(context.scene);
    if (!ramp) throw new Error("An incline scene needs a ramp body to slide on.");
    return buildIncline(context, ramp);
  }
  if (context.scene.problemType === "projectile" || context.scene.problemType === "freefall") return buildFlight(context);
  return buildSpring(context);
}

export function getDuration(input: Scene): number {
  return createAnalyticalModel(input).duration;
}

export function sampleScene(input: Scene, elapsedSeconds: number): AnalyticalFrame {
  return createAnalyticalModel(input).sample(elapsedSeconds);
}
