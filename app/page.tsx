"use client";
import {authFetch} from "@/lib/auth-fetch";

import dynamic from "next/dynamic";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NotebookLibrary from "@/components/NotebookLibrary";
import AccountPanel from "@/components/AccountPanel";
import AuthScreen from "@/components/AuthScreen";
import {getSupabaseClient} from "@/lib/supabase-client";
import {accountStorage,loadCloudLibrary,flushCloud,queueNotebooks,queuePage,readPending} from "@/lib/cloud-notebooks";
import {EMPTY_LIBRARY, contentSignature, initialNotebook, readLibrary, writeLibrary, upsertPage, renameNotebook, type Library, type Subject} from "@/lib/notebooks";
import InputPanel, { type SolveResult } from "@/components/InputPanel";
import ExplanationVideo from "@/components/ExplanationVideo";
import StepsPanel, { activeStepIndex } from "@/components/StepsPanel";
import Timeline from "@/components/Timeline";
import VariableSliders from "@/components/VariableSliders";
import { compileScene } from "@/lib/expressions";
import {localParameterEdit} from "@/lib/local-edit";
import { presetList, presets, type PresetKey } from "@/lib/presets";
import type { SceneScript } from "@/lib/schema";
import { validateSceneScript } from "@/lib/validate";

const SceneCanvas = dynamic(() => import("@/components/SceneCanvas"), {
  ssr: false,
  loading: () => <div className="nb-stage nb-stage-loading">Loading the 3D board.</div>,
});

interface Prepared {
  scene: SceneScript;
  compiled: ReturnType<typeof compileScene>;
  warnings: string[];
  error: null;
}

interface Broken {
  scene: null;
  compiled: null;
  warnings: string[];
  error: string;
}

function initialValues(scene: SceneScript): Record<string, number> {
  return Object.fromEntries(scene.variables.map((variable) => [variable.name, variable.value]));
}

function prepare(scene: SceneScript): Prepared | Broken {
  try {
    const result = validateSceneScript(scene);
    return {
      scene: result.scene,
      compiled: compileScene(result.scene),
      warnings: result.warnings,
      error: null,
    };
  } catch (error) {
    return {
      scene: null,
      compiled: null,
      warnings: [],
      error: error instanceof Error ? error.message : "This scene could not be prepared.",
    };
  }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function firstSentence(text: string): string {
  const cut = text.search(/[.!?](\s|$)/);
  return cut >= 0 ? text.slice(0, cut + 1) : text;
}

function cancelSpeech(): void {
  if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
    window.speechSynthesis.cancel();
  }
}

