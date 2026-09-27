import {test} from "node:test";
import assert from "node:assert/strict";
import {readSolveStream} from "../lib/solve-stream";
import {runOpenCodePipeline} from "../lib/opencode";
import {presets} from "../lib/presets";
import {compileScene} from "../lib/expressions";

test("answers arrive before scene completion across split UTF-8 chunks",async()=>{
  const encoder=new TextEncoder();let controller!:ReadableStreamDefaultController<Uint8Array>;
  const response=new Response(new ReadableStream({start(c){controller=c;}}));
  const early={solutionText:"ρ is the fluid density",answers:[{question:"Velocity",value:3,unit:"m/s"}],warnings:[]};
  let received:any;let finished=false;
  const reading=readSolveStream(response,r=>{received=r;}).then(r=>{finished=true;return r;});
  const line=encoder.encode(JSON.stringify({type:"answers",result:early})+"\n");
  for(let i=0;i<line.length;i+=7) controller.enqueue(line.slice(i,i+7));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(received,early);assert.equal(finished,false);
  controller.enqueue(encoder.encode(JSON.stringify({type:"complete",result:{...early,scene:null}})+"\n"));controller.close();
  assert.equal((await reading).solutionText,early.solutionText);
});
test("a later scene error retains the already-delivered answer",async()=>{
  let received=false;
  const response=new Response(JSON.stringify({type:"answers",result:{solutionText:"Answer",answers:[],warnings:[]}})+"\n"+JSON.stringify({type:"error",error:"Scene failed"})+"\n");
  await assert.rejects(readSolveStream(response,()=>{received=true;}),/Scene failed/);
  assert.equal(received,true);
});
test("pipeline exposes only evaluated answers before requesting the scene",async()=>{
  const scene=presets.projectile,values=compileScene(scene).answerValues();let messages=0,notified=false;
  const transport:typeof fetch=async(url)=>{
    const path=new URL(String(url)).pathname;
    if(path==="/experimental/tool/ids") return Response.json([]);
    if(path==="/session") return Response.json({id:"stream-test"});
    if(path.endsWith("/message")){
      if(messages++===0) return Response.json({parts:[{type:"text",text:JSON.stringify({solutionText:"Checked projectile",answers:scene.answers.map((a,i)=>({question:a.question,expression:String(values[i]),value:999,unit:a.unit}))})}]});
      assert.equal(notified,true);
      return Response.json({parts:[{type:"text",text:JSON.stringify(scene)}]});
    }
    return Response.json(true);
  };
  await runOpenCodePipeline({problemText:scene.problemText,image:null},{env:{},fetchImpl:transport,onSolved:r=>{assert.equal(r.answers[0].value,values[0]);notified=true;}});
  assert.equal(notified,true);
});
