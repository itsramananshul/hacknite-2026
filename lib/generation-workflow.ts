import type {GenerationJob} from "./generation-jobs";
import {solveProblem,editProblem} from "./gemini";

async function generate(input:Pick<GenerationJob,"request"|"edit">){
  "use step";
  return input.edit?editProblem(input.edit.scene,input.edit.instruction):solveProblem(input.request!);
}

export async function generationWorkflow(input:Pick<GenerationJob,"request"|"edit">){
  "use workflow";
  return await generate(input);
}
