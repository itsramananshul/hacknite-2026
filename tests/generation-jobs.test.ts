import test from "node:test";
import assert from "node:assert/strict";
import {readGeneration,saveGeneration,startGeneration,listGenerations} from "../lib/generation-jobs";
import {readOpenCodeConfig,OPENCODE_DEFAULT_TIMEOUT_MS} from "../lib/opencode";
import {publishGeneration} from "../lib/generation-cloud";
import {presets} from "../lib/presets";
import type {SupabaseClient} from "@supabase/supabase-js";

test("model requests allow 1,000 seconds, including an explicit override",()=>{
  assert.equal(OPENCODE_DEFAULT_TIMEOUT_MS,1_000_000);
  assert.equal(readOpenCodeConfig({OPENCODE_TIMEOUT_MS:"1000000"}).timeoutMs,1_000_000);
});
test("saved jobs survive a new reader and cannot cross account boundaries",async()=>{
  const userId=`test-${crypto.randomUUID()}`,pageId=crypto.randomUUID();
  const job={id:crypto.randomUUID(),userId,pageId,status:"building" as const,updatedAt:new Date().toISOString()};
  await saveGeneration(job);
  assert.equal((await readGeneration(userId,pageId))?.id,job.id);
  assert.equal(await readGeneration(`test-${crypto.randomUUID()}`,pageId),null);
  assert.equal((await listGenerations(userId)).length,1);
  // Reconnecting/submitting twice reuses the running work rather than starting again.
  assert.equal((await startGeneration({userId,pageId,request:{problemText:"test",image:null}})).id,job.id);
  await assert.rejects(readGeneration(userId,"../../another-account"),/Invalid generation identifier/);
});
test("completed background results merge with earlier simulations when the owner returns",async()=>{
  const userId=`test-${crypto.randomUUID()}`,pageId=crypto.randomUUID();
  const job={id:crypto.randomUUID(),userId,pageId,status:"complete" as const,updatedAt:new Date().toISOString(),result:{scene:presets.projectile,solutionText:"Completed while disconnected",answers:[],warnings:[]}};
  await saveGeneration(job);
  const payload={questionPage:{id:pageId,status:"building",simulations:[{id:"old",scene:presets.projectile,values:{},solution:"Previous solution"}]},scene:null,values:{},solution:""};
  const scopes:string[][]=[];let update:any;
  const client={from:()=>({select:()=>chain({data:{payload},error:null}),update:(body:any)=>{update=body;return chain({error:null});}})};
  function chain(result:any):any{return {eq:(key:string,value:string)=>{scopes.push([key,value]);return chain(result);},maybeSingle:async()=>result,then:(resolve:any)=>Promise.resolve(result).then(resolve)};}
  await publishGeneration(client as unknown as SupabaseClient,job);
  assert.equal(update.payload.questionPage.status,"ready");
  assert.equal(update.payload.questionPage.simulations.length,2);
  assert.equal(update.payload.questionPage.simulations[0].id,"old");
  assert.equal(update.payload.solution,"Completed while disconnected");
  assert.ok(scopes.some(([key,value])=>key==="user_id"&&value===userId));
  assert.ok(scopes.some(([key,value])=>key==="id"&&value===pageId));
  assert.equal((await readGeneration(userId,pageId))?.published,true);
});
test("a finished worker cannot recreate a deleted question",async()=>{
  const userId=`test-${crypto.randomUUID()}`,pageId=crypto.randomUUID();
  const job={id:crypto.randomUUID(),userId,pageId,status:"error" as const,updatedAt:new Date().toISOString(),error:"Stopped"};
  await saveGeneration(job);
  const query:any={eq:()=>query,maybeSingle:async()=>({data:null,error:null})};
  const client={from:()=>({select:()=>query,update:()=>{throw new Error("Must not recreate deleted data");}})};
  await publishGeneration(client as unknown as SupabaseClient,job);
  assert.equal((await readGeneration(userId,pageId))?.published,true);
});

test("regenerating a legacy page archives its previous scene and video first",async()=>{
  const oldVideo={id:crypto.randomUUID(),fingerprint:"original"};
  const payload={questionPage:{id:"legacy",status:"building",video:oldVideo},scene:presets.wave,values:{L:2},solution:"Original solution"};
  let update:any;
  function chain(result:any):any{return {eq:()=>chain(result),maybeSingle:async()=>result,then:(resolve:any)=>Promise.resolve(result).then(resolve)};}
  const client={from:()=>({select:()=>chain({data:{payload},error:null}),update:(body:any)=>{update=body;return chain({error:null});}})} as unknown as SupabaseClient;
  await publishGeneration(client,{id:"job",userId:"owner",pageId:"legacy",status:"complete",updatedAt:"now",result:{scene:presets.projectile,solutionText:"New solution",answers:[],warnings:[]}},async()=>{});
  assert.equal(update.payload.questionPage.simulations.length,2);
  const original=update.payload.questionPage.simulations[0];
  assert.deepEqual(original.scene,presets.wave);assert.deepEqual(original.video,oldVideo);assert.equal(original.solution,"Original solution");
});

test("simulation failure still saves the image transcription and solution without losing versions",async()=>{
 const payload={questionPage:{id:"photo",problemText:"",title:"My chemistry question",status:"building",sourceImage:"original upload",simulations:[{id:"old"}],archivedAt:"2026-09-27"},scene:{title:"Old simulation"},solution:""};
 let update:any;
 function chain(result:any):any{return {eq:()=>chain(result),maybeSingle:async()=>result,then:(resolve:any)=>Promise.resolve(result).then(resolve)};}
 const client={from:()=>({select:()=>chain({data:{payload},error:null}),update:(body:any)=>{update=body;return chain({error:null});}})} as unknown as SupabaseClient;
 await publishGeneration(client,{id:"job",userId:"owner",pageId:"photo",status:"error",updatedAt:"now",error:"Simulation timeout",answers:{interpretedProblem:"Find the buffer pH",solutionText:"The worked solution",answers:[],warnings:[]}},async()=>{});
 assert.equal(update.payload.questionPage.problemText,"Find the buffer pH");assert.equal(update.payload.solution,"The worked solution");assert.equal(update.payload.questionPage.status,"error");
 assert.deepEqual(update.payload.questionPage.simulations,[{id:"old"}]);assert.equal(update.payload.questionPage.sourceImage,"original upload");assert.equal(update.title,"My chemistry question");assert.equal(update.payload.questionPage.archivedAt,"2026-09-27");
});
