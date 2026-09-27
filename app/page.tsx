"use client";
import {generateInBackground,waitForGeneration} from "@/lib/generation-client";
import {authFetch} from "@/lib/auth-fetch";

import dynamic from "next/dynamic";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {MathResponse} from "@/components/MathResponse";
import NotebookLibrary from "@/components/NotebookLibrary";
import AccountPanel from "@/components/AccountPanel";
import ChalkLogo from "@/components/ChalkLogo";
import AuthScreen from "@/components/AuthScreen";
import {getSupabaseClient} from "@/lib/supabase-client";
import {accountStorage,loadCloudLibrary,flushCloud,queueNotebooks,queuePage,queueNotebookDeletion,readPending} from "@/lib/cloud-notebooks";
import {EMPTY_LIBRARY, contentSignature, initialNotebook, readLibrary, writeLibrary, upsertPage, renameNotebook, type Library, type Subject} from "@/lib/notebooks";
import InputPanel, { type SolveResult } from "@/components/InputPanel";
import ExplanationVideo, {type SavedVideo} from "@/components/ExplanationVideo";
import StepsPanel, { activeStepIndex } from "@/components/StepsPanel";
import Timeline from "@/components/Timeline";
import UiIcon from "@/components/UiIcon";
import {keepSimulation,type SimulationVersion} from "@/lib/simulation-history";
import {sceneShareLink} from "@/lib/share-link";
import {withParameterRanges} from "@/lib/parameter-ranges";
import {motionPresentation} from "@/lib/motion-presentation";
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
    answers:Omit<SolveResult,"scene">|null; error:string|null; video?:SavedVideo; simulations?:SimulationVersion[]; selectedSimulation?:string;
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
      if(new URLSearchParams(window.location.hash.slice(1)).has("scene"))return;
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
        try{await authFetch("/api/generation",{cache:"no-store"});loaded=await loadCloudLibrary(client,accountId,cache);if(alive)setCloudStatus("Cloud notebooks connected.");}
        catch(error){if(alive)setCloudStatus(`Cloud connection failed. Cached pages are available; uploads will retry. ${describe(error,"Try again.")}`);}
      } else setCloudStatus("Saved on this browser. Sign in to save new pages to your account.");
      if(!alive)return;
      lastLibrary.current=loaded;setLibrary(loaded);
      const selected=cache.getItem("chalk-active-notebook");
      const book=initialNotebook(loaded,selected);
      notebookRef.current=book;setNotebookId(book);
      restore();setLibraryReady(true);
      if(!new URL(window.location.href).searchParams.has("page") && !window.location.hash.includes("scene=") && loaded.pages.length)setLibraryOpen(true);
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
        await authFetch("/api/generation",{cache:"no-store"});
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
      const payload={questionPage,scene:scene ? withParameterRanges(scene,values) : null,solution,values};
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
      if(!Object.keys(pending.notebooks).length && !Object.keys(pending.pages).length && !Object.keys(pending.deletedNotebooks ?? {}).length)return;
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
  const [volume,setVolume]=useState(1);
  const [cameraRevision,setCameraRevision]=useState(0);
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
    if(!libraryReady)return;
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
      setLibraryOpen(false);setAccountOpen(false);setLeftView("problem");setSolution("");
      setNotice("Shared scene loaded. Press play to explore it.");
    } catch {
      setNotice("This shared scene could not be loaded. The presets are available.");
    }
    };
    loadSharedScene();
    window.addEventListener("hashchange", loadSharedScene);
    return () => window.removeEventListener("hashchange", loadSharedScene);
  }, [libraryReady,accountId]);
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

  const visualPresentation=useMemo(()=>live ? motionPresentation(live,values) : null,[live,values]);
  const index = useMemo(() => activeStepIndex(steps, time), [steps, time]);
  const step = index >= 0 ? steps[index] : null;
  const narration = step?.narration ?? "";
  const shot = shots && !manual && step?.camera ? step.camera : null;
  const chosen = selected !== null ? steps[selected] : null;
  const focus = chosen ?? step;
  const highlight = chosen ? { objects: chosen.focus.length ? chosen.focus : live?.objects.filter(o=>!/ground|floor|base/i.test(o.id)).map(o=>o.id) ?? [], vectors: chosen.showVectors } : null;

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
  const guessMissing = predict && leftView==="prediction" && !libraryOpen && !accountOpen && !canReveal && !Number.isFinite(guessNumber);

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
    utterance.volume=volume;
    window.speechSynthesis.speak(utterance);
    return cancelSpeech;
  }, [muted, playing, narration,volume]);

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
      setSelected(position);setView("simulation");setManual(false);setCameraRevision(n=>n+1);
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
    setQuestionPage(previous=>{
      if(previous?.id!==id)return previous;
      const history=result.scene ? keepSimulation(previous.simulations ?? [],result.scene,initialValues(result.scene),result.solutionText) : null;
      return {...previous,status:result.scene?"ready":"answer-only",answers:result,error:null,...(history?{simulations:history.versions,selectedSimulation:history.id}:{})};
    });
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

  useEffect(()=>{
    if(!accountId || !questionPage || !["solving","building"].includes(questionPage.status))return;
    const controller=new AbortController();const id=questionPage.id;
    void waitForGeneration(id,result=>{if(!controller.signal.aborted)handleAnswers(result,id);},controller.signal)
      .then(result=>{if(!controller.signal.aborted)handleSolved(result,id);})
      .catch(()=>{/* A newly created page may precede job acceptance. Retry while pending. */});
    const timer=setInterval(()=>{
      if(!controller.signal.aborted)void authFetch(`/api/generation?pageId=${encodeURIComponent(id)}`,{cache:"no-store",signal:controller.signal})
        .then(response=>response.ok?response.json():null).then(job=>{if(controller.signal.aborted || !job)return;if(job.status==="complete")handleSolved(job.result,id);else if(job.status==="error")handleFailed(job.error,id);}).catch(()=>{});
    },3000);
    return()=>{controller.abort();clearInterval(timer);};
  },[accountId,questionPage?.id,questionPage?.status,handleAnswers,handleSolved,handleFailed]);

  const retryingSimulation=useRef(false);
  const regenerateSimulation=useCallback(async()=>{
    if(retryingSimulation.current || !questionPage)return;
    const text=questionPage.problemText.trim() || questionPage.answers?.interpretedProblem || scene?.problemText;
    if(!text){openProblem();setNotice("Please upload the photo again to retry this problem.");return;}
    const id=questionPage.id;
    retryingSimulation.current=true;generatingHere.current=id;savedPageSignature.current="";
    setPlaying(false);setScene(null);setView("simulation");
    setQuestionPage(previous=>{
      if(previous?.id!==id)return previous;
      const history=scene ? keepSimulation(previous.simulations ?? [],withParameterRanges(scene,values),values,solution,previous.video) : null;
      return {...previous,status:"building",error:null,video:undefined,...(history?{simulations:history.versions,selectedSimulation:history.id}:{})};
    });
    try{
      const reference=scene ?? questionPage.simulations?.find(v=>v.id===questionPage.selectedSimulation)?.scene;
      const result=await generateInBackground(id,reference && activeNotebook.subject!=="mathematics" ? {scene:withParameterRanges(reference,values),instruction:"Regenerate the explanation simulation for this same problem. Preserve the existing apparatus, colors, physical layout and camera composition. Do not add decorative supports or oversized vectors. Improve clarity and ensure all adjustable values drive the equations and geometry. Keep the given values and requested answers."}:{problemText:text.slice(0,6000),subject:activeNotebook.subject,notebookId:questionPage.notebookId},result=>handleAnswers(result,id));
      handleSolved(result,id);
    }catch(error){handleFailed(describe(error,"The connection ended before the simulation finished. Retry generation."),id);}
    finally{retryingSimulation.current=false;}
  },[questionPage,scene,values,solution,activeNotebook.subject,openProblem,handleAnswers,handleSolved,handleFailed]);

  const runEdit = useCallback(async () => {
    const instruction = editText.trim();
    if (!scene || instruction.length === 0 || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const currentScene={...withParameterRanges(scene,values),variables:withParameterRanges(scene,values).variables.map(variable=>({...variable,value:values[variable.name] ?? variable.value}))};
      const immediate=localParameterEdit(currentScene,instruction);
      if(immediate){
        const nextValues=initialValues(immediate.scene);
        setValues(nextValues);setTime(0);sharedClock.current=0;setPlaybackRevision(previous=>previous+1);setPlaying(true);
        setSolution(immediate.solutionText);setEditText("");setNotice("Updated instantly using the existing equations.");
        return;
      }
      if(!questionPage)throw new Error("Save this question before changing its simulation.");
      const id=questionPage.id;
      const old=keepSimulation(questionPage.simulations ?? [],withParameterRanges(scene,values),values,solution,questionPage.video);
      setQuestionPage(previous=>previous?.id===id?{...previous,status:"building",simulations:old.versions,selectedSimulation:old.id}:previous);
      const result = await generateInBackground(id,{scene:currentScene,instruction},answer=>handleAnswers(answer,id));
      if(activeQuestion.current!==id)return;
      handleSolved(result,id);
      if (result.scene) {
        setQuestionPage(previous=>{
          if(!previous)return previous;
          const old=keepSimulation(previous.simulations ?? [],withParameterRanges(scene,values),values,solution,previous.video);
          const next=keepSimulation(old.versions,result.scene!,initialValues(result.scene!),result.solutionText);
          return {...previous,simulations:next.versions,selectedSimulation:next.id,video:undefined};
        });
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
  }, [editText, editBusy, scene, values,solution,questionPage,handleAnswers,handleSolved]);

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
        variables: withParameterRanges(live,values).variables.map((variable) => ({ ...variable, value: sharedValues[variable.name] ?? variable.value })),
        answers: live.answers.map((answer, index) => ({ ...answer, value: evaluated[index] })),
      }).scene;
      const encoded = compressToEncodedURIComponent(JSON.stringify(shared));
      if (encoded.length > 30000) throw new Error("This scene is too large for a share link.");
      const url = new URL(sceneShareLink(window.location.href,shared));
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

  const chooseSimulation=(id:string)=>{
    const version=questionPage?.simulations?.find(v=>v.id===id);if(!version)return;
    try{
      const restored=validateSceneScript(version.scene).scene;
      pendingValues.current=version.values;
      setValues(version.values);setScene(restored);setSolution(version.solution);setPlaying(false);
      setQuestionPage(previous=>previous ? {...previous,status:"ready",error:null,selectedSimulation:id,video:version.video,simulations:previous.simulations?.map(saved=>saved.id===previous.selectedSimulation && scene ? {...saved,scene:withParameterRanges(scene,values),values,solution,video:previous.video}:saved)}:previous);
      setNotice("Saved simulation restored.");
    }catch{setNotice("This saved version could not be opened.");}
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

  const openSavedQuestion=(id:string)=>{
    if(!id)return;
    const url=new URL(window.location.href);url.searchParams.set("page",id);url.hash="nb-problem";
    window.history.pushState(null,"",url);activeQuestion.current=null;setLibraryOpen(false);setAccountOpen(false);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const selectNotebook=(id:string)=>{
    notebookRef.current=id;setNotebookId(id);setPlaying(false);
    const page=library.pages.find(page=>page.notebookId===id);
    if(page)openSavedQuestion(page.id);
    else {activeQuestion.current=null;setQuestionPage(null);setScene(null);setSolution("");const url=new URL(window.location.href);url.searchParams.delete("page");url.hash="nb-notebooks";window.history.replaceState(null,"",url);}
    setLibraryOpen(true);
  };
  const deleteNotebook=async(id:string)=>{
    if(generatingHere.current && library.pages.some(page=>page.notebookId===id && page.id===generatingHere.current))throw new Error("Wait for the question to finish generating before deleting this notebook.");
    const next={notebooks:library.notebooks.filter(book=>book.id!==id),pages:library.pages.filter(page=>page.notebookId!==id)};
    const cache=accountStorage(localStorage,accountId ?? null);
    queueNotebookDeletion(cache,id);setLibrary(next);setCloudRetry(n=>n+1);
    if(notebookId===id || questionPage?.notebookId===id){
      activeQuestion.current=null;setQuestionPage(null);setScene(null);setSolution("");setPlaying(false);
      const nextId=initialNotebook(next,null);notebookRef.current=nextId;setNotebookId(nextId);
      const url=new URL(window.location.href);url.searchParams.delete("page");url.hash="nb-notebooks";window.history.replaceState(null,"",url);
    }
    setLibraryOpen(true);
  };
  const createNotebook=(name:string,subject:Subject)=>{const id=`notebook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;setLibrary(previous=>({...previous,notebooks:[...previous.notebooks,{id,name:name.trim(),subject}]}));notebookRef.current=id;setNotebookId(id);};
  if(!accountId || !sessionReady || !libraryReady)return <AuthScreen checking={accountId===undefined} verifying={Boolean(accountId)} error={sessionError} />;
  if(!library.notebooks.length)return <div className="nb-app"><header className="nb-header"><ChalkLogo/><div className="nb-header-actions"><button type="button" className="nb-btn nb-btn-ghost" onClick={()=>setAccountOpen(!accountOpen)}><UiIcon name="account"/><span>Account</span></button></div></header><main className="nb-library-onboarding">{accountOpen ? <AccountPanel onImport={importGuestPages}/> : <NotebookLibrary library={library} activeId="" cloud onSelect={()=>{}} onRename={()=>{}} onCreate={createNotebook} onOpen={()=>{}} onDelete={deleteNotebook}/>}{cloudStatus ? <p className="nb-note" role="status">{cloudStatus}</p> : null}</main></div>;
  return (
    <div className="nb-app">
      <header className="nb-header">
        <div className="nb-brand">
          <ChalkLogo/>
        </div>

        <div className="nb-crumbs">
          <button type="button" className="nb-notebook-switch" onClick={()=>{setLibraryOpen(!libraryOpen);setAccountOpen(false);}} aria-expanded={libraryOpen}>{activeNotebook.name}</button>
          <span className="nb-topic">{live?.title ?? (questionPage ? `New ${activeNotebook.subject} problem` : activeNotebook.name)}</span>
        </div>
        <div className="nb-header-actions">
          <button type="button" className="nb-btn nb-btn-ghost" aria-expanded={accountOpen} onClick={()=>{setAccountOpen(!accountOpen);setLibraryOpen(false);}}><UiIcon name="account"/><span>Account</span></button>
          <button type="button" className="nb-btn nb-btn-ghost" aria-expanded={problemOpen} aria-controls="nb-compose" onClick={openProblem}>
            <UiIcon name="newPage"/><span>New question</span>
          </button>
          <button type="button" className="nb-btn nb-btn-ghost" onClick={share} disabled={!live}>
            <UiIcon name="share"/><span>Share</span>
          </button>
          <span className="share-status" role="status">{shareStatus}</span>
          {shareUrl ? <input className="nb-share-link" aria-label="Scene share link" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /> : null}
        </div>
      </header>
      <section className="nb-new-page" id="nb-compose" hidden={!problemOpen} aria-label="New problem" onKeyDown={event=>{if(event.key==="Escape")setProblemOpen(false);}}>
        <div className="nb-subhead"><h2 className="nb-h3">New problem</h2><button type="button" className="nb-link" onClick={()=>setProblemOpen(false)}>Close</button></div>
        <InputPanel notebookId={activeNotebook.id} subject={activeNotebook.subject} key={restoredInput.version} initialProblemText={restoredInput.text} onStarted={handleStarted} onAnswers={handleAnswers} onFailed={handleFailed} onSolved={handleSolved} />
      </section>


      <div className="nb-body">
        <nav className="nb-rail" aria-label="Notebook sections">
          <button type="button" className="nb-rail-item" title="Notebooks" aria-pressed={libraryOpen} onClick={()=>{setLibraryOpen(true);setAccountOpen(false);document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <UiIcon name="notebooks"/>
            <span className="nb-rail-label">Notebooks</span>
          </button>
          <button type="button" className="nb-rail-item" title="Problem" aria-pressed={!libraryOpen && !accountOpen && leftView==="problem"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("problem");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <UiIcon name="problem"/>
            <span className="nb-rail-label">Problem</span>
          </button>
          <button type="button" className="nb-rail-item" title="Derivation" aria-pressed={!libraryOpen && !accountOpen && leftView==="derivation"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("derivation");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <UiIcon name="sigma" size={25}/>
            <span className="nb-rail-label">Derivation</span>
          </button>
          <button type="button" className="nb-rail-item" title="Variables" aria-pressed={!libraryOpen && !accountOpen && leftView==="variables"} onClick={()=>{setLibraryOpen(false);setAccountOpen(false);setLeftView("variables");setPredict(false);if(view!=="simulation")setView("simulation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>
            <UiIcon name="variables"/>
            <span className="nb-rail-label">Variables</span>
          </button>
        </nav>

        <aside className="nb-notebook" aria-label="Notebook">
          {storageError ? <p role="alert" className="nb-notice nb-warn">{storageError}</p> : null}
          {cloudStatus ? <p role="status" className="nb-save-status"><UiIcon name="saved" size={22}/>{cloudStatus}</p> : null}
          {accountOpen ? <AccountPanel onImport={importGuestPages} /> : null}
          {libraryOpen && !accountOpen ? <NotebookLibrary library={library} activeId={notebookId} cloud={Boolean(accountId)}
            onSelect={selectNotebook}
            onRename={(id,name)=>setLibrary(previous=>renameNotebook(previous,id,name))}
            onCreate={createNotebook}
            onOpen={openSavedQuestion} onDelete={deleteNotebook} /> : null}
          <div hidden={libraryOpen || accountOpen} className="nb-panel-content">
          <section className="nb-section" id="nb-problem" hidden={leftView!=="problem"}>
            <p className="nb-eyebrow">Experiment</p>
            <h1 className="nb-title" id="question-page-title" tabIndex={-1}>{live?.title ?? `New ${activeNotebook.subject} problem`}</h1>
            {live?.problemText || questionPage ? <p className="nb-problem-text">{blurb}</p> : null}
            <div className="nb-subhead">
              <h3 className="nb-h3">{questionPage?.answers?.responseKind==="symbolic" || questionPage?.answers?.responseKind==="conceptual" ? "Demonstration parameters" : "Given"}</h3>

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
              <p className="nb-note">{questionPage?.status==="answer-only" ? "See the written response for the relationships and any required information." : questionPage ? "Reading the quantities in your problem." : "This scene fixes every quantity."}</p>
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

          {(!live || live.answers.length===0) && questionPage ? <section className="nb-section" aria-label="Current problem solution" hidden={leftView!=="problem"}>
            <h3 className="nb-h3">{questionPage.answers ? questionPage.answers.answers.length ? "Calculated answers" : "Written response" : questionPage.status==="error" ? "Could not solve this problem" : "Solving your problem"}</h3>
            {questionPage.answers ? <>
              <dl className="nb-results">{questionPage.answers.answers.map((answer,index)=><div className="nb-result" key={index}><dt>{answer.question}</dt><dd className="num">{Number(answer.value.toPrecision(6))} {answer.unit}</dd></div>)}</dl>
              <MathResponse text={questionPage.answers.solutionText}/>
            </> : <p className="nb-note" role="status">{questionPage.error ?? "Calculating the answer for this new page…"}</p>}
          </section> : null}

          {live && compiled && live.answers.length>0 ? (
            <section className="nb-section" aria-label="Calculated answers" hidden={leftView!=="problem"}>
              <div className="nb-answer">
                <div className="nb-answer-eyebrow">
                  <span><UiIcon name="check" size={16}/> {target?.question ?? "Answer"}</span>
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
                <button type="button" className="nb-view-derivation" onClick={()=>{setLeftView("derivation");document.querySelector(".nb-notebook")?.scrollTo({top:0});}}>View derivation <UiIcon name="arrow" size={18}/></button>
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
            {live?.problemText ? <MathResponse text={live.problemText}/> : null}
            {solution ? <MathResponse text={solution}/> : null}
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
                  <h3 className="nb-h3 nb-panel-title">Variables</h3>
                </div>
                <p className="nb-note">Drag to explore, or type an exact value.</p>
                <VariableSliders
                  variables={live?.variables ?? []}
                  values={values}
                  onChange={changeValue}
                />
              </section>

              <section className="nb-section nb-instruction" hidden={leftView!=="variables"}>
                <div className="nb-subhead">
                  <h3 className="nb-h3"><UiIcon name="edit"/> Change this scene</h3>
                </div>
                <label className="nb-field" htmlFor="edit-instruction">
                  <span>Instruction</span>
                </label>
                <textarea
                  id="edit-instruction"
                  rows={2}
                  maxLength={1000}
                  placeholder="Describe a change…"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                />
                <button
                  type="button"
                  className="nb-btn nb-btn-primary nb-btn-wide"
                  disabled={editBusy || editText.trim().length === 0}
                  onClick={runEdit}
                >
                  {editBusy ? "Applying…" : "Apply"} <UiIcon name="arrow"/>
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
                Simulation
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
                Explanation
              </button>
            </div>
            <label className="nb-field nb-inline nb-scene-picker" htmlFor="scene-picker">
              <span>Scene</span>
            </label>
            <select
              id="scene-picker"
              className="nb-select"
              value={questionPage?.notebookId===notebookId ? questionPage.id : ""}
              onChange={event=>openSavedQuestion(event.target.value)}
            >
              {questionPage?.notebookId!==notebookId ? <option value="" disabled>{live?.title ?? "Choose a question"}</option> : null}
              {library.pages.filter(page=>page.notebookId===notebookId).map(page=><option key={page.id} value={page.id}>{page.title}</option>)}
            </select>
            {questionPage?.simulations && questionPage.simulations.length>1 ? <select className="nb-select nb-version-picker" aria-label="Simulation version" value={questionPage.selectedSimulation ?? questionPage.simulations.at(-1)?.id} onChange={event=>chooseSimulation(event.target.value)}>{questionPage.simulations.map((version,i)=><option key={version.id} value={version.id}>{i===0?"Original simulation":`Simulation ${i+1}`}</option>)}</select> : null}
            <button type="button" className="nb-btn nb-btn-ghost nb-predict" aria-pressed={predict} onClick={togglePredict} disabled={!live}>
              <UiIcon name="predict"/> {predict && leftView==="prediction" && !libraryOpen && !accountOpen ? "Hide prediction" : "Predict"}
            </button>
            {selected !== null ? (
              <button type="button" className="nb-btn nb-btn-ghost" onClick={() => setSelected(null)}>
                Clear highlight
              </button>
            ) : null}
          </div>
          </section>



          <div className="nb-viewport">
            <div className="nb-sim" hidden={view !== "simulation"}>
              <span id="nb-simulation" className="nb-anchor" aria-hidden="true" />
              {!live && questionPage ? <div className="nb-stage nb-stage-loading" id="simulation" aria-busy={questionPage.status==="solving" || questionPage.status==="building"}>
                <div className="nb-fallback" role="status">
                  <h2>{questionPage.status==="error" ? "Simulation could not finish" : questionPage.status==="answer-only" ? "Your written solution is ready" : "Generating your simulation"}</h2>
                  <p>{questionPage.error ?? (questionPage.status==="answer-only" ? "Read the written response in the Problem panel. No numerical simulation was generated; the response explains the reasoning or any information needed to calculate an answer." : questionPage.answers ? "Your answers are ready in the notebook. Building the 3D explanation for this problem…" : "Reading this problem and calculating its answers…")}</p>
                  {questionPage.status==="error" || questionPage.status==="answer-only" ? <button className="nb-btn nb-btn-primary" onClick={()=>void regenerateSimulation()}>Retry simulation</button> : null}
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
                  <div className="nb-stage-caption"><span>{live.title}</span>{visualPresentation?.frequencyHz ? <small>{visualPresentation.frequencyHz.toFixed(0)} Hz · {visualPresentation.rate<1 ? `Slowed ${Math.round(1/visualPresentation.rate)}×` : "Real time"}</small> : null}</div>
                  <div className="nb-stage-tools">
                    <button type="button" aria-label="Fit scene in view" title="Fit scene in view" onClick={()=>{setManual(true);setCameraRevision(n=>n+1);}}><UiIcon name="focus"/></button>
                    <button type="button" aria-label="Reset simulation" title="Reset simulation" onClick={reset}><UiIcon name="reset"/></button>
                    {questionPage ? <button type="button" aria-label="Regenerate simulation" title="Generate a new simulation for this problem" onClick={()=>void regenerateSimulation()}><UiIcon name="regenerate"/></button> : null}
                    <button type="button" aria-label="Fullscreen simulation" title="Fullscreen simulation" onClick={async()=>{try{const element=document.getElementById("simulation");if(document.fullscreenElement)await document.exitFullscreen();else if(element?.requestFullscreen)await element.requestFullscreen();else setNotice("This browser does not support fullscreen. You can expand the browser window instead.");}catch{setNotice("Fullscreen could not open in this browser.");}}}><UiIcon name="fullscreen"/></button>
                  </div>
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
                    cameraRevision={cameraRevision}
                    highlight={highlight}
                  />
                  <div className="nb-stage-hint">Drag to orbit · Scroll to zoom</div>
                </div>
              )}


            </div>

            <div className="nb-video" hidden={view !== "video"}>
              {live && compiled ? <ExplanationVideo key={questionPage?.id ?? "preset"} scene={withParameterRanges(live,values)} values={values} solution={solution} savedJob={questionPage?.video} onJob={video=>{const id=questionPage?.id;if(id)setQuestionPage(previous=>previous?.id===id ? {...previous,video,simulations:previous.simulations?.map(saved=>saved.id===previous.selectedSimulation ? {...saved,video}:saved)} : previous);}} /> : null}
            </div>
          </div>
          {view==="simulation" ? <div className="nb-playback">{live ? <Timeline
                duration={duration}
                time={time}
                playing={playing}
                speed={speed}
                muted={muted}
                narrationReady={narrationReady}
                shots={shots}
                volume={volume}
                onVolume={setVolume}
                playBlocked={guessMissing}
                onPlay={togglePlay}
                onPause={() => setPlaying(false)}
                onSeek={seek}
                onSpeed={setSpeed}
                onReset={reset}
                onMute={setMuted}
                onShots={value=>{setShots(value);if(value)setManual(false);}}
              /> : null}</div> : null}
        </main>
      </div>
    </div>
  );
}
