"use client";
import AccountPanel from "./AccountPanel";
export default function AuthScreen({checking,verifying,error}:{checking:boolean;verifying:boolean;error:string}){
  return <main className="nb-app nb-auth">
    <header className="nb-auth-header"><span className="nb-wordmark">Chalk</span><span className="nb-auth-caption">A notebook for the curious.</span></header>
    <div className="nb-auth-layout">
      <section className="nb-auth-intro" aria-labelledby="auth-intro-title">
        <p className="nb-eyebrow">Physics · Chemistry · Mathematics</p>
        <h1 id="auth-intro-title">Understand the<br />why behind<br /><em>the answer.</em></h1>
        <p className="nb-auth-description">Bring a question. Work through the reasoning, explore the simulation, and keep it all in your notebook.</p>
        <div className="nb-auth-paper" aria-hidden="true">
          <span className="nb-auth-paper-label">A little curiosity goes a long way.</span>
          <span className="nb-auth-equation">x(t) = v₀t + ½at²</span>
          <div className="nb-auth-curve"><span /><span /><span /><span /><span /><span /><span /></div>
          <span className="nb-auth-paper-note">Change a variable. See what happens.</span>
        </div>
      </section>
      <section className="nb-auth-entry" aria-label="Sign in to Chalk">
        {checking ? <p role="status">Checking your session…</p> : <AccountPanel standalone />}
        {verifying && !error ? <p role="status" className="nb-note">Opening your notebook…</p> : null}
        {error ? <p role="alert" className="nb-notice nb-warn">{error}</p> : null}
      </section>
    </div>
  </main>;
}
