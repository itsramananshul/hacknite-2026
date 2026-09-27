// Geometry, unit mapping and the shared closed form physics of Chalk.
//
// The world is metres, the origin is the bottom left corner and y points up. A
// renderer maps to screen pixels with worldToPixel when it needs to draw, but
// nothing inside the simulation ever leaves metres.
//
// The physics section at the bottom is the single source of truth for every
// number in the app: the engine samples it for the animation and the solvers
// read it for the official answers, so the two can never disagree. It is pure
// arithmetic on small parameter objects with no time stepping, which is why
// lib/solvers.ts never has to import lib/engine.ts.
import type { Scene, SceneBody } from "./schema";

export interface Vec2 {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;

// Tolerance for the zero tests in the closed form helpers. A scene value such as
// 1e-15 m/s is a rounding artefact, not real motion.
export const EPS = 1e-9;

export const toRadians = (degrees: number): number => degrees * DEG;
export const toDegrees = (radians: number): number => radians / DEG;

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export const hypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

// Pixel mapping, for the renderer only.
export const metresToPixels = (metres: number, pixelsPerMeter: number): number => metres * pixelsPerMeter;
export const pixelsToMetres = (pixels: number, pixelsPerMeter: number): number => pixels / pixelsPerMeter;
export const worldToPixel = (point: Vec2, pixelsPerMeter: number): Vec2 => ({
  x: point.x * pixelsPerMeter,
  y: -point.y * pixelsPerMeter,
});
export const pixelToWorld = (point: Vec2, pixelsPerMeter: number): Vec2 => ({
  x: point.x / pixelsPerMeter,
  y: -point.y / pixelsPerMeter,
});
export const directionToPixel = (direction: Vec2): Vec2 => ({ x: direction.x, y: -direction.y });
export const directionToWorld = (direction: Vec2): Vec2 => ({ x: direction.x, y: -direction.y });

export interface RampFrame {
  angleDeg: number;
  theta: number;
  run: number;
  rise: number;
  slopeLength: number;
  uphill: Vec2;
  downhill: Vec2;
  outward: Vec2;
}

// A ramp is a right triangle whose x/y is the lower left corner, whose width is
// the horizontal run and whose height is width * tan(angle). The hypotenuse runs
// from the lower left corner up to the top right corner, so the slope is
// positive and a body on it slides downhill towards negative x.
export function rampFrame(ramp: SceneBody): RampFrame {
  const theta = toRadians(ramp.angleDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    angleDeg: ramp.angleDeg,
    theta,
    run: ramp.width,
    rise: ramp.height,
    slopeLength: ramp.width / cos,
    uphill: { x: cos, y: sin },
    downhill: { x: -cos, y: -sin },
    outward: { x: -sin, y: cos },
  };
}

export function rampVertices(ramp: SceneBody): Vec2[] {
  return [
    { x: ramp.x, y: ramp.y },
    { x: ramp.x + ramp.width, y: ramp.y },
    { x: ramp.x + ramp.width, y: ramp.y + ramp.height },
  ];
}

export function rampCentroid(ramp: SceneBody): Vec2 {
  return {
    x: ramp.x + (2 * ramp.width) / 3,
    y: ramp.y + ramp.height / 3,
  };
}

// Distance from the lower left corner to a point, measured along the slope.
export function rampAlongDistance(ramp: SceneBody, point: Vec2): number {
  const frame = rampFrame(ramp);
  return (point.x - ramp.x) * frame.uphill.x + (point.y - ramp.y) * frame.uphill.y;
}

export function rampSurfacePoint(ramp: SceneBody, along: number): Vec2 {
  const frame = rampFrame(ramp);
  return { x: ramp.x + along * frame.uphill.x, y: ramp.y + along * frame.uphill.y };
}

// Distance from the slope surface to a point, measured along the outward normal.
export function rampSurfaceOffset(ramp: SceneBody, point: Vec2): number {
  const frame = rampFrame(ramp);
  return (point.x - ramp.x) * frame.outward.x + (point.y - ramp.y) * frame.outward.y;
}

// How far along the slope a point sits, clamped to the ramp itself.
export function rampRemainingRun(ramp: SceneBody, point: Vec2): number {
  return clamp(rampAlongDistance(ramp, point), 0, rampFrame(ramp).slopeLength);
}

export function bodySupport(body: SceneBody): number {
  return body.kind === "ball" ? body.radius : body.height / 2;
}

export function bodyBottomHeight(body: SceneBody, point: Vec2): number {
  return point.y - bodySupport(body);
}

export function findRamp(scene: Scene): SceneBody | null {
  return scene.bodies.find((body) => body.kind === "ramp") ?? null;
}

// The first ground body in scene order is the reference surface. Both the
// solvers and the engine read it through this helper so they cannot pick
// different planes.
export function findGround(scene: Scene): SceneBody | null {
  return scene.bodies.find((body) => body.kind === "ground") ?? null;
}

export interface HeightReference {
  y: number;
  source: "ground" | "worldFloor";
}

export function heightReference(scene: Scene): HeightReference {
  const ground = findGround(scene);
  return ground
    ? { y: ground.y + ground.height / 2, source: "ground" }
    : { y: 0, source: "worldFloor" };
}

export function isStaticBody(body: SceneBody): boolean {
  return body.isStatic;
}

export function movingBodies(scene: Scene): SceneBody[] {
  return scene.bodies.filter((body) => !body.isStatic);
}

// Constant applied forces are listed per body in newtons and summed here, so a
// scene can split one push across several entries.
export function totalAppliedForce(scene: Scene, bodyId: string): Vec2 {
  let x = 0;
  let y = 0;
  for (const force of scene.appliedForces ?? []) {
    if (force.bodyId !== bodyId) continue;
    x += force.x;
    y += force.y;
  }
  return { x, y };
}

// ---------------------------------------------------------------------------
// Incline. Positions are measured along the slope from the foot of the ramp, so
// the distance from the foot is also the run available downhill before the body
// leaves the ramp.
// ---------------------------------------------------------------------------

export interface InclineParams {
  theta: number;
  mass: number;
  gravity: number;
  friction: number;
  applied: Vec2;
  startSpeed: number;
  startAlong: number;
  slopeLength: number;
}

export interface InclineState {
  along: number;
  speed: number;
  normalForce: number;
  frictionDownhill: number;
  stuck: boolean;
}

// Component of the applied force along the slope, positive downhill.
export function inclineAppliedAlong(params: InclineParams): number {
  const cos = Math.cos(params.theta);
  const sin = Math.sin(params.theta);
  return -(params.applied.x * cos + params.applied.y * sin);
}

// N = m·g·cosθ − F·n̂, so an upward applied force unloads the slope.
export function inclineNormalForce(params: InclineParams): number {
  const cos = Math.cos(params.theta);
  const outward = params.applied.x * -Math.sin(params.theta) + params.applied.y * cos;
  return params.mass * params.gravity * cos - outward;
}

// How hard gravity and the applied force pull the body down the slope, in
// newtons. A body at rest that needs more than the friction limit slides.
export function inclineDownhillTendency(params: InclineParams): number {
  return params.mass * params.gravity * Math.sin(params.theta) + inclineAppliedAlong(params);
}

// a = g·sinθ + F_along/m − μ·N/m, which is the form quoted in the assumption
// text when the applied force is purely tangential.
export function inclineNetAcceleration(params: InclineParams): number {
  return (
    params.gravity * Math.sin(params.theta) +
    inclineAppliedAlong(params) / params.mass -
    (params.friction * inclineNormalForce(params)) / params.mass
  );
}

// Time at which the speed reaches zero and stays there, or Infinity when the
// body never stops. A body that never starts sliding returns 0.
export function inclineStopTime(params: InclineParams): number {
  const acceleration = inclineNetAcceleration(params);
  if (params.startSpeed <= EPS) return acceleration <= 0 ? 0 : Infinity;
  if (acceleration >= 0) return Infinity;
  return params.startSpeed / -acceleration;
}

// Time at which the body reaches the foot of the ramp, or Infinity when it comes
// to rest before then. The same quadratic covers both signs of the
// acceleration, and a body that slows down can still run off the end.
export function inclineEndTime(params: InclineParams): number {
  if (params.startAlong <= EPS) return 0;
  const acceleration = inclineNetAcceleration(params);
  if (Math.abs(acceleration) <= 1e-12) {
    return params.startSpeed > EPS ? params.startAlong / params.startSpeed : Infinity;
  }
  const discriminant = params.startSpeed * params.startSpeed + 2 * acceleration * params.startAlong;
  if (discriminant < 0) return Infinity;
  return (-params.startSpeed + Math.sqrt(discriminant)) / acceleration;
}

export function inclineStateAt(params: InclineParams, time: number): InclineState {
  const acceleration = inclineNetAcceleration(params);
  const normalForce = inclineNormalForce(params);
  // One friction field, so the static and the kinetic coefficients are the same
  // number and a body that cannot start simply stays where it is.
  if (params.startSpeed <= EPS && acceleration <= 0) {
    return {
      along: params.startAlong,
      speed: 0,
      normalForce,
      frictionDownhill: -inclineDownhillTendency(params),
      stuck: true,
    };
  }
  const span = Math.min(time, inclineStopTime(params), inclineEndTime(params));
  const travelled = params.startSpeed * span + 0.5 * acceleration * span * span;
  return {
    // along counts up the slope, so sliding down moves the body towards 0 and it
    // can never leave the ramp or reverse.
    along: clamp(params.startAlong - travelled, 0, params.startAlong),
    speed: Math.max(0, params.startSpeed + acceleration * span),
    normalForce,
    frictionDownhill: -params.friction * normalForce,
    stuck: false,
  };
}

export interface InclineSetup {
  params: InclineParams;
  frame: RampFrame;
  startAlong: number;
  startHeight: number;
  support: number;
  acceleration: number;
  stopTime: number;
  endTime: number;
}

// Turns a body placed on a ramp into the numbers the closed form helpers want
// and rejects the placements the model cannot describe. The engine and the
// incline solver both go through here, so they accept exactly the same scenes.
export function inclineSetup(scene: Scene, body: SceneBody, ramp: SceneBody): InclineSetup {
  const frame = rampFrame(ramp);
  const startAlong = rampAlongDistance(ramp, body);
  if (startAlong > frame.slopeLength + 1e-6) {
    throw new Error("The body is placed past the top of the ramp, so there is no slope left for it to slide on.");
  }
  if (startAlong <= 1e-6) {
    throw new Error("The body is already at the foot of the ramp, so there is nowhere left to slide.");
  }
  // The scene stores one velocity vector, so the downhill component is read in
  // the ramp frame rather than from the world x axis.
  const startSpeed = body.initialVelocity.x * frame.downhill.x + body.initialVelocity.y * frame.downhill.y;
  if (startSpeed < -1e-8) {
    throw new Error("A body on a ramp can only start at rest or moving downhill, not moving up the slope.");
  }
  const params: InclineParams = {
    theta: frame.theta,
    mass: body.mass,
    gravity: scene.world.gravity,
    friction: body.friction,
    applied: totalAppliedForce(scene, body.id),
    startSpeed,
    startAlong,
    slopeLength: frame.slopeLength,
  };
  if (inclineNormalForce(params) <= 0) {
    throw new Error("The applied force is large enough to lift the body off the ramp, so the slide is not supported.");
  }
  return {
    params,
    frame,
    startAlong,
    startHeight: body.y - bodySupport(body) - ramp.y,
    support: bodySupport(body),
    acceleration: inclineNetAcceleration(params),
    stopTime: inclineStopTime(params),
    endTime: inclineEndTime(params),
  };
}

// ---------------------------------------------------------------------------
// Projectile and freefall. A constant acceleration in both axes until the body
// first reaches the reference plane. No drag and no bounce.
// ---------------------------------------------------------------------------

export interface FlightParams {
  mass: number;
  gravity: number;
  applied: Vec2;
  height0: number;
  vx: number;
  vy: number;
}

export interface FlightState {
  x: number;
  height: number;
  vx: number;
  vy: number;
}

// Net acceleration: gravity plus the constant applied force divided by the mass.
export function flightAcceleration(params: FlightParams): Vec2 {
  return { x: params.applied.x / params.mass, y: params.applied.y / params.mass - params.gravity };
}

// First strictly positive root of height0 + v_y·t + ½·a_y·t² = 0, which covers a
// downward launch, a flat launch and a body released from rest. Returns null
// when the body never comes back, so the caller rejects the scene instead of
// quoting a number out of an imaginary square root.
export function flightLandingTime(params: FlightParams): number | null {
  const { height0, vy } = params;
  const ay = flightAcceleration(params).y;
  if (height0 <= 1e-9 && ay >= -EPS && vy <= EPS) return null;
  if (Math.abs(ay) <= 1e-12) return vy >= -EPS ? null : -height0 / vy;
  const discriminant = vy * vy - 2 * ay * height0;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-vy + root) / ay;
  const second = (-vy - root) / ay;
  const positive = [first, second].filter((value) => value > 1e-9);
  return positive.length ? Math.min(...positive) : null;
}

