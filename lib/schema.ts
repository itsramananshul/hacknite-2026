import { z } from "zod";

export const SCENE_LIMITS = {
  durationMin: 0.05,
  durationMax: 120,
  maxVariables: 20,
  maxObjects: 40,
  maxConnectors: 30,
  maxVectors: 30,
  maxSteps: 30,
  maxAnswers: 20,
  maxExpressionLength: 500,
  maxTitleLength: 120,
  maxProblemTextLength: 4000,
  maxShortTextLength: 80,
  maxNarrationLength: 2000,
  maxQuestionLength: 200,
  maxUnitLength: 24,
  maxColorLength: 32,
  maxLabelLength: 40,
  maxEquationLength: 400,
  maxEquationsPerStep: 8,
  maxFocusPerStep: 12,
  maxShowVectorsPerStep: 12,
  maxMagnitude: 1e15,
  maxCoordinate: 1e6,
  minStep: 1e-9,
} as const;

export const RESERVED_IDENTIFIERS: readonly string[] = [
  "t",
  "pi",
  "e",
  "i",
  "sin",
  "cos",
  "tan",
  "sqrt",
  "abs",
  "min",
  "max",
  "exp",
  "log",
  "log10",
];

export const SHAPES = [
  "resistor",
  "capacitor",
  "inductor",
  "box",
  "sphere",
  "cylinder",
  "cone",
  "ramp",
  "plane",
  "pulley",
  "planet",
  "car",
  "pendulumBob",
] as const;

export const VECTOR_KINDS = ["force", "velocity", "acceleration", "momentum"] as const;

export const CONNECTOR_KINDS = ["spring", "rope", "rod"] as const;

const identifierPattern = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const objectIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const colorPattern = new RegExp(
  `^(#[0-9a-fA-F]{3,8}|[A-Za-z][A-Za-z0-9 ,()%.\\-]{0,${SCENE_LIMITS.maxColorLength - 1}})$`,
);
const pointPattern =
  /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?,-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?,-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

const boundedNumber = (max: number) =>
  z
    .number()
    .finite()
    .refine((value) => Math.abs(value) <= max, {
      message: `value must be between ${-max} and ${max}`,
    });

const sizeNumber = z
  .number()
  .finite()
  .min(0)
  .max(SCENE_LIMITS.maxCoordinate);

const shortText = (max: number) =>
  z
    .string()
    .refine((value) => value.length <= max, {
      message: `text must be at most ${max} characters`,
    });

export const expressionSchema = z
  .union([z.string(), z.number().finite()])
  .transform((value) => (typeof value === "number" ? String(value) : value.trim()))
  .refine((value) => value.length > 0, { message: "expression must not be empty" })
  .refine((value) => value.length <= SCENE_LIMITS.maxExpressionLength, {
    message: `expression must be at most ${SCENE_LIMITS.maxExpressionLength} characters`,
  });

export const expressionPointSchema = z.object({
  x: expressionSchema,
  y: expressionSchema,
  z: expressionSchema,
});

export const sizeSchema = z.object({
  x: sizeNumber,
  y: sizeNumber,
  z: sizeNumber,
  radius: sizeNumber,
});

export const cameraSchema = z.object({
  position: z.tuple([boundedNumber(SCENE_LIMITS.maxCoordinate), boundedNumber(SCENE_LIMITS.maxCoordinate), boundedNumber(SCENE_LIMITS.maxCoordinate)]),
  target: z.tuple([boundedNumber(SCENE_LIMITS.maxCoordinate), boundedNumber(SCENE_LIMITS.maxCoordinate), boundedNumber(SCENE_LIMITS.maxCoordinate)]),
});

export const variableSchema = z.object({
  name: z
    .string()
    .regex(identifierPattern, "variable name must start with a letter and use letters, digits or underscore"),
  value: z.number().finite().refine((v) => Math.abs(v) <= SCENE_LIMITS.maxMagnitude, {
    message: `value must be between ${-SCENE_LIMITS.maxMagnitude} and ${SCENE_LIMITS.maxMagnitude}`,
  }),
  unit: shortText(SCENE_LIMITS.maxUnitLength),
  label: shortText(SCENE_LIMITS.maxLabelLength),
  adjustable: z.boolean(),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
});

export const worldSchema = z.object({
  gravity: expressionSchema,
  showGrid: z.boolean(),
  groundY: boundedNumber(SCENE_LIMITS.maxCoordinate),
  scale: z.number().finite().positive().max(SCENE_LIMITS.maxMagnitude),
});

