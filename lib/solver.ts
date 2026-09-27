import { solveProblem as solveGemini, editProblem as editGemini, type SolveRequest, type SolveResult } from "./gemini";
import { solveWithOpenCode, editWithOpenCode, type EnvLike } from "./opencode";
import type { SceneScript } from "./schema";
import {solveWithOllama,editWithOllama} from "./ollama";

export function solverProvider(env: EnvLike = process.env): "opencode" | "ollama" | "gemini" {
  if (env.CHALK_SOLVER === "ollama") return "ollama";
  if (env.CHALK_SOLVER === "gemini") return "gemini";
  return env.CHALK_SOLVER === "opencode" || !!env.OPENCODE_SERVER_URL ? "opencode" : "gemini";
}

export function solveProblem(request: SolveRequest,onSolved?:(result:Omit<SolveResult,"scene">)=>void) {
  if (solverProvider() === "ollama") return solveWithOllama(request,onSolved);
  return solverProvider() === "opencode" ? solveWithOpenCode(request,{onSolved}) : solveGemini(request,onSolved);
}

export function editProblem(scene: SceneScript, instruction: string) {
  if (solverProvider() === "ollama") return editWithOllama(scene,instruction);
  return solverProvider() === "opencode" ? editWithOpenCode(scene, instruction) : editGemini(scene, instruction);
}
