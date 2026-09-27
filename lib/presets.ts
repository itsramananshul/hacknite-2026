import { resolveScene, type Scene, type SceneBody } from "./schema";
import { rampFrame, rampSurfacePoint, toRadians } from "./geometry";

// Three offline presets, each hand checked against a closed form answer. The
// body placement uses the same ramp helpers as the engine, so a preset can never
// disagree with the geometry it describes.

const body = (overrides: Partial<SceneBody> & Pick<SceneBody, "id" | "kind">): SceneBody => ({
  x: 0, y: 0, width: 0.7, height: 0.7, radius: 0.25,
  angleDeg: 0, mass: 1, isStatic: false, friction: 0, restitution: 0,
  initialVelocity: { x: 0, y: 0 }, label: "", ...overrides,
});

const base = {
  units: { length: "m", mass: "kg", angle: "deg" },
  world: { gravity: 9.81, pixelsPerMeter: 50, width: 20, height: 12 },
  constraints: [], labeledValues: [], confidence: 1,
} satisfies Partial<Scene>;

const rampAngleDeg = 30;
const rampRun = 10;
const rampRise = rampRun * Math.tan(toRadians(rampAngleDeg));
const startAlong = 10;

// The ramp is a right triangle: x and y are the lower left corner, width is the
// horizontal run and height is width * tan(angle). The hypotenuse climbs to the
// right, so a box on it slides downhill towards the lower left corner.
const ramp = body({
  id: "ramp", kind: "ramp", x: 1, y: 1, width: rampRun, height: rampRise,
  angleDeg: rampAngleDeg, isStatic: true, label: "30° ramp",
});

const rampGeometry = rampFrame(ramp);
const slopeStart = rampSurfacePoint(ramp, startAlong);
const boxThickness = 0.7;
const boxStart = {
  x: slopeStart.x + rampGeometry.outward.x * (boxThickness / 2),
  y: slopeStart.y + rampGeometry.outward.y * (boxThickness / 2),
};

export const inclinePreset: Scene = resolveScene({
  ...base, problemType: "incline",
  bodies: [
    ramp,
    body({
      id: "box", kind: "block", x: boxStart.x, y: boxStart.y, angleDeg: rampAngleDeg,
      mass: 5, friction: 0.2, label: "5 kg box, μ = 0.2",
    }),
  ],
  labeledValues: [
    { symbol: "m", value: 5, unit: "kg", appliesTo: "box", field: "mass" },
    { symbol: "θ", value: rampAngleDeg, unit: "deg", appliesTo: "ramp", field: "angleDeg" },
    { symbol: "μ", value: 0.2, unit: "", appliesTo: "box", field: "friction" },
  ],
  question: { text: "How far does the 5 kg box slide down the 30° ramp in 2 seconds, with μ = 0.2?", target: "distance", bodyId: "box", timeWindow: 2 },
  notes: "Verified answer: 6.411716 m along the ramp, which is 0.5 * a * t² with a = g(sin30° − 0.2 cos30°) = 3.205858 m/s². Starts from rest with 10 m of ramp below it, which is more than the 6.41 m the window needs. Static friction is assumed equal to kinetic friction because the scene has one friction field.",
}).scene;

const launchSpeed = 10;
const launchAngleDeg = 45;
const launchAngle = toRadians(launchAngleDeg);

export const projectilePreset: Scene = resolveScene({
  ...base, problemType: "projectile",
  bodies: [
    body({ id: "ground", kind: "ground", x: 10, y: 0.25, width: 20, height: 0.5, isStatic: true, label: "Ground" }),
    body({
      id: "ball", kind: "ball", x: 1.5, y: 0.75, label: "10 m/s at 45°",
      initialVelocity: { x: launchSpeed * Math.cos(launchAngle), y: launchSpeed * Math.sin(launchAngle) },
    }),
  ],
  labeledValues: [
    { symbol: "v₀", value: launchSpeed, unit: "m/s", appliesTo: "ball", field: "speed" },
    { symbol: "θ", value: launchAngleDeg, unit: "deg", appliesTo: "ball", field: "launchAngleDeg" },
  ],
  question: { text: "How far does a ball launched at 10 m/s and 45° travel before it lands?", target: "range", bodyId: "ball", timeWindow: 3 },
  notes: "Verified range: 10.193680 m; flight time: 1.441604 s; peak height: 2.548420 m above the ground. The ball starts on the ground, so the launch height is zero.",
}).scene;

export const springPreset: Scene = resolveScene({
  ...base, problemType: "spring",
  bodies: [body({ id: "mass", kind: "ball", x: 10, y: 5, mass: 1, label: "1 kg on a 20 N/m spring" })],
  constraints: [{ id: "spring", kind: "spring", bodyA: "mass", bodyB: null, anchor: { x: 10, y: 9 }, stiffness: 20, restLength: 3 }],
  labeledValues: [{ symbol: "k", value: 20, unit: "N/m", appliesTo: "mass", field: "stiffness" }],
  question: { text: "A 1 kg mass hangs from a 20 N/m spring. What is the oscillation period?", target: "period", bodyId: "mass", timeWindow: 8 },
  notes: "Physical Hooke spring with k in N/m. Small oscillation period: 2π√(m/k) = 1.404963 s, which gravity does not change. The rest length is 3 m while the equilibrium length is 3 + mg/k = 3.4905 m, so the 1 kg mass hangs 0.5095 m below equilibrium and oscillates undamped with an amplitude of 0.5095 m.",
}).scene;

export const presets = { incline: inclinePreset, projectile: projectilePreset, spring: springPreset };
export type PresetKey = keyof typeof presets;

export const presetList: { key: PresetKey; name: string; blurb: string }[] = [
  { key: "incline", name: "Incline", blurb: "A 5 kg box sliding down a 30° ramp with μ = 0.2." },
  { key: "projectile", name: "Projectile", blurb: "A ball launched at 10 m/s and 45° from flat ground." },
  { key: "spring", name: "Spring", blurb: "A 1 kg mass on a 20 N/m spring, period 1.405 s." },
];
 