export const objectSchema = z.object({
  id: z
    .string()
    .regex(objectIdPattern, "object id must start with a letter and use letters, digits, dash or underscore"),
  shape: z.enum(SHAPES),
  size: sizeSchema,
  color: shortText(SCENE_LIMITS.maxColorLength).regex(colorPattern, "color must be a hex code or a plain color name"),
  label: shortText(SCENE_LIMITS.maxLabelLength),
  position: expressionPointSchema,
  rotation: expressionPointSchema,
  trail: z.boolean(),
  visible: expressionSchema,
});

export const connectorSchema = z.object({
  id: z
    .string()
    .regex(objectIdPattern, "connector id must start with a letter and use letters, digits, dash or underscore"),
  kind: z.enum(CONNECTOR_KINDS),
  from: shortText(SCENE_LIMITS.maxShortTextLength * 4).refine(
    (value) => objectIdPattern.test(value) || pointPattern.test(value),
    "connector endpoint must be an object id or a literal point written as x,y,z",
  ),
  to: shortText(SCENE_LIMITS.maxShortTextLength * 4).refine(
    (value) => objectIdPattern.test(value) || pointPattern.test(value),
    "connector endpoint must be an object id or a literal point written as x,y,z",
  ),
});

export const vectorSchema = z.object({
  id: z
    .string()
    .regex(objectIdPattern, "vector id must start with a letter and use letters, digits, dash or underscore"),
  attachTo: z
    .string()
    .regex(objectIdPattern, "attachTo must be an object id"),
  kind: z.enum(VECTOR_KINDS),
  components: expressionPointSchema,
  label: shortText(SCENE_LIMITS.maxLabelLength),
  color: shortText(SCENE_LIMITS.maxColorLength).regex(colorPattern, "color must be a hex code or a plain color name"),
  visible: expressionSchema,
});

export const stepSchema = z.object({
  title: shortText(SCENE_LIMITS.maxTitleLength),
  narration: shortText(SCENE_LIMITS.maxNarrationLength),
  equations: z.array(shortText(SCENE_LIMITS.maxEquationLength)).max(SCENE_LIMITS.maxEquationsPerStep),
  tStart: z.number().finite().min(0).max(SCENE_LIMITS.durationMax),
  tEnd: z.number().finite().min(0).max(SCENE_LIMITS.durationMax),
  focus: z.array(z.string().regex(objectIdPattern, "focus entries must be object ids")).max(SCENE_LIMITS.maxFocusPerStep),
  camera: cameraSchema.optional(),
  showVectors: z
    .array(z.string().regex(objectIdPattern, "showVectors entries must be vector ids"))
    .max(SCENE_LIMITS.maxShowVectorsPerStep),
});

export const answerSchema = z.object({
  question: shortText(SCENE_LIMITS.maxQuestionLength).refine((value) => value.trim().length > 0, {
    message: "answer question must not be empty",
  }),
  expression: expressionSchema,
  value: z.number().finite().refine((v) => Math.abs(v) <= SCENE_LIMITS.maxMagnitude, {
    message: `answer value must be between ${-SCENE_LIMITS.maxMagnitude} and ${SCENE_LIMITS.maxMagnitude}`,
  }),
  unit: shortText(SCENE_LIMITS.maxUnitLength).refine((value) => value.trim().length > 0, {
    message: "answer unit must not be empty",
  }),
});

