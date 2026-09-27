import { validateScene, type Scene, type SceneBody } from "./schema";

export interface SolverResult {
  value: number;
  unit: string;
  title: string;
  distance: number;
  finalSpeed: number;
  time: number;
  maxHeight?: number;
  acceleration?: number;
  steps: string[];
  assumptions: string[];
}

const degrees = (value: number) => value * Math.PI / 180;
const fixed = (value: number) => value.toFixed(3);

export function questionBody(scene: Scene): SceneBody {
  const body = scene.bodies.find((item) => item.id === scene.question.bodyId);
  if (!body || body.isStatic) throw new Error("The question must refer to a moving body.");
  return body;
}

export function solveIncline(input: Scene): SolverResult {
  const scene = validateScene(input);
  const block = questionBody(scene);
  const ramp = scene.bodies.find((body) => body.kind === "ramp");
  if (!ramp) throw new Error("Incline problems require a ramp.");
  const theta = degrees(ramp.angleDeg);
  const gravity = scene.world.gravity;
  const drive = gravity * Math.sin(theta);
  const resistance = block.friction * gravity * Math.cos(theta);
  const speed = -block.initialVelocity.x * Math.cos(theta) - block.initialVelocity.y * Math.sin(theta);
  if (speed < -1e-8) throw new Error("The incline solver currently supports rest or downhill initial motion.");
  const stuck = speed <= 1e-8 && drive <= resistance;
  const acceleration = stuck ? 0 : drive - resistance;
  const stopTime = acceleration < 0 ? speed / -acceleration : Infinity;
  const time = scene.question.timeWindow;
  const movingTime = Math.min(time, stopTime);
  const distance = stuck ? 0 : speed * movingTime + 0.5 * acceleration * movingTime ** 2;
  const finalSpeed = stuck || time >= stopTime ? 0 : Math.max(0, speed + acceleration * time);
  const target = scene.question.target;
  if (!["distance", "finalSpeed", "time"].includes(target)) throw new Error("Incline supports distance, final speed, or stopping time.");
  if (target === "time" && !stuck && !Number.isFinite(stopTime)) throw new Error("This box does not stop on an indefinitely long ramp.");
  return {
    value: target === "finalSpeed" ? finalSpeed : target === "time" ? (stuck ? 0 : stopTime) : distance,
    unit: target === "finalSpeed" ? "m/s" : target === "time" ? "s" : "m",
    title: target === "finalSpeed" ? "Final speed" : target === "time" ? "Stopping time" : "Distance along ramp",
    distance, finalSpeed, time, acceleration,
    steps: [
      stuck ? "Static friction balances the downhill force; the box stays at rest." : `a = g(sin θ − μ cos θ) = ${fixed(acceleration)} m/s²`,
      `s = v₀t + ½at² = ${fixed(distance)} m`,
      `v = ${fixed(finalSpeed)} m/s at t = ${fixed(time)} s`,
    ],
    assumptions: ["Static and kinetic friction coefficients are assumed equal because the scene has one friction field.", "No air resistance. The ramp continues for the requested travel distance."],
  };
}

export function solveProjectile(input: Scene): SolverResult {
  const scene = validateScene(input);
  const body = questionBody(scene);
  const ground = scene.bodies.find((item) => item.kind === "ground");
  if (!ground) throw new Error("Projectile problems require a ground plane.");
  const floor = ground.y + ground.height / 2;
  const support = body.kind === "ball" ? body.radius : body.height / 2;
  const height = body.y - support - floor;
  if (height < -1e-6) throw new Error("The projectile starts below the ground.");
  const { x: vx, y: vy } = body.initialVelocity;
  const gravity = scene.world.gravity;
  const time = (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, height))) / gravity;
  const range = Math.abs(vx) * time;
  const maxHeight = Math.max(0, height) + Math.max(0, vy) ** 2 / (2 * gravity);
  const finalSpeed = Math.hypot(vx, vy - gravity * time);
  const target = scene.question.target;
  if (!["range", "time", "maxHeight", "finalSpeed"].includes(target)) throw new Error("Projectile supports range, flight time, maximum height, or impact speed.");
  return {
    value: target === "time" ? time : target === "maxHeight" ? maxHeight : target === "finalSpeed" ? finalSpeed : range,
    unit: target === "time" ? "s" : target === "finalSpeed" ? "m/s" : "m",
    title: target === "time" ? "Time of flight" : target === "maxHeight" ? "Maximum height above ground" : target === "finalSpeed" ? "Impact speed" : "Horizontal range",
    distance: range, finalSpeed, time, maxHeight,
    steps: [`h + vᵧt − ½gt² = 0 → t = ${fixed(time)} s`, `Range = |vₓ|t = ${fixed(range)} m`, `Peak height = h + max(0, vᵧ)²/(2g) = ${fixed(maxHeight)} m`],
    assumptions: ["No air resistance. Constant gravity and horizontal ground.", "Initial height is measured from the bottom of the object to the ground."],
  };
}

export function solveScene(scene: Scene): SolverResult | null {
  if (scene.problemType === "incline") return solveIncline(scene);
  if (scene.problemType === "projectile" || scene.problemType === "freefall") return solveProjectile(scene);
  return null;
}
