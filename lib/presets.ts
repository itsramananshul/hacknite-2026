import { validateScene, type Scene, type SceneBody } from "./schema";

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

const theta = Math.PI / 6;
const rampX = 1, rampY = 1, along = 10;
export const inclinePreset = validateScene({
  ...base, problemType: "incline",
  bodies: [
    body({ id: "ramp", kind: "ramp", x: rampX, y: rampY, width: 10, height: 10 * Math.tan(theta), angleDeg: 30, isStatic: true, label: "30° ramp" }),
    body({ id: "box", kind: "block", x: rampX + along * Math.cos(theta) - 0.35 * Math.sin(theta), y: rampY + along * Math.sin(theta) + 0.35 * Math.cos(theta), angleDeg: 30, mass: 5, friction: 0.2, label: "5 kg" }),
  ],
  labeledValues: [
    { symbol: "m", value: 5, unit: "kg", appliesTo: "box", field: "mass" },
    { symbol: "θ", value: 30, unit: "deg", appliesTo: "ramp", field: "angleDeg" },
    { symbol: "μ", value: 0.2, unit: "", appliesTo: "box", field: "friction" },
  ],
  question: { text: "How far does the box slide in 2 seconds?", target: "distance", bodyId: "box", timeWindow: 2 },
  notes: "Verified answer: 6.411716 m. Starts from rest. Static friction is assumed equal to kinetic friction.",
});

export const projectilePreset = validateScene({
  ...base, problemType: "projectile",
  bodies: [
    body({ id: "ground", kind: "ground", x: 10, y: 0.25, width: 20, height: 0.5, isStatic: true, label: "Ground" }),
    body({ id: "ball", kind: "ball", x: 1.5, y: 0.75, initialVelocity: { x: 10 / Math.sqrt(2), y: 10 / Math.sqrt(2) }, label: "10 m/s" }),
  ],
  labeledValues: [
    { symbol: "v₀", value: 10, unit: "m/s", appliesTo: "ball", field: "speed" },
    { symbol: "θ", value: 45, unit: "deg", appliesTo: "ball", field: "launchAngleDeg" },
  ],
  question: { text: "How far does a ball launched at 10 m/s and 45° travel?", target: "range", bodyId: "ball", timeWindow: 3 },
  notes: "Verified range: 10.193680 m; flight time: 1.441604 s; peak height: 2.548420 m above ground.",
});

export const springPreset = validateScene({
  ...base, problemType: "spring",
  bodies: [body({ id: "mass", kind: "ball", x: 10, y: 5, mass: 1, label: "1 kg" })],
  constraints: [{ id: "spring", kind: "spring", bodyA: "mass", bodyB: null, anchor: { x: 10, y: 9 }, stiffness: 20, restLength: 3 }],
  labeledValues: [{ symbol: "k", value: 20, unit: "N/m", appliesTo: "mass", field: "stiffness" }],
  question: { text: "A 1 kg mass hangs from a 20 N/m spring.", target: "period", bodyId: "mass", timeWindow: 8 },
  notes: "Physical Hooke spring. Verified small vertical oscillation period: 1.404963 s. Equilibrium length: 3.4905 m. The spring answer panel is a later milestone.",
});

export const presets = { incline: inclinePreset, projectile: projectilePreset, spring: springPreset };