function digits(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function IconProblem() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M5 3.5h7.5L16 7v9.5H5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 3.5V7h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10.5h6M7.5 13.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconDerivation() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M4 6.5h12M4 10h8M4 13.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15.5" cy="10" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconVariables() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M3.5 6.5h13M3.5 13.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="6.5" r="2.1" fill="#FCFBF8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="13.5" r="2.1" fill="#FCFBF8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function Page() {
  const [accountId,setAccountId] = useState<string|null|undefined>(undefined);
  const accountRef=useRef<string|null|undefined>(undefined);
  const [sessionReady,setSessionReady]=useState(false);
  const [sessionError,setSessionError]=useState("");
  const [cloudStatus,setCloudStatus]=useState("");
  const [cloudRetry,setCloudRetry]=useState(0);
  const cloudBusy=useRef(false);
  const lastLibrary=useRef<Library>(EMPTY_LIBRARY);
  useEffect(()=>{
    const client=getSupabaseClient();
    if(!client){accountRef.current=null;setAccountId(null);return;}
    let alive=true,eventReceived=false;
    const change=(id:string|null)=>{if(!alive || accountRef.current===id)return;accountRef.current=id;setLibraryReady(false);setSessionReady(false);setAccountId(id);};
    client.auth.getSession().then(({data,error})=>{if(!eventReceived){change(data.session?.user.id ?? null);if(error && alive)setCloudStatus("Could not restore sign-in. Your guest pages remain on this browser.");}});
    const {data}=client.auth.onAuthStateChange((_event,session)=>{eventReceived=true;change(session?.user.id ?? null);});
    return()=>{alive=false;data.subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    let alive=true;
    const client=getSupabaseClient();if(!client)return;
    const sync=async()=>{
      if(!accountId){await fetch("/api/session",{method:"DELETE"});return;}
      try{const response=await authFetch("/api/session",{method:"POST"});if(!response.ok)throw new Error("Sign-in could not be verified. Please sign out and sign in again.");if(alive){setSessionError("");setSessionReady(true);}}
      catch(error){if(alive){setSessionReady(false);setSessionError(describe(error,"Sign-in failed."));}}
    };
    void sync();
    const {data}=client.auth.onAuthStateChange(event=>{if(event==="TOKEN_REFRESHED")setTimeout(()=>void sync(),0);});
    return()=>{alive=false;data.subscription.unsubscribe();};
  },[accountId]);
  const [library,setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [notebookId,setNotebookId] = useState("physics");
  const notebookRef = useRef("physics");
  const [libraryReady,setLibraryReady] = useState(false);
  const [libraryOpen,setLibraryOpen] = useState(false);
  const [accountOpen,setAccountOpen] = useState(false);
  const [storageError,setStorageError] = useState<string|null>(null);
  const activeNotebook = library.notebooks.find(n=>n.id===notebookId) ?? library.notebooks[0] ?? {id:"",name:"Notebooks",subject:"physics" as Subject};
  const pendingValues = useRef<Record<string,number>|null>(null);
  const [presetKey, setPresetKey] = useState<PresetKey>("projectile");
  const [scene, setScene] = useState<SceneScript | null>(() => presets.projectile);
  const [solution, setSolution] = useState("");
  const [questionPage,setQuestionPage] = useState<{
    id:string; notebookId?:string; problemText:string; status:"solving"|"building"|"ready"|"error"|"answer-only";
    answers:Omit<SolveResult,"scene">|null; error:string|null;
  }|null>(null);
  const activeQuestion = useRef<string|null>(null);
  const generatingHere = useRef<string|null>(null);
  const savedPageSignature = useRef("");
  const [restoredInput,setRestoredInput] = useState({version:0,text:""});
  useEffect(()=>{
    if(accountId===undefined)return;
    let alive=true;
    const cache=accountStorage(localStorage,accountId);
    const client=getSupabaseClient();
    activeQuestion.current=null;
    generatingHere.current=null;savedPageSignature.current="";
    setQuestionPage(null);
    setScene(presets.projectile);
    setSolution("");setPlaying(false);setProblemOpen(false);
    setRestoredInput(previous=>({version:previous.version+1,text:""}));
    const restore=(preserveView=false)=>{
      if(!alive)return;
      const id=new URL(window.location.href).searchParams.get("page");
      if(!id){
        activeQuestion.current=null;setQuestionPage(null);setScene(presets.projectile);setSolution("");setPlaying(false);
        setRestoredInput(previous=>({version:previous.version+1,text:""}));return;
      }
      if(activeQuestion.current===id)return;
      try {
        const raw=cache.getItem(`chalk-page:${id}`) ?? (accountId===null ? sessionStorage.getItem(`chalk-page:${id}`) : null);
        if(!raw){setNotice("This page is not available in this account. Open Your notebooks to choose a saved page.");return;}
        const saved=JSON.parse(raw);
        if(saved.questionPage?.id!==id || typeof saved.questionPage.problemText!=="string")return;
        const restoredScene=saved.scene ? validateSceneScript(saved.scene).scene : null;
        activeQuestion.current=id;
        const book=saved.questionPage.notebookId ?? "physics";
        notebookRef.current=book;setNotebookId(book);pendingValues.current=saved.values ?? null;
        if(!preserveView){setLibraryOpen(false);setLeftView("problem");}
        const restoredValues=saved.values ?? (restoredScene ? initialValues(restoredScene) : {});
        savedPageSignature.current=contentSignature({questionPage:saved.questionPage,scene:restoredScene,solution:saved.solution ?? "",values:restoredValues});
        setValues(restoredValues);
        setQuestionPage(saved.questionPage);
        setScene(restoredScene);setSolution(typeof saved.solution==="string" ? saved.solution : "");setPlaying(false);
        if(!preserveView){setPredict(false);setView("simulation");setSelected(null);setShareUrl("");setShareStatus("");}
        setNotice(null);setEditError(null);
        setRestoredInput(previous=>({version:previous.version+1,text:saved.questionPage.problemText}));
      } catch {setStorageError("This saved page could not be opened.");}
    };
    async function load(){
      let loaded:Library;
      try{loaded=readLibrary(cache);}catch{loaded=structuredClone(EMPTY_LIBRARY);setStorageError("Browser storage is unavailable. Keep this tab open.");}
      if(accountId && client){
        setCloudStatus("Loading your cloud notebooks…");
        try{loaded=await loadCloudLibrary(client,accountId,cache);if(alive)setCloudStatus("Cloud notebooks connected.");}
        catch(error){if(alive)setCloudStatus(`Cloud connection failed. Cached pages are available; uploads will retry. ${describe(error,"Try again.")}`);}
      } else setCloudStatus("Saved on this browser. Sign in to save new pages to your account.");
      if(!alive)return;
      lastLibrary.current=loaded;setLibrary(loaded);
      const selected=cache.getItem("chalk-active-notebook");
      const book=initialNotebook(loaded,selected);
      notebookRef.current=book;setNotebookId(book);
      restore();setLibraryReady(true);
      if(!new URL(window.location.href).searchParams.has("page") && loaded.pages.length)setLibraryOpen(true);
    }
    void load();
    const syncLibrary=(event:StorageEvent)=>{
      const key=accountId ? `chalk-account:${accountId}:chalk-library:v1` : "chalk-library:v1";
      if(event.key===key){try{const loaded=readLibrary(cache);lastLibrary.current=loaded;setLibrary(loaded);}catch{ /* Current library stays available. */ }}
    };
    let refreshing=false;
    const refreshRemote=async()=>{
      if(!accountId || !client || refreshing || !alive || cloudBusy.current)return;
      refreshing=true;
      const id=new URL(window.location.href).searchParams.get("page");
      const signatureOf=(raw:string|null)=>raw ? contentSignature(JSON.parse(raw)) : "";
      try{
        const before=id ? signatureOf(cache.getItem(`chalk-page:${id}`)) : "";
        const loaded=await loadCloudLibrary(client,accountId,cache);
        if(!alive || accountRef.current!==accountId)return;
        if(JSON.stringify(lastLibrary.current)!==JSON.stringify(loaded)){lastLibrary.current=loaded;setLibrary(loaded);}
        if(id && generatingHere.current!==id && before!==signatureOf(cache.getItem(`chalk-page:${id}`))){
          activeQuestion.current=null;restore(true);
        }
      }catch(error){if(alive)setCloudStatus(`Cloud refresh failed. Cached pages are available. ${describe(error,"Try again.")}`);}
      finally{refreshing=false;}
    };
    const refreshVisible=()=>{if(document.visibilityState==="visible")void refreshRemote();};
    const remoteTimer=window.setInterval(refreshVisible,10000);
    window.addEventListener("focus",refreshVisible);window.addEventListener("online",refreshVisible);
    document.addEventListener("visibilitychange",refreshVisible);
    const restoreOnNavigation=()=>restore();
    window.addEventListener("popstate",restoreOnNavigation);window.addEventListener("storage",syncLibrary);
    return()=>{alive=false;window.clearInterval(remoteTimer);window.removeEventListener("focus",refreshVisible);window.removeEventListener("online",refreshVisible);document.removeEventListener("visibilitychange",refreshVisible);window.removeEventListener("popstate",restoreOnNavigation);window.removeEventListener("storage",syncLibrary);};
  },[accountId]);
  const [values, setValues] = useState<Record<string, number>>(() => initialValues(presets.projectile));
  useEffect(()=>{
    if(!libraryReady || accountId===undefined || accountRef.current!==accountId || !questionPage) return;
    try {
      const cache=accountStorage(localStorage,accountId);
      const payload={questionPage,scene,solution,values};
      const signature=contentSignature(payload);
      if(signature===savedPageSignature.current)return;
      cache.setItem(`chalk-page:${questionPage.id}`,JSON.stringify(payload));
      savedPageSignature.current=signature;
      const entry={id:questionPage.id,notebookId:questionPage.notebookId ?? "physics",
        title:scene?.title ?? (questionPage.problemText.slice(0,120) || "Problem from a photo"),
        status:questionPage.status,updatedAt:new Date().toISOString()};
      const notebook=library.notebooks.find(n=>n.id===entry.notebookId);
      if(accountId && notebook)queuePage(cache,entry,payload,notebook);
      setLibrary(previous=>upsertPage(previous,entry));
      setStorageError(null);
    } catch {setStorageError("This page could not be saved. Browser storage may be full; keep this tab open.");}
  },[libraryReady,accountId,questionPage,scene,solution,values]);
  useEffect(()=>{
    if(!libraryReady || accountId===undefined || accountRef.current!==accountId) return;
    try {const cache=accountStorage(localStorage,accountId);
      if(accountId)queueNotebooks(cache,lastLibrary.current,library);
      writeLibrary(cache,library);cache.setItem("chalk-active-notebook",notebookId);lastLibrary.current=library;}
    catch {setStorageError("Notebook changes could not be saved in browser storage.");}
  },[libraryReady,accountId,library,notebookId]);
  useEffect(()=>{
    if(!libraryReady || !accountId)return;
    const client=getSupabaseClient();if(!client)return;
    let alive=true;
    const cache=accountStorage(localStorage,accountId);
    const timer=window.setTimeout(async()=>{
      if(cloudBusy.current || accountRef.current!==accountId)return;
      const pending=readPending(cache);
      if(!Object.keys(pending.notebooks).length && !Object.keys(pending.pages).length)return;
      cloudBusy.current=true;setCloudStatus("Saving to your account…");
      try{await flushCloud(client,accountId,cache,()=>accountRef.current===accountId);
        if(accountRef.current===accountId){const remaining=readPending(cache);setCloudStatus(Object.keys(remaining.pages).length || Object.keys(remaining.notebooks).length ? "New changes are waiting to upload…" : "Saved to your account.");}}
      catch(error){if(accountRef.current===accountId)setCloudStatus(`Not uploaded yet. Your changes are saved on this device. ${describe(error,"Connection failed.")}`);}
      finally{cloudBusy.current=false;}
    },700);
    const retry=()=>setCloudRetry(n=>n+1);
    const interval=window.setInterval(retry,10000);
    window.addEventListener("online",retry);
    return()=>{alive=false;window.clearInterval(interval);window.clearTimeout(timer);window.removeEventListener("online",retry);};
  },[libraryReady,accountId,library,cloudRetry]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<"simulation" | "video">("simulation");
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(true);
  const [shots, setShots] = useState(true);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [leftView,setLeftView] = useState<"problem"|"derivation"|"prediction"|"variables">("problem");
  const [playbackRevision,setPlaybackRevision] = useState(0);
  const [predict, setPredict] = useState(false);
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);

  const playingState = useRef(playing);
  playingState.current = playing;

  const sharedClock = useRef(0);
  useEffect(() => {
    const loadSharedScene = () => {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get("scene");
    if (!encoded || encoded.length > 30000) return;
    try {
      const decoded = decompressFromEncodedURIComponent(encoded);
      if (!decoded || decoded.length > 100000) throw new Error("Invalid shared scene");
      const shared = validateSceneScript(JSON.parse(decoded)).scene;
      setPlaying(false);
      setTime(0);
      sharedClock.current = 0;

      setPredict(false);
      setScene(shared);
      activeQuestion.current=null;
      setQuestionPage(null);
      setNotice("Shared scene loaded. Press play to explore it.");
    } catch {
      setNotice("This shared scene could not be loaded. The presets are available.");
    }
    };
    loadSharedScene();
    window.addEventListener("hashchange", loadSharedScene);
    return () => window.removeEventListener("hashchange", loadSharedScene);
  }, []);
  const prepared = useMemo<Prepared|Broken>(() => scene ? prepare(scene) : {scene:null,compiled:null,warnings:[],error:""}, [scene]);
  const live = prepared.scene;
  const compiled = prepared.compiled;
  const steps = useMemo(() => live?.steps ?? [], [live]);
  const duration = live?.duration ?? 1;

  const answers = useMemo(() => {
    if (!compiled) return [];
    try {
      return compiled.answerValues(values);
    } catch {
      return [];
    }
  }, [compiled, values]);

  const index = useMemo(() => activeStepIndex(steps, time), [steps, time]);
  const step = index >= 0 ? steps[index] : null;
  const narration = step?.narration ?? "";
  const shot = shots && !manual && step?.camera ? step.camera : null;
  const chosen = selected !== null ? steps[selected] : null;
  const focus = chosen ?? step;
  const highlight = focus ? { objects: focus.focus, vectors: focus.showVectors } : null;

  const target = useMemo(() => {
    if (!live) return null;
    for (let position = 0; position < live.answers.length; position += 1) {
      if (Number.isFinite(answers[position])) {
        return { position, question: live.answers[position].question, unit: live.answers[position].unit };
      }
    }
    return null;
  }, [live, answers]);

  const guessNumber = Number.parseFloat(guess);
  const actual = target ? answers[target.position] : Number.NaN;
  const openGuess = predict && Number.isFinite(guessNumber) && Number.isFinite(actual);
  const close = openGuess && Math.abs(guessNumber - actual) <= Math.max(Math.abs(actual) * 0.02, 0.01);
  const finished = time >= duration - 1e-3;
  const canReveal = revealed || finished;
  const answersHidden = predict && !canReveal;
  const guessMissing = predict && !canReveal && !Number.isFinite(guessNumber);

  const [narrationReady, setNarrationReady] = useState(false);
  useEffect(() => {
    if (typeof window.speechSynthesis === "undefined") return;
    const speech = window.speechSynthesis;
    const update = () => setNarrationReady(speech.getVoices().length > 0);
    update();
    speech.addEventListener("voiceschanged", update);
    return () => speech.removeEventListener("voiceschanged", update);
  }, []);

  useEffect(() => {
    if (!live) return;
    const restored=pendingValues.current;
    pendingValues.current=null;
    const defaults=initialValues(live);
    if(restored) for(const variable of live.variables){const value=restored[variable.name];if(Number.isFinite(value) && value>=variable.min && value<=variable.max) defaults[variable.name]=value;}
    setValues(defaults);
    setTime(0);
    setPlaying(false);
    setManual(false);
    setSelected(null);


    setGuess("");
    setRevealed(false);
  }, [live]);

  useEffect(() => {
    setManual(false);
  }, [index]);

  useEffect(() => {
    if (muted || !playing || narration.length === 0) {
      cancelSpeech();
      return;
    }
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.rate = 0.99;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return cancelSpeech;
  }, [muted, playing, narration]);

  const resetPrediction = useCallback(() => {
    setGuess("");
    setRevealed(false);
  }, []);

  const handleTime = useCallback((next: number) => {
    if (!playingState.current) return;
    setTime((previous) => (Math.abs(previous - next) < 1e-4 ? previous : next));
  }, []);

  const handleComplete = useCallback(() => {
    setTime(duration);
    setPlaying(false);
  }, [duration]);

  const handleLoop = useCallback(() => {
    if (live?.loop) setRevealed(true);
  }, [live]);

  const seek = useCallback((next: number) => {
    setPlaying(false);
    setManual(false);
    setTime(Math.min(Math.max(next, 0), duration));
  }, [duration]);

  const reset = useCallback(() => {
    setPlaying(false);
    setManual(false);
    setTime(0);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((previous) => {
      if (previous) return false;
      if (guessMissing) return false;
      if (time >= duration - 1e-3) setTime(0);
      return true;
    });
  }, [time, duration, guessMissing]);

  const togglePredict = useCallback(() => {
    const next = !predict || leftView!=="prediction" || libraryOpen || accountOpen;
    setPredict(next);
    setLeftView(next ? "prediction" : "problem");
    setLibraryOpen(false);
    setAccountOpen(false);
    if (next) {
      setView("simulation");
      sharedClock.current=0;
      setPlaybackRevision(previous=>previous+1);
      setPlaying(false);
      setManual(false);
      setTime(0);
      setGuess("");
      setRevealed(false);
    }
  }, [predict,leftView,libraryOpen,accountOpen]);

  const changeValue = useCallback(
    (name: string, value: number) => {
      setValues((previous) => ({ ...previous, [name]: value }));
      setTime(0);
      sharedClock.current=0;
      setPlaybackRevision(previous=>previous+1);
      setManual(false);
      setPlaying(true);
      resetPrediction();
    },
    [resetPrediction],
  );

  const highlightStep = useCallback(
    (position: number) => {
      setSelected((previous) => (previous === position ? null : position));
      const targetStep = steps[position];
      if (targetStep) seek(targetStep.tStart);
    },
    [steps, seek],
  );

  const selectPreset = useCallback((key: PresetKey) => {
    activeQuestion.current=null;
    setQuestionPage(null);
    const url=new URL(window.location.href);
    url.searchParams.delete("page");
    url.hash="";
    window.history.replaceState(null,"",url);
    setPresetKey(key);
    setScene(presets[key]);
    setNotice(null);
    setSolution("");
    setEditError(null);
  }, []);

  const reloadPreset = useCallback(() => {
    setScene(presets[presetKey] ?? presets.projectile);
    setNotice("The preset is back on the board. The numbers, the steps and the answers are unchanged.");
  }, [presetKey]);

  const openProblem = useCallback(() => {
    setLeftView("problem");
    setLibraryOpen(false);
    setAccountOpen(false);
    setProblemOpen(true);
    requestAnimationFrame(() => document.getElementById("chalk-problem")?.focus());
  }, []);

  const handleStarted = useCallback((problemText:string) => {
    if(!libraryReady)throw new Error("Your notebooks are still loading. Please try again in a moment.");
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
    activeQuestion.current=id;
    generatingHere.current=id;savedPageSignature.current="";
    setLeftView("problem");
    setLibraryOpen(false);
    setProblemOpen(false);
    setQuestionPage({id,notebookId:notebookRef.current,problemText,status:"solving",answers:null,error:null});
    setScene(null);
    setSolution("");
    setPlaying(false);
    cancelSpeech();
    setTime(0);
    sharedClock.current=0;

    setPredict(false);
    setSelected(null);
    setValues({});
    setEditText("");
    setEditError(null);
    setNotice(null);
    setShareUrl("");
    setShareStatus("");
    setView("simulation");
    const url=new URL(window.location.href);
    url.searchParams.set("page",id);
    url.hash="nb-problem";
    window.history.pushState(null,"",url);
    requestAnimationFrame(()=>{
      const heading=document.getElementById("question-page-title");
      heading?.focus({preventScroll:true});
      document.querySelector(".nb-notebook")?.scrollTo({top:0});
      document.querySelector(".nb-workspace")?.scrollTo({top:0});
    });
    return id;
  },[libraryReady]);

  const handleAnswers = useCallback((result:Omit<SolveResult,"scene">,id:string)=>{
    if(activeQuestion.current!==id) return;
    setSolution(result.solutionText);
    setQuestionPage(previous=>previous?.id===id ? {...previous,status:"building",answers:result} : previous);
  },[]);

  const handleFailed = useCallback((error:string,id:string)=>{
    if(activeQuestion.current!==id) return;
    generatingHere.current=null;
    setQuestionPage(previous=>previous?.id===id ? {...previous,status:"error",error} : previous);
  },[]);

  const handleSolved = useCallback((result: SolveResult,id:string) => {
    if(activeQuestion.current!==id) return;
    generatingHere.current=null;
    setQuestionPage(previous=>previous?.id===id ? {...previous,status:result.scene?"ready":"answer-only",answers:result} : previous);
    setSolution(result.solutionText);
    if (result.scene) {
      setScene(result.scene);
      setNotice(
        result.warnings.length > 0
          ? `The scene is on the board with a warning: ${result.warnings.join(" ")}`
          : "Your problem is on the board, paused at the start.",
      );
      return;
    }
    setNotice(
      "Your answer is in this notebook. A simulation could not be generated for this problem.",
    );
  }, []);

  const runEdit = useCallback(async () => {
    const instruction = editText.trim();
    if (!scene || instruction.length === 0 || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const currentScene={...scene,variables:scene.variables.map(variable=>({...variable,value:values[variable.name] ?? variable.value}))};
      const immediate=localParameterEdit(currentScene,instruction);
      if(immediate){
        const nextValues=initialValues(immediate.scene);
        setValues(nextValues);setTime(0);sharedClock.current=0;setPlaybackRevision(previous=>previous+1);setPlaying(true);
        setSolution(immediate.solutionText);setEditText("");setNotice("Updated instantly using the existing equations.");
        return;
      }
      const response = await authFetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene:{...scene,variables:scene.variables.map(variable=>({...variable,value:values[variable.name] ?? variable.value}))}, instruction }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `The service answered ${response.status}.`;
        throw new Error(message);
      }
      const result = payload as SolveResult;
      if (result.scene) {
        setScene(result.scene);
        setNotice(
          result.warnings.length > 0
            ? `The change is on the board with a warning: ${result.warnings.join(" ")}`
            : "The change is on the board, paused at the start.",
        );
      } else {
        setNotice("That change could not be turned into a scene, so the board is unchanged.");
      }
      if (result.solutionText) setSolution(result.solutionText);
      setEditText("");
    } catch (error) {
      setEditError(describe(error, "The change could not be applied."));
    } finally {
      setEditBusy(false);
    }
  }, [editText, editBusy, scene, values]);

  const blurb =
    (questionPage && !live ? questionPage.problemText || "A problem from your photo." : "") ||
    firstSentence(live?.problemText?.trim() || "") ||
    presetList.find((item) => item.key === presetKey)?.blurb ||
    "Explore a projectile launched from a cliff.";



  const share = async () => {
    if (!live || !compiled) return;
    try {
      const sharedValues = values;
      const evaluated = compiled.answerValues(sharedValues);
      const shared = validateSceneScript({ ...live,
        variables: live.variables.map((variable) => ({ ...variable, value: sharedValues[variable.name] ?? variable.value })),
        answers: live.answers.map((answer, index) => ({ ...answer, value: evaluated[index] })),
      }).scene;
      const encoded = compressToEncodedURIComponent(JSON.stringify(shared));
      if (encoded.length > 30000) throw new Error("This scene is too large for a share link.");
      const url = new URL(window.location.href);
      url.hash = `scene=${encoded}`;
      setShareUrl(url.toString());
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url.toString());
          setShareStatus("Link copied");
          setShareUrl("");
          return;
        } catch { /* Clipboard permissions vary; expose the same link below. */ }
      }
      setShareStatus("Select and copy your link");
    } catch {
      setShareStatus("Could not copy the link");
    }
  };

  const answerRows = (rows: number[]) =>
    (live?.answers ?? []).map((answer, position) => (
      <div className="nb-result" key={answer.question}>
        <dt>{answer.question}</dt>
        <dd className="num">
          {Number.isFinite(rows[position]) ? rows[position].toFixed(3) : "not available"}
          {answer.unit ? ` ${answer.unit}` : ""}
        </dd>
      </div>
    ));

  const importGuestPages=()=>{
    if(!accountId || !libraryReady)return;
    try{
      const guest=readLibrary(localStorage);
      if(!guest.pages.length){setCloudStatus("There are no guest pages to import on this browser.");return;}
      const cache=accountStorage(localStorage,accountId);
      const importedBooks=guest.notebooks.map(n=>({...n,id:`import-${n.id}`.slice(0,100)}));
      let next={...library,notebooks:[...library.notebooks,...importedBooks.filter(n=>!library.notebooks.some(book=>book.id===n.id))]};
      let count=0;
      for(const entry of guest.pages){
        if(next.pages.some(p=>p.id===entry.id))continue;
        const raw=localStorage.getItem(`chalk-page:${entry.id}`) ?? sessionStorage.getItem(`chalk-page:${entry.id}`);
        if(!raw)continue;
        const payload=JSON.parse(raw);
        if(payload.questionPage?.id!==entry.id)continue;
        if(payload.scene)validateSceneScript(payload.scene);
        const notebook=importedBooks.find(n=>n.id===`import-${entry.notebookId}`.slice(0,100));
        if(!notebook)continue;
        payload.questionPage.notebookId=notebook.id;
        const importedEntry={...entry,notebookId:notebook.id,updatedAt:new Date().toISOString()};
        cache.setItem(`chalk-page:${entry.id}`,JSON.stringify(payload));queuePage(cache,importedEntry,payload,notebook);
        next=upsertPage(next,importedEntry);count++;
      }
      queueNotebooks(cache,library,next);writeLibrary(cache,next);setLibrary(next);
      setCloudStatus(`${count} pages imported. Saving to your account…`);
      const id=new URL(window.location.href).searchParams.get("page");
      if(id && next.pages.some(p=>p.id===id)){activeQuestion.current=null;window.dispatchEvent(new PopStateEvent("popstate"));}
    }catch(error){setCloudStatus(`Import could not finish. Guest pages remain unchanged. ${describe(error,"Try again.")}`);}
  };

  const createNotebook=(name:string,subject:Subject)=>{const id=`notebook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;setLibrary(previous=>({...previous,notebooks:[...previous.notebooks,{id,name:name.trim(),subject}]}));notebookRef.current=id;setNotebookId(id);};
  if(!accountId || !sessionReady || !libraryReady)return <AuthScreen checking={accountId===undefined} verifying={Boolean(accountId)} error={sessionError} />;
  if(!library.notebooks.length)return <div className="nb-app"><header className="nb-header"><span className="nb-wordmark">Chalk</span><div className="nb-header-actions"><button type="button" className="nb-btn nb-btn-ghost" onClick={()=>setAccountOpen(!accountOpen)}>Account</button></div></header><main className="nb-library-onboarding">{accountOpen ? <AccountPanel onImport={importGuestPages}/> : <NotebookLibrary library={library} activeId="" cloud onSelect={()=>{}} onRename={()=>{}} onCreate={createNotebook} onOpen={()=>{}}/>}{cloudStatus ? <p className="nb-note" role="status">{cloudStatus}</p> : null}</main></div>;
  return (
    <div className="nb-app">
      <header className="nb-header">
        <div className="nb-brand">
          <span className="nb-wordmark">Chalk</span>
        </div>
        <span className="nb-header-divider" aria-hidden="true" />
        <div className="nb-crumbs">
          <button type="button" className="nb-notebook-switch" onClick={()=>{setLibraryOpen(!libraryOpen);setAccountOpen(false);}} aria-expanded={libraryOpen}>{activeNotebook.name}</button>
          <span className="nb-topic">{live?.title ?? (questionPage ? "New physics problem" : "Physics notebook")}</span>
        </div>
        <div className="nb-header-actions">
          <button type="button" className="nb-btn nb-btn-ghost" aria-expanded={accountOpen} onClick={()=>{setAccountOpen(!accountOpen);setLibraryOpen(false);}}>Account</button>
          <button type="button" className="nb-btn nb-btn-ghost" aria-expanded={problemOpen} aria-controls="nb-compose" onClick={openProblem}>
            New page
          </button>
          <button type="button" className="nb-btn nb-btn-primary" onClick={share} disabled={!live}>
            Share
          </button>
          <span className="share-status" role="status">{shareStatus}</span>
          {shareUrl ? <input className="nb-share-link" aria-label="Scene share link" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /> : null}
        </div>
      </header>
      <section className="nb-new-page" id="nb-compose" hidden={!problemOpen} aria-label="New problem" onKeyDown={event=>{if(event.key==="Escape")setProblemOpen(false);}}>
        <div className="nb-subhead"><h2 className="nb-h3">New problem</h2><button type="button" className="nb-link" onClick={()=>setProblemOpen(false)}>Close</button></div>
        <InputPanel subject={activeNotebook.subject} key={restoredInput.version} initialProblemText={restoredInput.text} onStarted={handleStarted} onAnswers={handleAnswers} onFailed={handleFailed} onSolved={handleSolved} />
      </section>


      <div className="nb-body">
        <nav className="nb-rail" aria-label="Notebook sections">
          <button type="button" className="nb-rail-item" title="Notebooks" aria-pressed={libraryOpen} onClick={()=>{setLibraryOpen(true);setAccountOpen(false);document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h11a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V4Zm3 0v13M8 1h9a1 1 0 0 1 1 1v12M9 8h4M9 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <span className="nb-rail-label">Notebooks</span>
          </button>
          <button type="button" className="nb-rail-item" title="Problem" aria-pressed={!libraryOpen && !accountOpen && leftView==="problem"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("problem");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <IconProblem />
            <span className="nb-rail-label">Problem</span>
          </button>
          <button type="button" className="nb-rail-item" title="Derivation" aria-pressed={!libraryOpen && !accountOpen && leftView==="derivation"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("derivation");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <IconDerivation />
            <span className="nb-rail-label">Derivation</span>
          </button>
          <button type="button" className="nb-rail-item" title="Variables" aria-pressed={!libraryOpen && !accountOpen && leftView==="variables"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("variables");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <IconVariables />
            <span className="nb-rail-label">Variables</span>
          </button>
        </nav>

        <aside className="nb-notebook" aria-label="Notebook">
          {storageError ? <p role="alert" className="nb-notice nb-warn">{storageError}</p> : null}
          {cloudStatus ? <p role="status" className="nb-note">{cloudStatus}</p> : null}
          {accountOpen ? <AccountPanel onImport={importGuestPages} /> : null}
          {libraryOpen && !accountOpen ? <NotebookLibrary library={library} activeId={notebookId} cloud={Boolean(accountId)}
            onSelect={id=>{notebookRef.current=id;setNotebookId(id);}}
            onRename={(id,name)=>setLibrary(previous=>renameNotebook(previous,id,name))}
            onCreate={createNotebook}
            onOpen={id=>{const url=new URL(window.location.href);url.searchParams.set("page",id);url.hash="nb-problem";window.history.pushState(null,"",url);activeQuestion.current=null;window.dispatchEvent(new PopStateEvent("popstate"));}} /> : null}
          <div hidden={libraryOpen || accountOpen} className="nb-panel-content">
          <section className="nb-section" id="nb-problem" hidden={leftView!=="problem"}>
            <p className="nb-eyebrow">Experiment</p>
            <h1 className="nb-title" id="question-page-title" tabIndex={-1}>{live?.title ?? "New physics problem"}</h1>
            {live?.problemText || questionPage ? <p className="nb-problem-text">{blurb}</p> : null}
            <div className="nb-subhead">
              <h3 className="nb-h3">Given</h3>

            </div>
            {live && live.variables.length > 0 ? (
              <dl className="nb-givens">
                {live.variables.map((variable) => (
                  <div className="nb-given" key={variable.name}>
                    <dt>{variable.label || variable.name}</dt>
                    <dd className="num">
                      {variable.value.toFixed(digits(variable.step))}
                      {variable.unit ? ` ${variable.unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="nb-note">{questionPage ? "Reading the quantities in your problem." : "This scene fixes every quantity."}</p>
            )}
          </section>

          {live ? <section className="nb-section" id="nb-derivation" hidden={leftView!=="derivation"}>
            <div className="nb-subhead">
              <h3 className="nb-h3">Derivation</h3>
              <span className="nb-count">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
            </div>
            <p className="nb-note">Choose a step to jump the board to the moment it explains.</p>
            <StepsPanel
              steps={steps}
              time={time}
              selected={selected}
              onSeek={seek}
              onHighlight={highlightStep}
            />
          </section> : null}

          {!live && questionPage ? <section className="nb-section" aria-label="Current problem solution" hidden={leftView!=="problem"}>
            <h3 className="nb-h3">{questionPage.answers ? "Calculated answers" : questionPage.status==="error" ? "Could not solve this problem" : "Solving your problem"}</h3>
            {questionPage.answers ? <>
              <dl className="nb-results">{questionPage.answers.answers.map((answer,index)=><div className="nb-result" key={index}><dt>{answer.question}</dt><dd className="num">{Number(answer.value.toPrecision(6))} {answer.unit}</dd></div>)}</dl>
              <p className="nb-solution">{questionPage.answers.solutionText}</p>
            </> : <p className="nb-note" role="status">{questionPage.error ?? "Calculating the answer for this new page…"}</p>}
          </section> : null}

          {live && compiled ? (
            <section className="nb-section" aria-label="Calculated answers" hidden={leftView!=="problem"}>
              <div className="nb-answer">
                <div className="nb-answer-eyebrow">
                  <span>Answer</span>
                  <span>{solution ? "Your problem" : "Preset"}</span>
                </div>
                <p className="nb-answer-question">{target?.question ?? live.title}</p>
                <p className="nb-answer-big num">
                  {answersHidden ? "?" : Number.isFinite(actual) ? actual.toFixed(3) : "…"}
                  <span>{target?.unit ?? ""}</span>
                </p>
                <p className="nb-answer-model">
                  {answersHidden ? "Make your prediction, then watch the scene unfold." : blurb}
                </p>
                {!answersHidden ? <dl className="nb-results">{answerRows(answers)}</dl> : null}
              </div>
            </section>
          ) : null}

          {predict && leftView==="prediction" ? (
            <section className="nb-section">
              <div className="nb-subhead">
                <h3 className="nb-h3">Predict before you play</h3>
                <button type="button" className="nb-link" onClick={togglePredict}>
                  Hide
                </button>
              </div>
              {target ? (
                <>
                  <p className="nb-question">{target.question}</p>
                  <p className="nb-note">
                    Give a number in {target.unit || "the unit of the question"}. Your number stays yours until you
                    reveal the answer or the run finishes.
                  </p>
                  <label className="nb-field" htmlFor="prediction">
                    <span>Your answer</span>
                  </label>
                  <input
                    id="prediction"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    className="nb-input num"
                    value={guess}
                    onChange={(event) => setGuess(event.target.value)}
                  />
                  <div className="nb-actions">
                    <button
                      type="button"
                      className="nb-btn nb-btn-primary"
                      disabled={!Number.isFinite(guessNumber) || canReveal}
                      onClick={() => setRevealed(true)}
                    >
                      Reveal the answer
                    </button>
                    <button type="button" className="nb-btn nb-btn-ghost" onClick={()=>{resetPrediction();reset();sharedClock.current=0;setPlaybackRevision(previous=>previous+1);}}>
                      Clear
                    </button>
                  </div>
                  {!canReveal ? (
                    <p className="nb-note">
                      {finished
                        ? "The run is over, so the answer can be revealed."
                        : "The answer stays hidden until you reveal it or the run reaches the end."}
                    </p>
                  ) : null}
                  {guessMissing ? (
                    <p className="nb-warn" role="status">
                      Enter a prediction before you press play, or reveal the answer first.
                    </p>
                  ) : null}
                  {canReveal ? (
                    <p className="nb-verdict">
                      The board gives{" "}
                      <b className="num">
                        {Number.isFinite(actual) ? actual.toFixed(3) : "not available"} {target.unit}
                      </b>
                      .
                      {!openGuess ? (
                        " Enter a number above to compare it with the board."
                      ) : close ? (
                        <> Your {guessNumber} is inside 2 percent of it. Well judged.</>
                      ) : (
                        <>
                          {" "}
                          Yours was {guessNumber}, which is {Math.abs(guessNumber - actual).toFixed(3)} away. Play it
                          again and watch which part of the motion decides it.
                        </>
                      )}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="nb-note">This scene has no finite answer to predict.</p>
              )}
            </section>
          ) : null}

          <details className="nb-section nb-details" hidden={leftView!=="problem"}>
            <summary>Model and assumptions</summary>
            {live?.problemText ? <p className="nb-solution">{live.problemText}</p> : null}
            {solution ? <p className="nb-solution">{solution}</p> : null}
            <p className="nb-note">
              These boards use closed form ideal models chosen for the situation, and they are not a fluid or turbulence
              simulation. A scene that passes every check is not a promise that its model fits the real world.
            </p>
          </details>

          {notice && leftView==="problem" ? (
            <p className="nb-notice" role="status">
              {notice}
            </p>
          ) : null}
          {prepared.warnings.length > 0 && leftView==="problem" ? (
            <p className="nb-notice nb-warn" role="status">
              Scene warnings: {prepared.warnings.join(" ")}
            </p>
          ) : null}
          {editError && leftView==="variables" ? (
            <p className="nb-notice nb-warn" role="alert">
              {editError}
            </p>
          ) : null}
          {live ? <>              <section className="nb-section nb-params" id="nb-variables" hidden={leftView!=="variables"}>
                <div className="nb-subhead">
                  <h3 className="nb-h3">Variables</h3>
                </div>
                <VariableSliders
                  variables={live?.variables ?? []}
                  values={values}
                  onChange={changeValue}
                />
              </section>

              <section className="nb-section nb-instruction" hidden={leftView!=="variables"}>
                <div className="nb-subhead">
                  <h3 className="nb-h3">Change this scene</h3>
                </div>
                <label className="nb-field" htmlFor="edit-instruction">
                  <span>Instruction</span>
                </label>
                <textarea
                  id="edit-instruction"
                  rows={2}
                  maxLength={1000}
                  placeholder="make the ramp steeper"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                />
                <button
                  type="button"
                  className="nb-btn nb-btn-primary nb-btn-wide"
                  disabled={editBusy || editText.trim().length === 0}
                  onClick={runEdit}
                >
                  {editBusy ? "Applying the change" : "Apply the change"}
                </button>
              </section></> : null}
          </div>
        </aside>

        <main className={`nb-workspace${view==="video" ? " nb-video-open" : ""}`}>
          <section className="nb-section" aria-label="Simulation controls">
          <div className="nb-toolbar">
            <div className="nb-modes" role="group" aria-label="View mode">
              <button
                type="button"
                className="nb-seg"
                aria-pressed={view === "simulation"}
                onClick={() => setView("simulation")}
              >
                Interactive simulation
              </button>
              <button
                type="button"
                className="nb-seg"
                aria-pressed={view === "video"}
                disabled={!live}
                onClick={() => {
                  setView("video");
                  setPlaying(false);
                }}
              >
                Watch explanation
              </button>
            </div>
            <label className="nb-field nb-inline nb-scene-picker" htmlFor="scene-picker">
              <span>Scene</span>
            </label>
            <select
              id="scene-picker"
              className="nb-select"
              value={!live || scene!==presets[presetKey] ? "" : presetKey}
              onChange={(event) => selectPreset(event.target.value as PresetKey)}
            >
              {!live || scene!==presets[presetKey] ? <option value="" disabled>{live?.title ?? "Generating your simulation…"}</option> : null}
              {presetList.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
            <button type="button" className="nb-btn nb-btn-ghost" aria-pressed={predict} onClick={togglePredict} disabled={!live}>
              {predict && leftView==="prediction" && !libraryOpen && !accountOpen ? "Hide prediction" : "Predict"}
            </button>
            {selected !== null ? (
              <button type="button" className="nb-btn nb-btn-ghost" onClick={() => setSelected(null)}>
                Clear highlight
              </button>
            ) : null}
          </div>
{live ? <Timeline
                duration={duration}
                time={time}
                playing={playing}
                speed={speed}
                muted={muted}
                narrationReady={narrationReady}
                shots={shots}
                playBlocked={guessMissing}
                onPlay={togglePlay}
                onPause={() => setPlaying(false)}
                onSeek={seek}
                onSpeed={setSpeed}
                onReset={reset}
                onMute={setMuted}
                onShots={setShots}
              /> : null}          </section>



          <div className="nb-viewport">
            <div className="nb-sim" hidden={view !== "simulation"}>
              <span id="nb-simulation" className="nb-anchor" aria-hidden="true" />
              {!live && questionPage ? <div className="nb-stage nb-stage-loading" id="simulation" aria-busy={questionPage.status==="solving" || questionPage.status==="building"}>
                <div className="nb-fallback" role="status">
                  <h2>{questionPage.status==="error" ? "Simulation could not finish" : questionPage.status==="answer-only" ? "Your written solution is ready" : "Generating your simulation"}</h2>
                  <p>{questionPage.error ?? (questionPage.answers ? "Your answers are ready in the notebook. Building the 3D explanation for this problem…" : "Reading this problem and calculating its answers…")}</p>
                </div>
              </div> : prepared.error || !live || !compiled ? (
                <div className="nb-stage nb-stage-broken">
                  <div className="nb-fallback" role="alert">
                    <h2>This scene could not be prepared</h2>
                    <p>{prepared.error ?? "The scene script is not usable."}</p>
                    <p>
                      A scene is only shown after every expression parses and every sampled value is finite, so nothing
                      broken is ever drawn.
                    </p>
                    <button type="button" className="nb-btn nb-btn-primary" onClick={reloadPreset}>
                      Reload the preset
                    </button>
                  </div>
                </div>
              ) : (
                <div className="nb-stage" id="simulation">
                  <SceneCanvas
                    scene={live}
                    values={values}
                    playing={playing}
                    time={time}
                    speed={speed}
                    onTime={handleTime}
                    onComplete={handleComplete}
                    onLoop={handleLoop}
                    shot={shot}
                    onManualOrbit={() => setManual(true)}
                    sharedClock={sharedClock}
                        restart={playbackRevision}
                    highlight={highlight}
                  />
                  <div className="nb-stage-hint">Drag to orbit · Scroll to zoom</div>
                </div>
              )}


            </div>

            <div className="nb-video" hidden={view !== "video"}>
              {live && compiled ? <ExplanationVideo scene={live} values={values} solution={solution} /> : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
