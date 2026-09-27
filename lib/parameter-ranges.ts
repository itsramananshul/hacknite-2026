import type {SceneScript} from "./schema";
/** Persist the expanded domain used by exact-value controls, without changing the original defaults. */
export function withParameterRanges(scene:SceneScript,values:Record<string,number>):SceneScript{
 return {...scene,variables:scene.variables.map(variable=>{
  const value=values[variable.name];
  return Number.isFinite(value) && Math.abs(value)<=1e6 ? {...variable,min:Math.min(variable.min,value),max:Math.max(variable.max,value)} : variable;
 })};
}
