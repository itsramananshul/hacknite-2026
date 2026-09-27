import { solveProblem as solveGemini, editProblem as editGemini, type SolveRequest } from "./gemini";
import { solveWithOpenCode, editWithOpenCode, type EnvLike } from "./opencode";
import type { SceneScript } from "./schema";
import {solveWithOllama,editWithOllama} from "./ollama";

export function solverProvider(env: EnvLike = process.env): "opencode" | "ollama" | "gemini" {
  if (env.CHALK_SOLVER === "ollama") return "ollama";
  if (env.CHALK_SOLVER === "gemini") return "gemini";
  return env.CHALK_SOLVER === "opencode" || !!env.OPENCODE_SERVER_URL ? "opencode" : "gemini";
}

export function solveProblem(request: SolveRequest) {
  if (solverProvider() === "ollama") return solveWithOllama(request);
  return solverProvider() === "opencode" ? solveWithOpenCode(request) : solveGemini(request);
}

export function editProblem(scene: SceneScript, instruction: string) {
  if (solverProvider() === "ollama") return editWithOllama(scene,instruction);
  return solverProvider() === "opencode" ? editWithOpenCode(scene, instruction) : editGemini(scene, instruction);
}
