"use client";
import {useEffect,useState} from "react";
import type {Session} from "@supabase/supabase-js";
import {getSupabaseClient} from "@/lib/supabase-client";
export default function AccountPanel({standalone=false,onImport}:{standalone?:boolean;onImport?:()=>void}) {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [mode,setMode]=useState<"signin"|"signup">("signin");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [name,setName]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [counts,setCounts]=useState<{notebooks:number;questions:number}|null>(null);
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
    Promise.all([
      client.from("notebooks").select("id",{count:"exact",head:true}).eq("user_id",session.user.id),
      client.from("question_pages").select("id",{count:"exact",head:true}).eq("user_id",session.user.id),
    ]).then(([books,pages])=>{if(alive&&!books.error&&!pages.error)setCounts({notebooks:books.count??0,questions:pages.count??0});});
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
        : await client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:`${window.location.origin}/`}});
      if(result.error)throw result.error;
      setPassword("");
      setMessage(result.data.session ? "Signed in." : "Check your email to confirm your account, then sign in.");
    } catch(error){setError(error instanceof Error ? error.message : "Sign-in failed. Try again.");}
    finally{setBusy(false);}
  }
  async function saveProfile(event:React.FormEvent) {
    event.preventDefault();if(!client || !session || busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const {error}=await client.from("profiles").upsert({id:session.user.id,display_name:name.trim(),updated_at:new Date().toISOString()});
      if(error)throw error;
      setMessage("Profile saved.");
    }catch(error){setError(error instanceof Error?error.message:"Your profile could not be saved.");}
    finally{setBusy(false);}
  }
  async function resendConfirmation(){
    if(!client || busy)return;
    if(!email.trim()){setError("Enter your email address first.");document.getElementById("account-email")?.focus();return;}
    setBusy(true);setError("");setMessage("");
    const {error}=await client.auth.resend({type:"signup",email:email.trim(),options:{emailRedirectTo:`${window.location.origin}/`}});
    if(error)setError(error.message);else setMessage("If your account needs confirmation, a new link is on its way. Use the newest email.");
    setBusy(false);
  }
  return <section className={`nb-section nb-account${standalone?" nb-account-standalone":""}`} aria-label="Account">
    <h2 className="nb-title">{session?"Your account":mode==="signin"?"Welcome back.":"Start your notebook."}</h2>
    {!session ? <p className="nb-note">{mode==="signin"?"Sign in to pick up where you left off.":"Create an account to save your questions and discoveries."}</p> : null}
    {!client ? <p role="status">Account connection is not configured.</p> : loading ? <p role="status">Loading account…</p> : session ? <>
      <div className="nb-account-identity"><span className="nb-account-avatar" aria-hidden="true">{(name.trim()||session.user.email||"C").slice(0,1).toUpperCase()}</span><div><strong>{name.trim()||"Chalk member"}</strong><p className="nb-note">{session.user.email}</p></div></div>
      <section className="nb-account-block"><h3>Profile</h3><p className="nb-note">How your name appears in your workspace.</p><form onSubmit={saveProfile}>
        <label className="nb-field" htmlFor="profile-name">Display name</label>
        <input id="profile-name" name="name" autoComplete="name" maxLength={80} value={name} onChange={e=>setName(e.target.value)} />
        <button className="nb-btn" disabled={busy}>Save profile{busy?"…":""}</button>
      </form></section>
      <section className="nb-account-block"><h3>Your workspace</h3><div className="nb-account-stats"><div><strong>{counts?.notebooks??"—"}</strong><span>Notebooks</span></div><div><strong>{counts?.questions??"—"}</strong><span>Questions</span></div></div><p className="nb-note">Your saved questions are connected to this account across devices.</p>{onImport ? <button type="button" className="nb-btn" onClick={onImport}>Import questions from this browser</button> : null}</section>
      <section className="nb-account-block"><h3>Account details</h3><dl className="nb-account-details"><dt>Email</dt><dd>{session.user.email_confirmed_at?"Verified":"Awaiting confirmation"}</dd><dt>Joined</dt><dd>{new Date(session.user.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</dd></dl></section>
      <section className="nb-account-block"><h3>Session</h3><p className="nb-note">Sign out of Chalk on this browser.</p><button type="button" className="nb-btn" disabled={busy} onClick={async()=>{setBusy(true);try{const {error}=await client.auth.signOut({scope:"local"});if(error)throw error;}catch(error){setError(error instanceof Error?error.message:"Sign-out failed.");}finally{setBusy(false);}}}>Sign out</button></section>
    </> : <>
      <form onSubmit={authenticate}>
        <label className="nb-field" htmlFor="account-email">Email address</label><input id="account-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" spellCheck={false} required value={email} onChange={e=>setEmail(e.target.value)} />
        <label className="nb-field" htmlFor="account-password">Password</label><div className="nb-password-field"><input id="account-password" name="password" type={showPassword?"text":"password"} placeholder={mode==="signup"?"At least 8 characters":"Enter your password"} autoComplete={mode==="signin"?"current-password":"new-password"} minLength={mode==="signup"?8:undefined} required value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(!showPassword)}>{showPassword?"Hide":"Show"}</button></div>
        <button className="nb-btn nb-btn-primary nb-account-submit" disabled={busy}>{mode==="signin"?"Sign in to Chalk":"Create account"}{busy?"…":""}</button>
      </form>
      <p className="nb-account-switch">{mode==="signin"?"New to Chalk?":"Already have an account?"} <button type="button" onClick={()=>{setMode(mode==="signin"?"signup":"signin");setError("");setMessage("");}}>{mode==="signin"?"Create an account":"Sign in"}</button></p>
      <button type="button" className="nb-account-resend" disabled={busy} onClick={resendConfirmation}>Resend confirmation email</button>
    </>}
    {message ? <p role="status" className="nb-note">{message}</p>:null}
    {error ? <p role="alert" className="nb-notice nb-warn">{error}</p>:null}
  </section>;
}
