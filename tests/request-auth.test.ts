import {test} from "node:test";
import assert from "node:assert/strict";
import {requireUser} from "../lib/request-auth";
test("protected requests reject missing, forged and expired sessions before returning a user",async()=>{
  const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,oldFetch=globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://auth-test.supabase.co";process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="test-publishable";
  let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({message:"Invalid JWT",code:"bad_jwt"},{status:401});};
  try{
    await assert.rejects(requireUser(new Request("http://localhost/api/solve")),/Sign in/);assert.equal(requests,0);
    await assert.rejects(requireUser(new Request("http://localhost/api/solve",{headers:{authorization:"Bearer forged"}})),/expired/);
    await assert.rejects(requireUser(new Request("http://localhost/api/video/x/file",{headers:{cookie:"chalk-session=expired"}})),/expired/);
    assert.equal(requests,2);
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=oldKey;}
});