export function flightStateAt(params: FlightParams, time: number): FlightState {
  const acceleration = flightAcceleration(params);
  return {
    x: params.vx * time + 0.5 * acceleration.x * time * time,
    height: params.height0 + params.vy * time + 0.5 * acceleration.y * time * time,
    vx: params.vx + acceleration.x * time,
    vy: params.vy + acceleration.y * time,
  };
}

// Time at which the height stops growing, or 0 when the body never rises.
export function flightPeakTime(params: FlightParams): number {
  const ay = flightAcceleration(params).y;
  return ay < -1e-12 && params.vy > 0 ? params.vy / -ay : 0;
}

// Highest point of the bottom of the body above the reference plane.
export function flightPeakHeight(params: FlightParams): number {
  const ay = flightAcceleration(params).y;
  if (ay >= -1e-12 || params.vy <= 0) return params.height0;
  return params.height0 + (params.vy * params.vy) / (-2 * ay);
}

export interface FlightSetup {
  params: FlightParams;
  landingTime: number;
  referenceY: number;
  support: number;
  startHeight: number;
  peakTime: number;
  groundSpan: { left: number; right: number } | null;
}

export function flightSetup(scene: Scene, body: SceneBody): FlightSetup {
  const reference = heightReference(scene);
  const support = bodySupport(body);
  const startHeight = body.y - support - reference.y;
  if (startHeight < -1e-6) throw new Error("The body starts below the ground, so there is no flight to simulate.");
  const params: FlightParams = {
    mass: body.mass,
    gravity: scene.world.gravity,
    applied: totalAppliedForce(scene, body.id),
    height0: startHeight,
    vx: body.initialVelocity.x,
    vy: body.initialVelocity.y,
  };
  const landingTime = flightLandingTime(params);
  if (landingTime === null) {
    const launched = params.vy > 1e-9 || flightAcceleration(params).y > 1e-9;
    if (!launched) {
      throw new Error("The body starts on the ground and is not launched upwards, so it has no time of flight.");
    }
    throw new Error("The body never returns to the ground, so the flight duration is undefined. Remove the upward applied force or lower the launch.");
  }
  const ground = findGround(scene);
  let groundSpan: { left: number; right: number } | null = null;
  if (ground) {
    groundSpan = { left: ground.x - ground.width / 2, right: ground.x + ground.width / 2 };
    const landingX = body.x + flightStateAt(params, landingTime).x;
    if (landingX < groundSpan.left || landingX > groundSpan.right) {
      throw new Error(
        `The body lands at x = ${landingX.toFixed(3)} m but the ground only spans ${groundSpan.left.toFixed(3)} m to ${groundSpan.right.toFixed(3)} m, so it would fall past the end of the ground.`,
      );
    }
  }
  return {
    params,
    landingTime,
    referenceY: reference.y,
    support,
    startHeight,
    peakTime: flightPeakTime(params),
    groundSpan,
  };
}

