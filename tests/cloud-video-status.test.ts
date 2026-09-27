import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVideoStatus} from '../lib/cloud-video-status';

test('local cloud progress uses the deployed app and scoped session',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(input,init)=>{
   assert.equal(String(input),'https://chalk.anshulraman.com/api/video/test-id');
   assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-session');
   assert.equal(init?.redirect,'error');
   return Response.json({status:'ready',message:'Video ready.',narration:true});
  };
  assert.deepEqual(await cloudVideoStatus('test-id','test-session'),{status:'ready',message:'Video ready.',narration:true});
 }finally{globalThis.fetch=original;}
});
test('cloud status failures are actionable instead of unexpected internal errors',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({error:'Temporarily unavailable'},{status:503});
  await assert.rejects(cloudVideoStatus('test-id','test-session'),{status:502,code:'cloud_video_unavailable'});
 }finally{globalThis.fetch=original;}
});
