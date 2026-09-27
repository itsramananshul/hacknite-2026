import {parse, type MathNode} from "mathjs";
import {compileExpression} from "./expressions";
import type {SceneScript} from "./schema";

/** Change only the displayed phase of fast, periodic motion, never the answers. */
export function motionPresentation(scene:SceneScript, values:Record<string,number>={}) {
  const counts=new Map<string,number>();
  for(const o of scene.objects)if(o.label)counts.set(o.label,(counts.get(o.label) ?? 0)+1);
  const pointIds=scene.objects.filter(o=>o.shape==="sphere" && ((counts.get(o.label) ?? 0)>=3 || /^(marker|tracer|point) \d+$/i.test(o.label))).map(o=>o.id);
  scene={...scene,objects:scene.objects.map(o=>{
    const i=pointIds.indexOf(o.id);
    return i<0 ? o : {...o,label:String.fromCharCode(65+i%26)+(i>=26 ? String(Math.floor(i/26)+1) : "")};
  })};
  const scope=Object.fromEntries(scene.variables.map(v=>[v.name,values[v.name] ?? v.value]));
  const phases:ReturnType<typeof compileExpression>[]=[];
  const expressions=scene.objects.flatMap(o=>[...Object.values(o.position),...Object.values(o.rotation),...Object.values(o.scale ?? {})]);
  for(const expression of expressions) {
    parse(expression).traverse(node=>{
      const fn=node as MathNode & {fn?:{name?:string};args?:MathNode[]};
      if(!["sin","cos"].includes(fn.fn?.name ?? "") || !fn.args?.[0])return;
      let timed=false;fn.args[0].traverse(child=>{if(child.type==="SymbolNode" && (child as MathNode & {name:string}).name==="t")timed=true;});
      if(timed)phases.push(compileExpression(fn.args[0].toString(),scene.variables.map(v=>v.name)));
    });
  }
  let angularRate=0;
  const linearPhases=new Set<string>();
  for(const phase of phases) {
    // Only linear phases are retimed; events and nonperiodic dynamics stay intact.
    const a=Number(phase.evaluate({...scope,t:0}));
    const b=Number(phase.evaluate({...scope,t:scene.duration/2}));
    const c=Number(phase.evaluate({...scope,t:scene.duration}));
    if(Math.abs((b-a)-(c-b))<=1e-7*Math.max(1,Math.abs(c-a))) {
      angularRate=Math.max(angularRate,Math.abs(c-a)/scene.duration);
      linearPhases.add(phase.source);
    }
  }
  const frequencyHz=angularRate/(2*Math.PI);
  const rate=frequencyHz>8 ? 2/frequencyHz : 1;
  if(rate===1)return {scene,rate,frequencyHz,pointIds};
  const retime=(expression:string)=>parse(expression).transform(node=>{
    const fn=node as MathNode & {fn?:{name?:string};args?:MathNode[]};
    if(!["sin","cos"].includes(fn.fn?.name ?? "") || !fn.args?.[0])return node;
    if(!linearPhases.has(fn.args[0].toString()))return node;
    const phase=fn.args[0].transform(child=>child.type==="SymbolNode" && (child as MathNode & {name:string}).name==="t" ? parse(`(t * ${rate})`) : child);
    return parse(`${fn.fn!.name}(${phase.toString()})`);
  }).toString();
  const point=(p:{x:string;y:string;z:string})=>({x:retime(p.x),y:retime(p.y),z:retime(p.z)});
  return {rate,frequencyHz,pointIds,scene:{...scene,
    objects:scene.objects.map(o=>({...o,position:point(o.position),rotation:point(o.rotation),...(o.scale ? {scale:point(o.scale)} : {}),trail:o.trail && !Object.values(o.position).some(e=>/\b(sin|cos)\s*\([^]*\bt\b/.test(e))})),
    vectors:scene.vectors.map(v=>({...v,components:point(v.components)})),
  }};
}

/** Repeated particle names describe a collection, not separate caption entries. */
export function captionObjectIds(scene:SceneScript, focus:readonly string[]) {
  const selected=new Set<string>();const labels=new Set<string>();const focused=new Set(focus);
  const repeatedMarkers=scene.objects.filter(o=>/^(marker|tracer) \d+$/i.test(o.label)).length;
  const ordered=[...scene.objects].sort((a,b)=>Number(focused.has(b.id))-Number(focused.has(a.id)));
  for(const o of ordered) {
    const label=o.label.trim().toLowerCase();
    if(!label || labels.has(label))continue;
    if(repeatedMarkers>=4 && /^(marker|tracer) \d+$/i.test(o.label) && !focused.has(o.id))continue;
    selected.add(o.id);labels.add(label);
  }
  return selected;
}