// ---------------------------------------------------------------------------
// Spring. One mass on a vertical Hooke spring tied to a fixed anchor. The spring
// is driven as a physical force with k in N/m and the oscillation is undamped.
// ---------------------------------------------------------------------------

export interface SpringParams {
  anchorY: number;
  mass: number;
  gravity: number;
  stiffness: number;
  restLength: number;
  applied: Vec2;
  y0: number;
  v0: number;
}

export interface SpringModel {
  omega: number;
  period: number;
  equilibriumLength: number;
  equilibriumY: number;
  amplitude: number;
  sag: number;
}

export interface SpringState {
  y: number;
  v: number;
  extension: number;
}

// At rest k·(L − L₀) = m·g − F_y, so a vertical spring carries the weight and
// the equilibrium length is the rest length plus the static sag mg/k. Gravity
// and the applied vertical force move the equilibrium, but they leave the period
// 2π√(m/k) untouched.
export function springModel(params: SpringParams): SpringModel {
  const omega = Math.sqrt(params.stiffness / params.mass);
  const sag = (params.mass * params.gravity - params.applied.y) / params.stiffness;
  const equilibriumLength = params.restLength + sag;
  const offset = params.anchorY - params.y0 - equilibriumLength;
  return {
    omega,
    period: (2 * Math.PI) / omega,
    equilibriumLength,
    equilibriumY: params.anchorY - equilibriumLength,
    amplitude: Math.hypot(offset, params.v0 / omega),
    sag,
  };
}

