import type {SceneScript} from "./schema";
import {compileScene} from "./expressions";

export function sceneFrame(scene:SceneScript,values:Record<string,number>,aspect:number) {
  const compiled=compileScene(scene);
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  const objects=scene.objects.filter(o=>!(/^(ground|floor|base)$/i.test(o.id)));
  for(let i=0;i<=24;i++){
    const sample=compiled.sample(scene.duration*i/24,values);
    for(const object of objects){
      const frame=sample.objects.find(o=>o.id===object.id);
      if(!frame?.visible)continue;
      const size=object.size;
      // A bounding sphere also covers rotated boxes and cylinders.
      const radius=Math.max(size.radius,Math.hypot(size.x,size.y,size.z)/2)*Math.max(...(frame.scale ?? [1,1,1]));
      for(let axis=0;axis<3;axis++){
        low[axis]=Math.min(low[axis],frame.position[axis]-radius);
        high[axis]=Math.max(high[axis],frame.position[axis]+radius);
      }
    }
  }
  if(!Number.isFinite(low[0]))return null;
  const target=low.map((v,i)=>(v+high[i])/2) as [number,number,number];
  const radius=Math.max(1,Math.hypot(...high.map((v,i)=>(v-low[i])/2)));
  const vertical=42*Math.PI/360;
  const halfFov=Math.min(vertical,Math.atan(Math.tan(vertical)*Math.max(.1,aspect)));
  const distance=radius/Math.sin(halfFov)*1.12;
  const direction=scene.camera.position.map((v,i)=>v-scene.camera.target[i]);
  const length=Math.hypot(...direction)||1;
  const position=target.map((v,i)=>v+direction[i]/length*distance) as [number,number,number];
  return {target,position,distance,radius};
}
