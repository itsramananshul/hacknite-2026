import { z } from "zod";

const number = z.number().finite();
const vector = z.strictObject({ x: number, y: number });
const id = z.string().min(1).max(80);

// Body positions are centres in metres, except ramp x/y, which mark its lower left corner.
// Ramp angleDeg is its slope angle. Height must equal width * tan(angleDeg).
export const bodySchema = z.strictObject({
  id,
  kind: z.enum(["block", "ball", "ramp", "ground", "wall", "platform"]),
  x: number, y: number,
  width: number.nonnegative(), height: number.nonnegative(), radius: number.nonnegative(),
  angleDeg: number,
  mass: number.positive(),
  isStatic: z.boolean(),
  friction: number.nonnegative(), restitution: number.nonnegative(),
  initialVelocity: vector,
  label: z.string().max(200),
});

// Spring stiffness is a physical k in N/m, implemented with Hooke's law.
// Rope and pin stiffness are dimensionless Matter.js constraint settings.
export const constraintSchema = z.strictObject({
  id, kind: z.enum(["spring", "rope", "pin"]),
  bodyA: id, bodyB: id.nullable(), anchor: vector,
  stiffness: number.positive(), restLength: number.nonnegative(),
});

const sceneStructure = z.strictObject({
  problemType: z.enum(["incline", "projectile", "freefall", "spring", "unknown"]),
  units: z.strictObject({ length: z.literal("m"), mass: z.literal("kg"), angle: z.literal("deg") }),
  world: z.strictObject({
    gravity: number.positive(), pixelsPerMeter: number.positive(),
    width: number.positive(), height: number.positive(),
  }),
  bodies: z.array(bodySchema).min(1).max(20),
  constraints: z.array(constraintSchema).max(20),
  labeledValues: z.array(z.strictObject({
    symbol: z.string().max(40), value: number, unit: z.string().max(40), appliesTo: id,
    field: z.enum(["mass", "angleDeg", "friction", "speed", "launchAngleDeg", "height", "stiffness"]),
  })).max(40),
  question: z.strictObject({
    text: z.string().max(1000),
    target: z.enum(["distance", "time", "maxHeight", "range", "finalSpeed", "period", "none"]),
    bodyId: id, timeWindow: number.nonnegative(),
  }),
  confidence: number.min(0).max(1), notes: z.string().max(2000),
});

export type Scene = z.infer<typeof sceneStructure>;
export type SceneBody = Scene["bodies"][number];

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
});

// Structural JSON Schema for Gemini. Referential checks are enforced by sceneSchema.
export const geminiResponseSchema = z.toJSONSchema(sceneStructure, { target: "draft-7" });
export const geminiOutputConfig = { responseMimeType: "application/json", responseJsonSchema: geminiResponseSchema };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function validateScene(input: unknown): Scene {
  const scene = sceneSchema.parse(input);
  scene.world.gravity = clamp(scene.world.gravity, 0.1, 30);
  scene.world.pixelsPerMeter = clamp(scene.world.pixelsPerMeter, 10, 100);
  scene.world.width = clamp(scene.world.width, 2, 100);
  scene.world.height = clamp(scene.world.height, 2, 100);
  scene.question.timeWindow = clamp(scene.question.timeWindow, 0, 30);
  for (const body of scene.bodies) {
    body.x = clamp(body.x, -100, 100); body.y = clamp(body.y, -100, 100);
    body.width = clamp(body.width, 0.05, 100); body.height = clamp(body.height, 0.05, 100);
    body.radius = clamp(body.radius, 0.02, 10); body.mass = clamp(body.mass, 0.01, 1000);
    body.friction = clamp(body.friction, 0, 1); body.restitution = clamp(body.restitution, 0, 1);
    body.angleDeg = clamp(body.angleDeg, -360, 360);
    body.initialVelocity.x = clamp(body.initialVelocity.x, -100, 100);
    body.initialVelocity.y = clamp(body.initialVelocity.y, -100, 100);
    if (body.kind === "ramp") body.height = body.width * Math.tan(body.angleDeg * Math.PI / 180);
  }
  for (const constraint of scene.constraints) {
    constraint.stiffness = clamp(constraint.stiffness, 0.001, constraint.kind === "spring" ? 1000 : 1);
    constraint.restLength = clamp(constraint.restLength, 0, 100);
    constraint.anchor.x = clamp(constraint.anchor.x, -100, 100);
    constraint.anchor.y = clamp(constraint.anchor.y, -100, 100);
  }
  return sceneSchema.parse(scene);
}
