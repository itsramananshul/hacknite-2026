import { z } from "zod";
import {
  bodySupport,
  clamp,
  rampAlongDistance,
  rampFrame,
  rampSurfaceOffset,
  rampSurfacePoint,
  toDegrees,
  toRadians,
} from "./geometry";

// Zod 4 rejects NaN and Infinity for z.number() on its own, and every field
// below also carries an explicit bound. The bounds are a wide safety envelope;
// validateScene narrows them further to the range the engine can simulate.
const number = z.number();
const bounded = (low: number, high: number) => z.number().min(low).max(high);
const unitInterval = z.number().min(0).max(1);
const vector = z.strictObject({ x: number, y: number });
const id = z.string().min(1).max(80);

// Normalised crop rectangle in 0..1 of the source picture, kept so a later
// milestone can cut sprites without touching the physics.
const boundingBoxSchema = z.strictObject({
  x: unitInterval, y: unitInterval, width: unitInterval, height: unitInterval,
});

// A constant force in newtons on one body. Variable forces are not supported.
const appliedForceSchema = z.strictObject({
  bodyId: id, x: bounded(-1e4, 1e4), y: bounded(-1e4, 1e4),
});

// Body positions are centres in metres, except ramp x/y, which mark its lower left corner.
// Ramp angleDeg is its slope angle. Height must equal width * tan(angleDeg).
export const bodySchema = z.strictObject({
  id,
  kind: z.enum(["block", "ball", "ramp", "ground", "wall", "platform"]),
  x: bounded(-1e4, 1e4), y: bounded(-1e4, 1e4),
  width: z.number().nonnegative().max(1e4), height: z.number().nonnegative().max(1e4), radius: z.number().nonnegative().max(1e4),
  angleDeg: bounded(-3600, 3600),
  mass: z.number().positive().max(1e6),
  isStatic: z.boolean(),
  friction: z.number().nonnegative().max(1e3), restitution: z.number().nonnegative().max(1e3),
  initialVelocity: vector,
  label: z.string().max(200),
  boundingBox: boundingBoxSchema.optional(),
});

// Spring stiffness is a physical k in N/m, implemented with Hooke's law. Rope and
// pin stiffness stay in the schema so a scene that uses them is rejected with a
// clear message by the engine instead of failing validation.
export const constraintSchema = z.strictObject({
  id, kind: z.enum(["spring", "rope", "pin"]),
  bodyA: id, bodyB: id.nullable(), anchor: vector,
  stiffness: z.number().positive().max(1e6), restLength: z.number().nonnegative().max(1e4),
});

const sceneStructure = z.strictObject({
  problemType: z.enum(["incline", "projectile", "freefall", "spring", "unknown"]),
  units: z.strictObject({ length: z.literal("m"), mass: z.literal("kg"), angle: z.literal("deg") }),
  world: z.strictObject({
    gravity: z.number().positive().max(1e3), pixelsPerMeter: z.number().positive().max(1e4),
    width: z.number().positive().max(1e4), height: z.number().positive().max(1e4),
  }),
  bodies: z.array(bodySchema).min(1).max(20),
  constraints: z.array(constraintSchema).max(20),
  appliedForces: z.array(appliedForceSchema).max(20).optional(),
  labeledValues: z.array(z.strictObject({
    symbol: z.string().max(40), value: number, unit: z.string().max(40), appliesTo: id,
    field: z.enum(["mass", "angleDeg", "friction", "speed", "launchAngleDeg", "height", "stiffness"]),
  })).max(40),
  question: z.strictObject({
    text: z.string().max(1000),
    target: z.enum(["distance", "time", "maxHeight", "range", "finalSpeed", "period", "none"]),
    bodyId: id, timeWindow: z.number().nonnegative().max(1e4),
  }),
  confidence: z.number().min(0).max(1), notes: z.string().max(2000),
});

export type Scene = z.infer<typeof sceneStructure>;
export type SceneBody = Scene["bodies"][number];
export type SceneConstraint = Scene["constraints"][number];
export type LabelField = Scene["labeledValues"][number]["field"];

