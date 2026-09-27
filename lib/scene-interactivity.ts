import {compileScene} from "./expressions";
import type {SceneScript} from "./schema";

/** Generation-only checks; existing saved scenes remain readable. */
export function sceneInteractivityIssues(scene:SceneScript):string[] {
  const compiled=compileScene(scene);
  const snapshot=(values:Record<string,number>)=>[
    ...compiled.answerValues(values),
    ...[0,.25,.5,.75,1].flatMap(fraction=>{
      const sample=compiled.sample(scene.duration*fraction,values);
      return [
        ...sample.objects.flatMap(o=>[...o.position,...o.rotation,...(o.scale??[1,1,1]),Number(o.visible)]),
        ...sample.vectors.flatMap(v=>[...v.components,Number(v.visible)]),
      ];
    }),
  ];
  const baseline=snapshot({});
  const issues:string[]=[];
  for(const variable of scene.variables.filter(v=>v.adjustable)){
    const candidates=[variable.min,variable.max,(variable.min+variable.max)/2];
    const changes=candidates.some(value=>snapshot({[variable.name]:value}).some((n,i)=>
      Math.abs(n-baseline[i])>1e-9*Math.max(1,Math.abs(n),Math.abs(baseline[i]))));
    if(!changes)issues.push(`Slider "${variable.name}" changes neither computed answers nor displayed geometry. Use this variable in the actual answer and scene expressions; do not hardcode its initial numeric value or multiply it by zero.`);
  }
  return issues;
}
