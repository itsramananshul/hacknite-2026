import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {syncLocalVideo} from "../lib/video-sync";
import {videoDirectory} from "../lib/video";

test("local video migration preserves bytes and ID, skips completed uploads, and enforces ownership",async()=>{
  const id=randomUUID(),owner=randomUUID(),directory=videoDirectory(id);
  await mkdir(directory,{recursive:true});
  const bytes=Buffer.from("existing MP4 bytes");
  await writeFile(join(directory,"owner.json"),JSON.stringify({userId:owner}));
  await writeFile(join(directory,"status.json"),JSON.stringify({status:"ready",narration:true}));
  await writeFile(join(directory,"explanation.mp4"),bytes);
  let ready=false,uploads=0,queries=0;
  const client={
    from(){queries++;return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:ready?{status:"ready"}:null,error:null};},async upsert(row:Record<string,unknown>){assert.equal(row.id,id);assert.equal(row.user_id,owner);assert.equal(row.status,"ready");assert.equal(row.narration,true);ready=true;return {error:null};}};},
    storage:{from(){return {async upload(path:string,data:Buffer){assert.equal(path,`${owner}/${id}.mp4`);assert.deepEqual(data,bytes);uploads++;return {error:null};}};}}
  } as unknown as SupabaseClient;
  try{
    await assert.rejects(syncLocalVideo(client,randomUUID(),id));assert.equal(queries,0);
    assert.equal(await syncLocalVideo(client,owner,id),true);assert.equal(uploads,1);
    assert.equal(await syncLocalVideo(client,owner,id),true);assert.equal(uploads,1);
    assert.deepEqual(await import("node:fs/promises").then(fs=>fs.readFile(join(directory,"explanation.mp4"))),bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("unfinished local renders are never uploaded as ready videos",async()=>{
  const id=randomUUID(),owner=randomUUID(),directory=videoDirectory(id);
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,"owner.json"),JSON.stringify({userId:owner}));
  await writeFile(join(directory,"status.json"),JSON.stringify({status:"rendering"}));
  try{assert.equal(await syncLocalVideo({} as SupabaseClient,owner,id),false);}
  finally{await rm(directory,{recursive:true,force:true});}
});
