import {getSupabaseClient} from "./supabase-client";
export async function authFetch(input:RequestInfo|URL,init:RequestInit={}) {
  const {data}=await getSupabaseClient()!.auth.getSession();
  if(!data.session)throw new Error("Sign in to use Chalk.");
  const headers=new Headers(init.headers);headers.set("Authorization",`Bearer ${data.session.access_token}`);
  const response=await fetch(input,{...init,headers});
  if(response.status!==401)return response;
  const refreshed=await getSupabaseClient()!.auth.refreshSession();
  if(refreshed.error || !refreshed.data.session)return response;
  headers.set("Authorization",`Bearer ${refreshed.data.session.access_token}`);
  return fetch(input,{...init,headers});
}
