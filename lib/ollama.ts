// Direct, quota-free local inference. Reuses the same checked answer/scene
// pipeline as OpenCode, without a coding agent's unrelated workspace context.
import { randomUUID } from "node:crypto";
import { runOpenCodePipeline, readOpenCodeConfig, type EnvLike } from "./opencode";
import { RouteError, type PipelineRequest, type SolveRequest, type SolveResult } from "./gemini";
import {sceneScriptSchema,type SceneScript} from "./schema";
import {z} from "zod";

// Ollama's grammar converter requires an object in `items`, whereas Zod's
// camera tuples emit an array of schemas. Keep the fixed length and item types;
// the original Zod validator still enforces exact tuple order on the response.
export function ollamaJsonSchema(value:unknown):any {
  if(Array.isArray(value)) return value.map(ollamaJsonSchema);
  if(!value || typeof value!=="object") return value;
  const result=Object.fromEntries(Object.entries(value).map(([key,child])=>[key,ollamaJsonSchema(child)]));
  const tuple=Array.isArray(result.prefixItems) ? result.prefixItems : Array.isArray(result.items) ? result.items : null;
  if(tuple) {
    const choices=[...new Map(tuple.map((item:any)=>[JSON.stringify(item),item])).values()];
    result.minItems ??= tuple.length;
    result.maxItems ??= tuple.length;
    result.items=choices.length===1 ? choices[0] : {anyOf:choices};
    delete result.prefixItems;
  }
  return result;
}
const sceneFormat=ollamaJsonSchema(z.toJSONSchema(sceneScriptSchema,{io:"input"}));
const solveFormat=z.toJSONSchema(z.object({responseKind:z.enum(["numeric","symbolic","conceptual","needs-information"]),solutionText:z.string().max(6000),answers:z.array(z.object({question:z.string(),expression:z.string(),unit:z.string()})).max(12)}));
const localSceneSystem=`Build a compact animated physics scene as JSON DATA, never code. The problem is already solved; reproduce its verified answers and physical model. All motion is evaluated by a fixed renderer at time t in seconds. A moving body's POSITION must change with t; putting motion only in a velocity arrow or narration leaves the body stationary.
Required top-level fields: title, problemText, variables, duration, loop, world, camera, objects, connectors, vectors, steps, answers. Use 1-8 objects and 2-4 explanation steps where possible.
world: {gravity: "g" or "9.81", showGrid: boolean, groundY: number, scale: positive number}.
camera: {position: [number,number,number], target: [number,number,number]}. Frame the complete motion; y is up.
variables: [{name: string, value: number, unit: string, label: string, adjustable: boolean, min: number, max: number, step: positive number}]. Adjustable inputs must actually occur in the motion and answer expressions. min <= value <= max. Declare only problem inputs, not computed values.
objects: [{id: string, shape: string, size: {x:number,y:number,z:number,radius:number}, color: hex string, label:string, position:{x:EXPRESSION,y:EXPRESSION,z:EXPRESSION}, rotation:{x:"0",y:"0",z:"0"}, trail:boolean, visible:"1"}]. All FOUR size fields are required. Shapes: box, sphere, cylinder, cone, ramp, plane, pulley, planet, car, pendulumBob, resistor, capacitor, inductor.
EXPRESSION means a QUOTED math string. Allowed names: t, pi, e, and variables you declared. Allowed functions: sin, cos, tan, sqrt, abs, min, max, exp. Operators: + - * / ^ and comparisons and ternary. Inline derived formulas; NEVER use undeclared names such as tHit, omega, vFinal. Keep expressions finite. E.g. a free-fall position uses y:"max(0,h-g*t^2/2)" and velocity y:"t < sqrt(2*h/g) ? -g*t : 0"; a static initial y:"h" does not animate.
connectors: [{id:string,kind:"spring"|"rope"|"rod",from:objectId,to:objectId}]. Springs require a spring connector between anchor and mass. Circuit components require connecting wires.
vectors: [{id:string,attachTo:objectId,kind:"force"|"velocity"|"acceleration"|"momentum",components:{x:EXPRESSION,y:EXPRESSION,z:EXPRESSION},label:string,color:hex string,visible:"1"}]. Use [] if unnecessary.
steps: [{title:string,narration:string,equations:[string],tStart:number,tEnd:number,focus:[objectId],showVectors:[vectorId]}]. Equations are an ARRAY of strings, not one string. Use valid LaTeX with backslashes escaped in JSON. Steps cover 0 to duration consecutively. Focus references ONLY existing objects; showVectors ONLY existing vectors. Omit step cameras unless needed.
answers: [{question:string,expression:EXPRESSION,value:number,unit:string}]. Match every verified answer in order. No t in answers. Use the declared inputs so sliders recalculate correctly.
For physical tasks not expressible analytically, depict the setup honestly and explain the limitation. Do not invent turbulence or measurements. Return ONLY the complete JSON object, without markdown.`;
// Small local models sometimes omit the JSON quotes around arithmetic. This
// repairs serialization only; the existing expression validator still decides
// whether any resulting expression is allowed and finite.
export function parseLocalScene(text:string):unknown {
  const body=(/```(?:json)?\s*([\s\S]*?)\s*```/.exec(text)?.[1] ?? text).trim();
  try {return JSON.parse(body);} catch {
    const quoted=body.replace(/(?<!\\)("(?:x|y|z|visible|gravity|expression)"\s*:\s*)([^"\[{\n,}][^,\n}]*)(?=[,\n}])/g, (match,prefix:string,token:string)=>{
      const value=token.trim();
      if(!value || /^(true|false|null)$/.test(value) || Number.isFinite(Number(value))) return match;
      return /^[A-Za-z0-9_+\-*/^%().<>?: =]+$/.test(value) ? prefix+JSON.stringify(value) : match;
    });
    return JSON.parse(quoted);
  }
}
// Some small models serialize JSON scalars as strings. Convert only known
// scalar fields; expressions and references still face the full validator.
export function normalizeLocalScene(raw:unknown):unknown {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) return raw;
  const scene=structuredClone(raw) as Record<string,any>;
  const numbers=(record:any,keys:string[])=>{
    if(!record || typeof record!=="object") return;
    for(const key of keys) if(typeof record[key]==="string" && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(record[key])) record[key]=Number(record[key]);
  };
  const camera=(record:any)=>{if(!record||typeof record!=="object") return;for(const key of ["position","target"]) if(Array.isArray(record[key])) record[key]=record[key].map((n:unknown)=>typeof n==="string"&&n.trim()!==""&&Number.isFinite(Number(n))?Number(n):n);};
  numbers(scene,["duration"]);numbers(scene.world,["groundY","scale"]);camera(scene.camera);
  if(scene.loop==="true"||scene.loop==="false") scene.loop=scene.loop==="true";
  if(Array.isArray(scene.variables)) for(const v of scene.variables) {numbers(v,["value","min","max","step"]);if(v.adjustable==="true"||v.adjustable==="false") v.adjustable=v.adjustable==="true";}
  if(Array.isArray(scene.objects)) for(const o of scene.objects) {numbers(o.size,["x","y","z","radius"]);if(typeof o.trail==="string"&&(o.trail==="true"||o.trail==="false")) o.trail=o.trail==="true";}
  if(Array.isArray(scene.steps)) for(const step of scene.steps) {numbers(step,["tStart","tEnd"]);camera(step.camera);}
  if(Array.isArray(scene.answers)) for(const answer of scene.answers) numbers(answer,["value"]);
  return scene;
}

