import {test} from "node:test";
import assert from "node:assert/strict";
import type {SupabaseClient} from "@supabase/supabase-js";
import {accountStorage,queuePage,readPending,flushCloud,loadCloudLibrary,type SavedPage} from "../lib/cloud-notebooks";
import {EMPTY_LIBRARY,type PageEntry} from "../lib/notebooks";
function memory(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);}};}
const entry:PageEntry={id:"page-1",notebookId:"physics",title:"Free fall",status:"ready",updatedAt:"2026-09-27T00:00:00Z"};
const payload:SavedPage={questionPage:{id:entry.id,notebookId:"physics",problemText:"Fall from five metres",status:"ready"},scene:null,solution:"1.010 seconds",values:{}};
test("guest and two account caches cannot read each other's question pages",()=>{
  const storage=memory();const guest=accountStorage(storage,null),a=accountStorage(storage,"user-a"),b=accountStorage(storage,"user-b");
  guest.setItem("chalk-page:page-1","guest");a.setItem("chalk-page:page-1","private-a");
  assert.equal(guest.getItem("chalk-page:page-1"),"guest");assert.equal(a.getItem("chalk-page:page-1"),"private-a");assert.equal(b.getItem("chalk-page:page-1"),null);
});
test("a failed cloud upload retains the durable queue for retry",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,EMPTY_LIBRARY.notebooks[0]);
  const client={from:()=>({upsert:async()=>({error:{message:"offline"}})})} as unknown as SupabaseClient;
  await assert.rejects(flushCloud(client,"user-a",cache,()=>true),/offline/);assert.equal(readPending(cache).pages[entry.id].payload.solution,payload.solution);
});
test("edits made during an upload remain pending, and account switching stops subsequent writes",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,EMPTY_LIBRARY.notebooks[0]);
  const calls:string[]=[];let current=true,switched=false;
  const client={from:(table:string)=>({upsert:async()=>{calls.push(table);if(table==="notebooks" && !switched){queuePage(cache,entry,{...payload,solution:"new edit"},EMPTY_LIBRARY.notebooks[0]);current=false;switched=true;}return {error:null};}})} as unknown as SupabaseClient;
  await flushCloud(client,"user-a",cache,()=>current);assert.deepEqual(calls,["notebooks"]);assert.equal(readPending(cache).pages[entry.id].payload.solution,"new edit");
  current=true;await flushCloud(client,"user-a",cache,()=>current);assert.deepEqual(readPending(cache),{notebooks:{},pages:{}});
});
test("cloud hydration overlays pending edits instead of replacing them with an older server page",async()=>{
  const cache=accountStorage(memory(),"user-a");queuePage(cache,entry,payload,EMPTY_LIBRARY.notebooks[0]);
  const client={from:(table:string)=>({select:()=>({eq:()=>({order:()=>({range:async()=>({error:null,data:table==="notebooks"?[EMPTY_LIBRARY.notebooks[0]]:[{id:entry.id,notebook_id:"physics",title:entry.title,status:"ready",updated_at:entry.updatedAt,payload:{...payload,solution:"old server edit"}}]})})})})})} as unknown as SupabaseClient;
  const library=await loadCloudLibrary(client,"user-a",cache);assert.equal(library.pages.length,1);assert.equal(JSON.parse(cache.getItem("chalk-page:page-1")!).solution,payload.solution);
});
