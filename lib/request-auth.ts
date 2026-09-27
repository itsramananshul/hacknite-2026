import {createClient} from "@supabase/supabase-js";
import {RouteError} from "./gemini";
export const SESSION_COOKIE="chalk-session";
export async function requireUser(request:Request) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url || !key)throw new RouteError(503,"auth_not_configured","Sign-in is not configured on this server.");
  const bearer=request.headers.get("authorization");
  const cookie=request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  const token=bearer?.startsWith("Bearer ") ? bearer.slice(7) : cookie;
  if(!token)throw new RouteError(401,"sign_in_required","Sign in to use Chalk.");
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error || !data.user)throw new RouteError(401,"invalid_session","Your session has expired. Sign in again.");
  return {user:data.user,token};
}
