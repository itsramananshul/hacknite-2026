import type {GenerationJob} from "./generation-jobs";
import {runSolve,runScene,editProblem,type SolveResult,type SolveRequest} from "./gemini";

async function generate(input:Pick<GenerationJob,"request"|"edit">){
  "use step";
  return editProblem(input.edit!.scene,input.edit!.instruction);
}
async function solve(request:SolveRequest){
  "use step";
  return runSolve(request);
}
async function visualize(request:SolveRequest,answers:Omit<SolveResult,"scene">){
  "use step";
  const built=await runScene({subject:request.subject,problemText:answers.interpretedProblem || request.problemText,fromImage:!!request.image,solutionText:answers.solutionText,answers:answers.answers});
  return {...answers,scene:built.scene,warnings:[...answers.warnings,...built.warnings]};
}

export async function generationWorkflow(input:Pick<GenerationJob,"request"|"edit">){
  "use workflow";
  if(input.edit)return {result:await generate(input)};
  const answers=await solve(input.request!);
  try{return {result:await visualize(input.request!,answers)};}
  catch(error){return {answers,error:error instanceof Error?error.message:"The simulation could not finish. Your problem and solution are saved."};}
}
