import {compileScene} from "./expressions";
import type {SceneScript} from "./schema";
import {validateSceneScript} from "./validate";

// Only explicit, single-parameter arithmetic is handled here. Ambiguous or
// structural edits still go to the solver rather than being guessed.
export function localParameterEdit(scene:SceneScript,instruction:string) {
  const text=instruction.trim().toLowerCase().replace(/[.!]$/," ").trim();
  const number="(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
  const match=text.match(new RegExp(`^(?:set|change|make) (?:the )?(.+?) (?:to|=) ${number}(?: ([a-z0-9/^°²³ -]+))?$`))
    ?? text.match(new RegExp(`^(.+?) = ${number}(?: ([a-z0-9/^°²³ -]+))?$`));
  const relative=text.match(new RegExp(`^(increase|decrease) (?:the )?(.+?) by ${number}(?: ([a-z0-9/^°²³ -]+))?$`));
  const multiply=text.match(/^(double|halve) (?:the )?(.+)$/);
  if(!match && !relative && !multiply)return null;
  const target=(match?.[1] ?? relative?.[2] ?? multiply?.[2] ?? "").trim();
  const words=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const exact=scene.variables.filter(v=>v.adjustable && (words(v.name)===words(target) || words(v.label)===words(target)));
  const candidates=exact.length ? exact : scene.variables.filter(v=>v.adjustable && words(v.label).endsWith(` ${words(target)}`));
  if(candidates.length!==1)return null;
  const variable=candidates[0];
  const unit=match?.[3] ?? relative?.[4];
  if(unit && words(unit)!==words(variable.unit))return null;
  const value=match ? Number(match[2]) : relative ? variable.value+(relative[1]==="increase" ? 1 : -1)*Number(relative[3]) : variable.value*(multiply![1]==="double" ? 2 : .5);
  if(!Number.isFinite(value) || value<variable.min || value>variable.max)throw new Error(`Use ${variable.label} between ${variable.min} and ${variable.max} ${variable.unit}.`);
  const next={...scene,variables:scene.variables.map(v=>v.name===variable.name ? {...v,value} : v)};
  const compiled=compileScene(next);
  const evaluated=compiled.answerValues({});
  next.answers=next.answers.map((answer,i)=>({...answer,value:evaluated[i]}));
  const validated=validateSceneScript(next).scene;
  const answers=validated.answers.map(({question,value,unit})=>({question,value,unit}));
  return {scene:validated,answers,warnings:[],solutionText:`${variable.label}: ${variable.value} → ${value} ${variable.unit}.\n\nCalculated with this scene's existing equations:\n${answers.map(a=>`${a.question}: ${a.value.toPrecision(6)} ${a.unit}`).join("\n")}`};
}