// u = L − L_eq satisfies ü = −ω²u, so the initial stretch and the initial speed
// set the amplitude and the phase of the whole motion.
export function springStateAt(params: SpringParams, time: number): SpringState {
  const model = springModel(params);
  const offset = params.anchorY - params.y0 - model.equilibriumLength;
  const cos = Math.cos(model.omega * time);
  const sin = Math.sin(model.omega * time);
  const stretch = offset * cos - (params.v0 / model.omega) * sin;
  const y = model.equilibriumY - stretch;
  return { y, v: model.omega * offset * sin + params.v0 * cos, extension: params.anchorY - y - params.restLength };
}

// First time the mass reaches the top of its swing, where the running height
// maximum saturates at equilibriumY + amplitude.
export function springTopTime(params: SpringParams): number {
  const model = springModel(params);
  const offset = params.anchorY - params.y0 - model.equilibriumLength;
  return (Math.PI - Math.atan2(params.v0 / model.omega, offset)) / model.omega;
}

export interface SpringSetup {
  params: SpringParams;
  model: SpringModel;
  support: number;
  startHeight: number;
  startLength: number;
  referenceY: number;
}

export function springSetup(
  scene: Scene,
  body: SceneBody,
  spring: { anchor: Vec2; stiffness: number; restLength: number },
): SpringSetup {
  if (Math.abs(spring.anchor.x - body.x) > 1e-6) {
    throw new Error("Only a vertical spring is supported, so the anchor has to be directly above the mass.");
  }
  if (spring.anchor.y <= body.y) {
    throw new Error("The spring anchor has to be above the mass, which hangs from it.");
  }
  if (Math.abs(body.initialVelocity.x) > 1e-9) {
    throw new Error("A horizontal initial velocity is not supported, so the mass has to move along the spring only.");
  }
  const applied = totalAppliedForce(scene, body.id);
  if (Math.abs(applied.x) > 1e-9) {
    throw new Error("A horizontal applied force on a vertical spring is not supported.");
  }
  const params: SpringParams = {
    anchorY: spring.anchor.y,
    mass: body.mass,
    gravity: scene.world.gravity,
    stiffness: spring.stiffness,
    restLength: spring.restLength,
    applied,
    y0: body.y,
    v0: body.initialVelocity.y,
  };
  const support = bodySupport(body);
  const referenceY = heightReference(scene).y;
  return {
    params,
    model: springModel(params),
    support,
    startHeight: body.y - support - referenceY,
    startLength: spring.anchor.y - body.y,
    referenceY,
  };
}
