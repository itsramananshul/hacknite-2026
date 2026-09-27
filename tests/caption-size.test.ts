import {test} from "node:test";
import assert from "node:assert/strict";
import {captionWorldScale,captionBox} from "../lib/caption-size";
import {compileScene} from "../lib/expressions";
import {presets} from "../lib/presets";
import {validateSceneScript} from "../lib/validate";
import {videoPayload} from "../lib/video";
test("captions project to 13 pixels across zoom distances and viewport sizes",()=>{
  for(const depth of [1,3,10,30,90])for(const height of [480,720,1080]){
    const scale=captionWorldScale(depth,42,height,.2);
    const projected=.2*scale*height/(2*depth*Math.tan(42*Math.PI/360));
    assert.ok(Math.abs(projected-13)<1e-10);
  }
  const narrow=captionBox("Oscillating mass",640,480),wide=captionBox("Oscillating mass",1280,960);
  assert.equal(narrow.half,wide.half*2);assert.equal(narrow.height,wide.height*2);
});
test("the cliff and video geometry follow the height slider and stay grounded",()=>{
  const compiled=compileScene(presets.projectile);
  for(const h of [1,5,8,12]){
    const cliff=compiled.sample(0,{h}).objects.find(o=>o.id==="cliff")!;
    const halfHeight=presets.projectile.objects.find(o=>o.id==="cliff")!.size.y*cliff.scale![1]/2;
    assert.equal(cliff.position[1]-halfHeight,0);assert.equal(cliff.position[1]+halfHeight,h);
  }
  const video=videoPayload(presets.projectile,{h:8});assert.equal(video.frames[0].objects.find(o=>o.id==="cliff")!.scale![1],1.6);
  const broken=structuredClone(presets.projectile);broken.objects[0].scale={x:"1",y:"1/0",z:"1"};assert.throws(()=>validateSceneScript(broken));
});
