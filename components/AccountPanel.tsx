"use client";
import {useEffect,useState} from "react";
import type {Session} from "@supabase/supabase-js";
import {getSupabaseClient} from "@/lib/supabase-client";
export default function AccountPanel() {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [mode,setMode]=useState<"signin"|"signup">("signin");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const client=getSupabaseClient();
  useEffect(()=>{
    if(!client){setLoading(false);return;}
    let alive=true;
    client.auth.getSession().then(({data,error})=>{if(alive){setSession(data.session);setLoading(false);if(error)setError(error.message);}});
    const {data}=client.auth.onAuthStateChange((_event,next)=>{setSession(next);setLoading(false);setPassword("");});
    return()=>{alive=false;data.subscription.unsubscribe();};
  },[client]);
  useEffect(()=>{
    if(!client || !session) return;
    let alive=true;
    client.from("profiles").select("display_name").eq("id",session.user.id).maybeSingle().then(({data,error})=>{
      if(!alive)return;
      if(error){setError(error.message);return;}
      setName(data?.display_name ?? "");
      if(!data) client.from("profiles").upsert({id:session.user.id,display_name:""},{onConflict:"id",ignoreDuplicates:true}).then(({error})=>{if(alive && error)setError(error.message);});
    });
    return()=>{alive=false;};
  },[client,session]);
  async function authenticate(event:React.FormEvent) {
    event.preventDefault();if(!client || busy)return;
    setBusy(true);setError("");setMessage("");
    try {
      const result=mode==="signin" ? await client.auth.signInWithPassword({email:email.trim(),password})
        : await client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:window.location.origin}});
      if(result.error)throw result.error;
      setPassword("");
      setMessage(result.data.session ? "Signed in." : "Check your email to confirm your account, then sign in.");
    } catch(error){setError(error instanceof Error ? error.message : "Sign-in failed. Try again.");}
    finally{setBusy(false);}
  }
  async function saveProfile(event:React.FormEvent) {
    event.preventDefault();if(!client || !session || busy)return;
    setBusy(true);setError("");setMessage("");
    const {error}=await client.from("profiles").upsert({id:session.user.id,display_name:name.trim(),updated_at:new Date().toISOString()});
    if(error)setError(error.message);else setMessage("Profile saved.");
    setBusy(false);
  }
  return <section className="nb-section" aria-label="Account">
    <h2 className="nb-title">Your account</h2>
    {!client ? <p role="status">Account connection is not configured.</p> : loading ? <p role="status">Loading account…</p> : session ? <>
      <p className="nb-note">Signed in as {session.user.email}</p>
      <form onSubmit={saveProfile}>
        <label className="nb-field" htmlFor="profile-name">Display name</label>
        <input id="profile-name" name="name" autoComplete="name" maxLength={80} value={name} onChange={e=>setName(e.target.value)} />
        <button className="nb-btn" disabled={busy}>Save profile{busy?"…":""}</button>
      </form>
      <button type="button" className="nb-btn" disabled={busy} onClick={async()=>{setBusy(true);const {error}=await client.auth.signOut();if(error)setError(error.message);setBusy(false);}}>Sign out</button>
    </> : <>
      <div className="nb-modes"><button type="button" className="nb-seg" aria-pressed={mode==="signin"} onClick={()=>setMode("signin")}>Sign in</button><button type="button" className="nb-seg" aria-pressed={mode==="signup"} onClick={()=>setMode("signup")}>Create account</button></div>
      <form onSubmit={authenticate}>
        <label className="nb-field" htmlFor="account-email">Email</label><input id="account-email" name="email" type="email" autoComplete="email" spellCheck={false} required value={email} onChange={e=>setEmail(e.target.value)} />
        <label className="nb-field" htmlFor="account-password">Password</label><input id="account-password" name="password" type="password" autoComplete={mode==="signin"?"current-password":"new-password"} minLength={mode==="signup"?8:undefined} required value={password} onChange={e=>setPassword(e.target.value)} />
        <button className="nb-btn nb-btn-primary" disabled={busy}>{mode==="signin"?"Sign in":"Create account"}{busy?"…":""}</button>
      </form>
    </>}
    {message ? <p role="status" className="nb-note">{message}</p>:null}
    {error ? <p role="alert" className="nb-notice nb-warn">{error}</p>:null}
  </section>;
}