export const sceneSchema = sceneStructure.superRefine((scene, context) => {
  const ids = new Set<string>();
  scene.bodies.forEach((body, index) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message, path: ["bodies", index] });
    if (ids.has(body.id)) issue("Body IDs must be unique.");
    ids.add(body.id);
    if (body.kind === "ball" && body.radius <= 0) issue("A ball needs a positive radius.");
    if (body.kind !== "ball" && (body.width <= 0 || body.height <= 0)) issue("A solid needs positive width and height.");
    if (body.kind === "ramp") {
      if (!body.isStatic || body.angleDeg <= 0 || body.angleDeg >= 85) issue("A ramp must be static with slope between 0 and 85 degrees.");
      const expected = body.width * Math.tan(body.angleDeg * Math.PI / 180);
      if (Math.abs(body.height - expected) > 0.01 * Math.max(1, expected)) issue("Ramp height must match its width and slope angle.");
    }
  });
  if (!ids.has(scene.question.bodyId)) context.addIssue({ code: "custom", message: "Question body does not exist.", path: ["question", "bodyId"] });
  const constraintIds = new Set<string>();
  scene.constraints.forEach((constraint, index) => {
    if (constraintIds.has(constraint.id) || !ids.has(constraint.bodyA) || (constraint.bodyB !== null && (!ids.has(constraint.bodyB) || constraint.bodyA === constraint.bodyB))) {
      context.addIssue({ code: "custom", message: "Constraint needs a unique ID and valid distinct bodies.", path: ["constraints", index] });
    }
    constraintIds.add(constraint.id);
  });
  scene.labeledValues.forEach((value, index) => {
    if (!ids.has(value.appliesTo)) context.addIssue({ code: "custom", message: "Label body does not exist.", path: ["labeledValues", index, "appliesTo"] });
  });
  (scene.appliedForces ?? []).forEach((force, index) => {
    const body = scene.bodies.find((item) => item.id === force.bodyId);
    const path: (string | number)[] = ["appliedForces", index];
    if (!body) context.addIssue({ code: "custom", message: "Applied force body does not exist.", path: [...path, "bodyId"] });
    else if (body.isStatic) context.addIssue({ code: "custom", message: "An applied force cannot act on a static body.", path });
  });
});

// Structural JSON Schema for Gemini. Referential checks are enforced by sceneSchema.
export const geminiResponseSchema = z.toJSONSchema(sceneStructure, { target: "draft-7" });
export type GeminiResponseSchema = typeof geminiResponseSchema;
export const geminiOutputConfig = { responseMimeType: "application/json", responseJsonSchema: geminiResponseSchema };

const clampNumber = (value: number, low: number, high: number): number => clamp(value, low, high);

function narrowScene(scene: Scene): Scene {
  scene.world.gravity = clampNumber(scene.world.gravity, 0.1, 30);
  scene.world.pixelsPerMeter = clampNumber(scene.world.pixelsPerMeter, 10, 100);
  scene.world.width = clampNumber(scene.world.width, 2, 100);
  scene.world.height = clampNumber(scene.world.height, 2, 100);
  scene.question.timeWindow = clampNumber(scene.question.timeWindow, 0, 30);
  for (const body of scene.bodies) {
    body.x = clampNumber(body.x, -100, 100); body.y = clampNumber(body.y, -100, 100);
    body.width = clampNumber(body.width, 0.05, 100); body.height = clampNumber(body.height, 0.05, 100);
    body.radius = clampNumber(body.radius, 0.02, 10); body.mass = clampNumber(body.mass, 0.01, 1000);
    body.friction = clampNumber(body.friction, 0, 1); body.restitution = clampNumber(body.restitution, 0, 1);
    body.angleDeg = clampNumber(body.angleDeg, -360, 360);
    body.initialVelocity.x = clampNumber(body.initialVelocity.x, -100, 100);
    body.initialVelocity.y = clampNumber(body.initialVelocity.y, -100, 100);
    if (body.kind === "ramp") body.height = body.width * Math.tan(body.angleDeg * Math.PI / 180);
    if (body.boundingBox) {
      body.boundingBox.x = clampNumber(body.boundingBox.x, 0, 1);
      body.boundingBox.y = clampNumber(body.boundingBox.y, 0, 1);
      body.boundingBox.width = clampNumber(body.boundingBox.width, 0, 1);
      body.boundingBox.height = clampNumber(body.boundingBox.height, 0, 1);
    }
  }
  for (const force of scene.appliedForces ?? []) {
    force.x = clampNumber(force.x, -1000, 1000);
    force.y = clampNumber(force.y, -1000, 1000);
  }
  for (const constraint of scene.constraints) {
    constraint.stiffness = clampNumber(constraint.stiffness, 0.001, constraint.kind === "spring" ? 1000 : 1);
    constraint.restLength = clampNumber(constraint.restLength, 0, 100);
    constraint.anchor.x = clampNumber(constraint.anchor.x, -100, 100);
    constraint.anchor.y = clampNumber(constraint.anchor.y, -100, 100);
  }
  return scene;
}