export async function runOllamaPipeline(request: PipelineRequest, env: EnvLike = process.env, fetchImpl: typeof fetch = fetch, onSolved?: (result:Omit<SolveResult,"scene">)=>void) {
  if (env.VERCEL) throw new RouteError(503,"ollama_local_only","Local inference runs on your laptop. Open the local Chalk app.");
  const model = env.OLLAMA_MODEL || "qwen3.5:9b";
  const visionModel = env.OLLAMA_VISION_MODEL || model;
  if ([model,visionModel].some(id=>id.includes(":cloud"))) {
    throw new RouteError(500,"ollama_cloud_model","Local mode requires a model downloaded onto this computer.");
  }
  const base = readOpenCodeConfig({OPENCODE_SERVER_URL:env.OLLAMA_SERVER_URL || "http://127.0.0.1:11434"}).baseUrl;
  let previousSystem="";
  let messages: {role:string;content:string;images?:string[]}[]=[];
  // The existing pipeline's transport contract provides bounded requests,
  // cancellation, JSON parsing, arithmetic evaluation and scene repair.
  const localTransport = (async (_url,init) => {
    const path = new URL(String(_url)).pathname;
    if (path === "/experimental/tool/ids") return Response.json([]);
    if (path === "/session") return Response.json({id:randomUUID()});
    if (!path.endsWith("/message")) return Response.json(true);
    const body=JSON.parse(String(init?.body));
    const images=body.parts.filter((p:{type:string})=>p.type==="file").map((p:{url:string})=>p.url.split(",")[1]);
    const text=body.parts.filter((p:{type:string})=>p.type==="text").map((p:{text:string})=>p.text).join("\n");
    if (body.system !== previousSystem) {
      previousSystem=body.system;
      const system=body.system.includes("The JSON Schema of that object") ? localSceneSystem : body.system;
      const sceneRequest=body.system.includes("The JSON Schema of that object");
      const constraints=sceneRequest?"Return a compact instance, never its schema. Use 2 explanation steps, each with at most 2 sentences. Use only physically necessary objects. Focus lists contain ONLY object IDs; showVectors ONLY vector IDs. visible is a string, never a boolean. Inline all derived expressions. All four size fields including radius are required. Motion must use t in position expressions.":"Keep solutionText under 1200 characters: state given values, formulas, assumptions and requested answers concisely. No repeated derivations or extra questions. Use plain text formulas. Each answer must use a constant arithmetic expression with numbers substituted; no variable names.";
      messages=[{role:"system",content:system+"\n"+constraints}];
    }
    const sceneCall=body.system.includes("The JSON Schema of that object");
    const guidance=sceneCall ? "\nFINAL CHECK BEFORE ANSWERING: return animated positions, not initial positions. For a falling body, its y must contain t, for example max(0,h-g*t^2/2), never just 5 or h. For other moving bodies use the motion formula you derived. Use declared adjustable variables in the motion and answer expressions, rather than repeating their numerical values. Equations are string ARRAYS, and every size includes radius. Include the actual spring or rope connectors when appropriate." : "";
    messages.push({role:"user",content:text+guidance,...(images.length?{images}:{})});
    const response=await fetchImpl(`${base}/api/chat`,{
      method:"POST",headers:{"Content-Type":"application/json"},signal:init?.signal,
      body:JSON.stringify({model:body.model.modelID,stream:false,think:false,
        format:body.system.includes("The JSON Schema of that object")?sceneFormat:solveFormat,keep_alive:"10m",
        options:{num_ctx:sceneCall?8192:4096,num_predict:sceneCall?2600:1200,temperature:.1},
        messages}),
    });
    if (!response.ok) return response;
    const result=await response.json();
    if (typeof result.message?.content !== "string") throw new Error("Ollama returned no answer.");
    if(body.system.includes("The JSON Schema of that object")) {
      try{result.message.content=JSON.stringify(normalizeLocalScene(parseLocalScene(result.message.content)));}catch{/* The checked pipeline reports malformed JSON. */}
    }
    messages.push({role:"assistant",content:result.message.content});
    return Response.json({info:{},parts:[{type:"text",text:result.message.content}]});
  }) as typeof fetch;
  try { return await runOpenCodePipeline(request,{env:{OPENCODE_SERVER_URL:base,OPENCODE_PROVIDER_ID:"ollama",OPENCODE_MODEL:model,
    OPENCODE_VISION_MODEL:visionModel,OPENCODE_TIMEOUT_MS:env.OLLAMA_TIMEOUT_MS || "1000000"},fetchImpl:localTransport,onSolved});
  } catch(error) {
    if(error instanceof RouteError) throw new RouteError(error.status,error.code.replace(/^opencode_/,"ollama_"),error.message.replaceAll("OpenCode","Ollama"));
    throw error;
  }
}
export const solveWithOllama=(request:SolveRequest,onSolved?:(result:Omit<SolveResult,"scene">)=>void)=>runOllamaPipeline({problemText:request.problemText,image:request.image,subject:request.subject},process.env,fetch,onSolved);
export const editWithOllama=(scene:SceneScript,instruction:string)=>runOllamaPipeline({problemText:scene.problemText,image:null,currentScene:scene,instruction});
