import {test} from "node:test";
import assert from "node:assert/strict";
import type {SupabaseClient} from "@supabase/supabase-js";
import {accountStorage,queueNotebookDeletion,queuePage,readPending,flushCloud,loadCloudLibrary,type SavedPage} from "../lib/cloud-notebooks";
import {type Notebook,type PageEntry} from "../lib/notebooks";
const physics:Notebook={id:"physics",name:"My physics class",subject:"physics"};
function memory(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};}
const entry:PageEntry={id:"page-1",notebookId:"physics",title:"Free fall",status:"ready",updatedAt:"2026-09-27T00:00:00Z"};
const payload:SavedPage={questionPage:{id:entry.id,notebookId:"physics",problemText:"Fall from five metres",status:"ready"},scene:null,solution:"1.010 seconds",values:{}};
test("guest and two account caches cannot read each other's question pages",()=>{
  const storage=memory();const guest=accountStorage(storage,null),a=accountStorage(storage,"user-a"),b=accountStorage(storage,"user-b");
  guest.setItem("chalk-page:page-1","guest");a.setItem("chalk-page:page-1","private-a");
  assert.equal(guest.getItem("chalk-page:page-1"),"guest");assert.equal(a.getItem("chalk-page:page-1"),"private-a");assert.equal(b.getItem("chalk-page:page-1"),null);
});
test("a failed cloud upload retains the durable queue for retry",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,physics);
  const client={from:()=>({upsert:async()=>({error:{message:"offline"}})})} as unknown as SupabaseClient;
  await assert.rejects(flushCloud(client,"user-a",cache,()=>true),/offline/);assert.equal(readPending(cache).pages[entry.id].payload.solution,payload.solution);
});
test("edits made during an upload remain pending, and account switching stops subsequent writes",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,physics);
  const calls:string[]=[];let current=true,switched=false;
  const client={from:(table:string)=>({upsert:async()=>{calls.push(table);if(table==="notebooks" && !switched){queuePage(cache,entry,{...payload,solution:"new edit"},physics);current=false;switched=true;}return {error:null};}})} as unknown as SupabaseClient;
  await flushCloud(client,"user-a",cache,()=>current);assert.deepEqual(calls,["notebooks"]);assert.equal(readPending(cache).pages[entry.id].payload.solution,"new edit");
  current=true;await flushCloud(client,"user-a",cache,()=>current);assert.deepEqual(readPending(cache),{notebooks:{},pages:{}});
});
test("cloud hydration overlays pending edits instead of replacing them with an older server page",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,physics);
  const client={from:(table:string)=>({select:()=>({eq:()=>({order:()=>({range:async()=>({error:null,data:table==="notebooks"?[physics]:[{id:entry.id,notebook_id:"physics",title:entry.title,status:"ready",updated_at:entry.updatedAt,payload:{...payload,solution:"old server edit"}}]})})})})})} as unknown as SupabaseClient;
  const library=await loadCloudLibrary(client,"user-a",cache);assert.equal(library.pages.length,1);assert.equal(JSON.parse(cache.getItem("chalk-page:page-1")!).solution,payload.solution);
});
test("one device uploads a full question and a separate empty device loads its scene and answers",async()=>{
  const rows={notebooks:[] as any[],question_pages:[] as any[]};
  const client={from:(table:keyof typeof rows)=>({
    upsert:async(value:any)=>{for(const row of Array.isArray(value)?value:[value]){const index=rows[table].findIndex(r=>r.id===row.id && r.user_id===row.user_id);if(index<0)rows[table].push(row);else rows[table][index]=row;}return {error:null};},
    select:()=>({eq:(_column:string,userId:string)=>({order:()=>({range:async()=>({error:null,data:rows[table].filter(r=>r.user_id===userId)})})})})
  })} as unknown as SupabaseClient;
  const first=accountStorage(memory(),"user-a"),second=accountStorage(memory(),"user-a");
  const complete={...payload,scene:{title:"Free fall"},questionPage:{...payload.questionPage,video:{id:"6db2ccc5-b4bd-4d89-b170-6e16bc39ca83",fingerprint:"scene-and-values"},answers:{answers:[{value:1.010,unit:"s"}]}}};
  queuePage(first,entry,complete,physics);
  await flushCloud(client,"user-a",first,()=>true);
  assert.equal(second.getItem(`chalk-page:${entry.id}`),null);
  const loaded=await loadCloudLibrary(client,"user-a",second);
  assert.equal(loaded.pages[0].title,"Free fall");
  assert.deepEqual(JSON.parse(second.getItem(`chalk-page:${entry.id}`)!),complete);
  assert.equal(Object.keys(readPending(second).pages).length,0,"reading on the second device must not enqueue a write");
  rows.question_pages[0].payload={...complete,solution:"Remote update"};
  await loadCloudLibrary(client,"user-a",second);
  assert.equal(JSON.parse(second.getItem(`chalk-page:${entry.id}`)!).solution,"Remote update");
});

test("notebook deletion survives an offline retry and hides stale remote rows",async()=>{
 const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,physics);queueNotebookDeletion(cache,physics.id);
 assert.equal(readPending(cache).pages[entry.id],undefined);
 const client={from:(table:string)=>({select:()=>({eq:()=>({order:()=>({range:async()=>({error:null,data:table==="notebooks"?[physics]:[{id:entry.id,notebook_id:physics.id,title:entry.title,status:entry.status,updated_at:entry.updatedAt,payload}]})})})}),delete:()=>({eq:()=>({eq:async()=>({error:{message:"offline"}})})})})} as unknown as SupabaseClient;
 assert.deepEqual(await loadCloudLibrary(client,"user-a",cache),{notebooks:[],pages:[]});
 await assert.rejects(flushCloud(client,"user-a",cache,()=>true),/offline/);
 assert.equal(readPending(cache).deletedNotebooks?.physics,true);
});
test("deleting a notebook scopes both deletes to its owner and notebook",async()=>{
 const cache=accountStorage(memory(),"user-a");queueNotebookDeletion(cache,physics.id);const calls:unknown[]=[];
 const client={from:(table:string)=>({delete:()=>({eq:(owner:string,user:string)=>({eq:async(column:string,id:string)=>{calls.push([table,owner,user,column,id]);return {error:null};}})})})} as unknown as SupabaseClient;
 await flushCloud(client,"user-a",cache,()=>true);
 assert.deepEqual(calls,[["question_pages","user_id","user-a","notebook_id","physics"],["notebooks","user_id","user-a","id","physics"]]);
 assert.equal(Object.keys(readPending(cache).deletedNotebooks ?? {}).length,0);
});