// Full runtime validation. Zod returns a fresh deep copy, so callers may mutate
// the result. Narrowing happens first and the scene is parsed again afterwards,
// which is what enforces the custom refinements against the clamped numbers.
export function validateScene(input: unknown): Scene {
  const scene = sceneSchema.parse(input);
  return sceneSchema.parse(narrowScene(scene));
}

export function describeSceneError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "scene"}: ${issue.message}`)
      .join("; ");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

const LABEL_UNITS: Record<LabelField, { canonical: string; factors: Record<string, number> }> = {
  mass: { canonical: "kg", factors: { kg: 1, g: 0.001, t: 1000, tonne: 1000 } },
  angleDeg: { canonical: "deg", factors: { deg: 1, degree: 1, degrees: 1, rad: 180 / Math.PI } },
  friction: { canonical: "", factors: { "": 1, "1": 1, "-": 1, none: 1 } },
  speed: { canonical: "m/s", factors: { "m/s": 1, "km/h": 1 / 3.6, "cm/s": 0.01 } },
  launchAngleDeg: { canonical: "deg", factors: { deg: 1, degree: 1, degrees: 1, rad: 180 / Math.PI } },
  height: { canonical: "m", factors: { m: 1, cm: 0.01, mm: 0.001, km: 1000 } },
  stiffness: { canonical: "N/m", factors: { "n/m": 1, "n/cm": 100, "kn/m": 1000 } },
};

export interface LabelApplication {
  symbol: string;
  field: LabelField;
  appliesTo: string;
  unit: string;
  declared: number;
  effective: number;
  display: string;
}

export interface ResolvedScene {
  scene: Scene;
  labels: LabelApplication[];
}

type LabelUnit = (typeof LABEL_UNITS)[LabelField];

function convertUnit(field: LabelField, rawUnit: string): { value: number; unit: LabelUnit } {
  const spec = LABEL_UNITS[field];
  const key = rawUnit.trim().toLowerCase();
  const factor = spec.factors[key];
  if (factor === undefined) {
    const supported = Object.keys(spec.factors).map((unit) => unit || "(none)").join(", ");
    throw new Error(`Label unit "${rawUnit}" cannot be read for ${field}. Supported units: ${supported}.`);
  }
  return { value: factor, unit: spec };
}

function requireBody(scene: Scene, bodyId: string, symbol: string): SceneBody {
  const body = scene.bodies.find((item) => item.id === bodyId);
  if (!body) throw new Error(`Label ${symbol} points at unknown body "${bodyId}".`);
  return body;
}

// A body counts as resting on the ramp when it is aligned with the slope and its
// centre sits one support distance off the surface.
function isRestingOnRamp(body: SceneBody, ramp: SceneBody): boolean {
  const frame = rampFrame(ramp);
  const aligned = Math.abs(((body.angleDeg - frame.angleDeg + 540) % 360) - 180) < 0.5;
  if (!aligned) return false;
  return Math.abs(rampSurfaceOffset(ramp, body) - bodySupport(body)) <= Math.max(0.02, bodySupport(body) * 0.05);
}

function applyRampAngle(scene: Scene, ramp: SceneBody, angleDeg: number): void {
  const attached = scene.bodies.filter((body) => !body.isStatic && body.kind !== "ramp" && isRestingOnRamp(body, ramp));
  const alongById = new Map(attached.map((body) => [body.id, rampAlongDistance(ramp, body)]));
  ramp.angleDeg = angleDeg;
  ramp.height = ramp.width * Math.tan(toRadians(angleDeg));
  const frame = rampFrame(ramp);
  for (const body of attached) {
    const along = alongById.get(body.id) ?? 0;
    const surface = rampSurfacePoint(ramp, along);
    body.angleDeg = frame.angleDeg;
    body.x = surface.x + frame.outward.x * bodySupport(body);
    body.y = surface.y + frame.outward.y * bodySupport(body);
  }
}

function applyLabels(scene: Scene): void {
  type Bucket = { declared: number; converted: number; unit: LabelUnit; symbol: string; unitText: string };
  const buckets = new Map<string, Bucket>();
  const keyOf = (bodyId: string, field: LabelField) => `${bodyId}::${field}`;

  for (const label of scene.labeledValues) {
    requireBody(scene, label.appliesTo, label.symbol);
    const { value: factor, unit } = convertUnit(label.field, label.unit);
    const converted = label.value * factor;
    const key = keyOf(label.appliesTo, label.field);
    const existing = buckets.get(key);
    if (existing) {
      if (Math.abs(existing.converted - converted) > 1e-9) {
        throw new Error(`Labels ${existing.symbol} and ${label.symbol} disagree about ${label.field} for "${label.appliesTo}".`);
      }
      continue;
    }
    buckets.set(key, { declared: label.value, converted, unit, symbol: label.symbol, unitText: label.unit });
  }

  const value = (bodyId: string, field: LabelField) => buckets.get(keyOf(bodyId, field));

  for (const body of scene.bodies) {
    const mass = value(body.id, "mass");
    if (mass) {
      if (body.isStatic) throw new Error(`Label ${mass.symbol} cannot set a mass on the static body "${body.id}".`);
      if (mass.converted <= 0) throw new Error(`Label ${mass.symbol} must be a positive mass.`);
      body.mass = mass.converted;
    }
    const friction = value(body.id, "friction");
    if (friction) {
      if (friction.converted < 0) throw new Error(`Label ${friction.symbol} must be a non-negative friction coefficient.`);
      body.friction = friction.converted;
    }
    const height = value(body.id, "height");
    if (height) {
      if (body.isStatic) throw new Error(`Label ${height.symbol} cannot set a height on the static body "${body.id}".`);
      if (height.converted < 0) throw new Error(`Label ${height.symbol} must be a non-negative height.`);
      const ground = scene.bodies.find((item) => item.kind === "ground");
      const floor = ground ? ground.y + ground.height / 2 : 0;
      body.y = floor + height.converted + bodySupport(body);
    }
  }

  for (const [key, bucket] of buckets) {
    const [bodyId, field] = key.split("::") as [string, LabelField];
    if (field !== "angleDeg") continue;
    const body = requireBody(scene, bodyId, bucket.symbol);
    if (body.kind === "ball" || body.kind === "ground") {
      throw new Error(`Label ${bucket.symbol} cannot set an angle on a ${body.kind}.`);
    }
    if (body.kind === "ramp") {
      if (body.angleDeg <= 0 || body.angleDeg >= 85) {
        throw new Error(`Label ${bucket.symbol} must give a ramp slope between 0 and 85 degrees.`);
      }
      applyRampAngle(scene, body, bucket.converted);
    } else {
      body.angleDeg = bucket.converted;
    }
  }

  for (const constraint of scene.constraints) {
    const stiffness = value(constraint.bodyA, "stiffness") ?? (constraint.bodyB ? value(constraint.bodyB, "stiffness") : undefined);
    if (!stiffness) continue;
    if (constraint.kind !== "spring") {
      throw new Error(`Label ${stiffness.symbol} gives a physical stiffness in N/m but constraint "${constraint.id}" is a ${constraint.kind}, which the analytical core does not support.`);
    }
    if (stiffness.converted <= 0) throw new Error(`Label ${stiffness.symbol} must be a positive stiffness.`);
    constraint.stiffness = stiffness.converted;
  }
  for (const body of scene.bodies) {
    const stiffness = value(body.id, "stiffness");
    if (!stiffness) continue;
    const springs = scene.constraints.filter(
      (constraint) => constraint.kind === "spring" && (constraint.bodyA === body.id || constraint.bodyB === body.id),
    );
    if (springs.length === 0) throw new Error(`Label ${stiffness.symbol} needs a spring constraint attached to "${body.id}".`);
    if (springs.length > 1) throw new Error(`Label ${stiffness.symbol} is ambiguous: "${body.id}" has ${springs.length} spring constraints.`);
  }

  for (const body of scene.bodies) {
    const speed = value(body.id, "speed");
    const angle = value(body.id, "launchAngleDeg");
    if (!speed && !angle) continue;
    const symbol = (speed ?? angle)!.symbol;
    if (body.isStatic) throw new Error(`Label ${symbol} cannot set a launch velocity on the static body "${body.id}".`);
    const current = Math.hypot(body.initialVelocity.x, body.initialVelocity.y);
    let magnitude: number;
    let direction: number;
    if (speed && angle) {
      magnitude = speed.converted;
      direction = toRadians(angle.converted);
    } else if (speed) {
      if (current <= 1e-9) {
        throw new Error(`Label ${speed.symbol} gives a speed but "${body.id}" is at rest, so the direction is ambiguous. Add a launch angle label.`);
      }
      magnitude = speed.converted;
      direction = Math.atan2(body.initialVelocity.y, body.initialVelocity.x);
    } else {
      if (current <= 1e-9) {
        throw new Error(`Label ${symbol} gives a launch angle but "${body.id}" has no initial speed.`);
      }
      magnitude = current;
      direction = toRadians(angle!.converted);
    }
    if (magnitude < 0) throw new Error(`Label ${symbol} cannot give a negative launch speed.`);
    body.initialVelocity.x = magnitude * Math.cos(direction);
    body.initialVelocity.y = magnitude * Math.sin(direction);
  }
}

// Reads the effective values back out of a validated scene so the displayed
// labels can never disagree with what the engine and the solvers use.
function describeLabels(scene: Scene): LabelApplication[] {
  return scene.labeledValues.map((label) => {
    const body = requireBody(scene, label.appliesTo, label.symbol);
    const spec = LABEL_UNITS[label.field];
    let effective = label.value;
    if (label.field === "mass") effective = body.mass;
    else if (label.field === "friction") effective = body.friction;
    else if (label.field === "angleDeg") effective = body.angleDeg;
    else if (label.field === "height") {
      const ground = scene.bodies.find((item) => item.kind === "ground");
      const floor = ground ? ground.y + ground.height / 2 : 0;
      effective = body.y - floor - bodySupport(body);
    } else if (label.field === "stiffness") {
      effective = scene.constraints.find(
        (constraint) => constraint.kind === "spring" && (constraint.bodyA === body.id || constraint.bodyB === body.id),
      )?.stiffness ?? label.value;
    } else if (label.field === "speed") {
      effective = Math.hypot(body.initialVelocity.x, body.initialVelocity.y);
    } else {
      // The launch angle is read back from the velocity vector in degrees, so a
      // label of 45 degrees displays 45 and never the launch speed.
      effective = (toDegrees(Math.atan2(body.initialVelocity.y, body.initialVelocity.x)) + 360) % 360;
    }
    const digits = spec.canonical === "deg" ? 2 : 3;
    return {
      symbol: label.symbol,
      field: label.field,
      appliesTo: label.appliesTo,
      unit: spec.canonical,
      declared: label.value,
      effective,
      display: `${effective.toFixed(digits)}${spec.canonical ? ` ${spec.canonical}` : ""}`,
    };
  });
}

// Validates a scene, then lets the labeled values override the visual estimates.
// Overrides are applied in a fixed field order from per body buckets, so the
// result does not depend on the order the labels happen to be listed in.
export function resolveScene(input: unknown): ResolvedScene {
  const scene = validateScene(input);
  applyLabels(scene);
  const resolved = validateScene(scene);
  return { scene: resolved, labels: describeLabels(resolved) };
}