export const sceneScriptSchema = z
  .object({
    title: shortText(SCENE_LIMITS.maxTitleLength).refine((value) => value.trim().length > 0, {
      message: "title must not be empty",
    }),
    problemText: shortText(SCENE_LIMITS.maxProblemTextLength),
    variables: z.array(variableSchema).max(SCENE_LIMITS.maxVariables),
    duration: z
      .number()
      .finite()
      .min(SCENE_LIMITS.durationMin)
      .max(SCENE_LIMITS.durationMax),
    loop: z.boolean(),
    world: worldSchema,
    camera: cameraSchema,
    objects: z.array(objectSchema).min(1).max(SCENE_LIMITS.maxObjects),
    connectors: z.array(connectorSchema).max(SCENE_LIMITS.maxConnectors),
    vectors: z.array(vectorSchema).max(SCENE_LIMITS.maxVectors),
    steps: z.array(stepSchema).max(SCENE_LIMITS.maxSteps),
    answers: z.array(answerSchema).max(SCENE_LIMITS.maxAnswers),
  })
  .superRefine((scene, ctx) => {
    const objectIds = new Set<string>();
    scene.objects.forEach((object, index) => {
      if (objectIds.has(object.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate object id "${object.id}"`, path: ["objects", index, "id"] });
      }
      objectIds.add(object.id);
    });

    const vectorIds = new Set<string>();
    scene.vectors.forEach((vector, index) => {
      if (vectorIds.has(vector.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate vector id "${vector.id}"`, path: ["vectors", index, "id"] });
      }
      vectorIds.add(vector.id);
    });

    const connectorIds = new Set<string>();
    scene.connectors.forEach((connector, index) => {
      if (connectorIds.has(connector.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate connector id "${connector.id}"`,
          path: ["connectors", index, "id"],
        });
      }
      connectorIds.add(connector.id);
      (["from", "to"] as const).forEach((end) => {
        const value = connector[end];
        if (!objectIds.has(value) && !pointPattern.test(value)) {
          ctx.addIssue({
            code: "custom",
            message: `connector "${connector.id}" ${end} "${value}" is neither a known object id nor a literal x,y,z point`,
            path: ["connectors", index, end],
          });
        }
      });
    });

    const variableNames = new Set<string>();
    scene.variables.forEach((variable, index) => {
      if (RESERVED_IDENTIFIERS.includes(variable.name)) {
        ctx.addIssue({
          code: "custom",
          message: `variable name "${variable.name}" is reserved by the expression language`,
          path: ["variables", index, "name"],
        });
      }
      if (variableNames.has(variable.name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate variable name "${variable.name}"`,
          path: ["variables", index, "name"],
        });
      }
      variableNames.add(variable.name);
      if (variable.min > variable.max) {
        ctx.addIssue({
          code: "custom",
          message: `variable "${variable.name}" has min greater than max`,
          path: ["variables", index, "min"],
        });
      }
      if (variable.value < variable.min || variable.value > variable.max) {
        ctx.addIssue({
          code: "custom",
          message: `variable "${variable.name}" value ${variable.value} is outside [${variable.min}, ${variable.max}]`,
          path: ["variables", index, "value"],
        });
      }
      if (variable.adjustable && variable.min === variable.max) {
        ctx.addIssue({
          code: "custom",
          message: `adjustable variable "${variable.name}" needs min below max`,
          path: ["variables", index, "min"],
        });
      }
    });

    scene.vectors.forEach((vector, index) => {
      if (!objectIds.has(vector.attachTo)) {
        ctx.addIssue({
          code: "custom",
          message: `vector "${vector.id}" attaches to unknown object "${vector.attachTo}"`,
          path: ["vectors", index, "attachTo"],
        });
      }
    });

    scene.steps.forEach((step, index) => {
      if (step.tStart > step.tEnd) {
        ctx.addIssue({
          code: "custom",
          message: `step "${step.title}" starts after it ends`,
          path: ["steps", index, "tStart"],
        });
      }
      if (step.tEnd > scene.duration) {
        ctx.addIssue({
          code: "custom",
          message: `step "${step.title}" ends at ${step.tEnd} which is past the duration ${scene.duration}`,
          path: ["steps", index, "tEnd"],
        });
      }
      step.focus.forEach((id, focusIndex) => {
        if (!objectIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `step "${step.title}" focuses unknown object "${id}"`,
            path: ["steps", index, "focus", focusIndex],
          });
        }
      });
      step.showVectors.forEach((id, vectorIndex) => {
        if (!vectorIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `step "${step.title}" shows unknown vector "${id}"`,
            path: ["steps", index, "showVectors", vectorIndex],
          });
        }
      });
    });
  });

export const sceneSchema = sceneScriptSchema;

export type SceneExpression = z.infer<typeof expressionSchema>;
export type ScenePointExpression = z.infer<typeof expressionPointSchema>;
export type SceneSize = z.infer<typeof sizeSchema>;
export type SceneCamera = z.infer<typeof cameraSchema>;
export type SceneWorld = z.infer<typeof worldSchema>;
export type SceneVariable = z.infer<typeof variableSchema>;
export type SceneObject = z.infer<typeof objectSchema>;
export type SceneConnector = z.infer<typeof connectorSchema>;
export type SceneVector = z.infer<typeof vectorSchema>;
export type SceneStep = z.infer<typeof stepSchema>;
export type SceneAnswer = z.infer<typeof answerSchema>;
export type SceneScript = z.infer<typeof sceneScriptSchema>;
export type SceneShape = (typeof SHAPES)[number];
export type SceneVectorKind = (typeof VECTOR_KINDS)[number];
export type SceneConnectorKind = (typeof CONNECTOR_KINDS)[number];
