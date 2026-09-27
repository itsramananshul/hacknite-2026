import {z} from "zod";
import {compileExpression} from "./expressions";
import type {SceneScript,SceneVariable,SceneAnswer} from "./schema";
import {validateSceneScript} from "./validate";
export const mathVisualSchema=z.object({
  title:z.string().min(1).max(120),description:z.string().max(3500),
  xMin:z.number().finite(),xMax:z.number().finite(),yMin:z.number().finite(),yMax:z.number().finite(),
  xLabel:z.string().max(40),yLabel:z.string().max(40),
  parameters:z.array(z.object({name:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),label:z.string().max(40),value:z.number().finite(),min:z.number().finite(),max:z.number().finite(),step:z.number().positive()})).max(4),
  curves:z.array(z.object({label:z.string().max(40),expression:z.string().min(1).max(350)})).min(1).max(3),
  steps:z.array(z.object({title:z.string().max(120),narration:z.string().max(1800),equations:z.array(z.string().max(400)).max(5)})).min(1).max(6),
});
export function buildMathVisual(raw:unknown,answers:SceneAnswer[]=[]):SceneScript {
  const p=mathVisualSchema.parse(raw);
  if(!(p.xMax>p.xMin && p.yMax>p.yMin))throw new Error("Graph bounds must increase.");
  const duration=10,variables:SceneVariable[]=p.parameters.map(v=>({...v,unit:"1",adjustable:true}));
  const names=variables.map(v=>v.name),span=p.xMax-p.xMin,ys=p.yMax-p.yMin;
  const graphX=`(${p.xMin}+${span}*t/${duration})`;
  const colors=["#006cff","#e6a52d","#0b9d84"];
  const objects=p.curves.map((curve,i)=>{
    compileExpression(curve.expression,["x",...names]);
    const y=curve.expression.replace(/\bx\b/g,graphX);
    return {id:`curve${i}`,shape:"sphere" as const,size:{x:0,y:0,z:0,radius:.07},color:colors[i],label:curve.label,
      position:{x:`-3+6*t/${duration}`,y:`-2+4*((${y})-(${p.yMin}))/${ys}`,z:"0"},rotation:{x:"0",y:"0",z:"0"},trail:true,visible:"1"};
  });
  // Data is mapped into a stable plot frame; equations retain their actual units.
  const connectors=[{id:"xAxis",kind:"rod" as const,from:"-3,-2,0",to:"3,-2,0",color:"#616d93"},{id:"yAxis",kind:"rod" as const,from:"-3,-2,0",to:"-3,2,0",color:"#616d93"}];
  const scene:SceneScript={title:p.title,problemText:p.description+`\nGraph: horizontal ${p.xLabel} from ${p.xMin} to ${p.xMax}; vertical ${p.yLabel} from ${p.yMin} to ${p.yMax}. Playback traces the curves; it is not physical time.`,variables,duration,loop:false,
    world:{gravity:"0",groundY:-3,scale:1,showGrid:false},camera:{position:[0,0,9],target:[0,0,0]},objects,connectors,vectors:[],
    steps:p.steps.map((step,i)=>({...step,tStart:i*duration/p.steps.length,tEnd:(i+1)*duration/p.steps.length,focus:objects.map(o=>o.id),showVectors:[]})),answers};
  return validateSceneScript(scene).scene;
}
