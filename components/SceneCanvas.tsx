"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SceneScript } from "@/lib/schema";
import { compileScene } from "@/lib/expressions";
import Connectors from "./Connectors";
import SceneObjects, { type CompiledSceneApi, type SampleRef, type TimeRef } from "./SceneObjects";
import Vectors from "./Vectors";
import {LabelLayout,type LabelBox} from "./LabelLayout";

export interface Shot {
  position: [number, number, number];
  target: [number, number, number];
}

export interface Highlight {
  objects: string[];
  vectors: string[];
}

export interface SceneCanvasProps {
  scene: SceneScript;
  values: Record<string, number>;
  playing: boolean;
  time: number;
  speed: number;
  restart?: number;
  onTime: (time: number) => void;
  onComplete: () => void;
  shot: Shot | null;
  onManualOrbit: () => void;
  sharedClock: React.MutableRefObject<number>;
  follower?: boolean;
  highlight?: Highlight | null;
  onLoop?: () => void;
}

const FRAME_GAP_CAP = 0.1;
const REPORT_SECONDS = 0.1;

function webglSupported(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

function BoardFallback({ reason }: { reason: string }) {
  return (
    <div className="board-fallback" role="status">
      <h2>The 3D board is not available</h2>
      <p>
        {reason} The equations, controls and calculated answers remain available.
      </p>
    </div>
  );
}

class BoardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.setState({ failed: true });
  }

  render() {
    if (this.state.failed) {
      return <BoardFallback reason="This browser closed the WebGL context while the board was drawing." />;
    }
    return this.props.children;
  }
}

function Driver({
  compiled,
  duration,
  loop,
  values,
  playing,
  speed,
  time,
  shot,
  onTime,
  onComplete,
  onLoop,
  sampleRef,
  timeRef,
  sharedClock,
  follower,
  restart,
}: {
  compiled: CompiledSceneApi;
  duration: number;
  loop: boolean;
  values: Record<string, number>;
  playing: boolean;
  speed: number;
  time: number;
  shot: Shot | null;
  onTime: (time: number) => void;
  onComplete: () => void;
  onLoop?: () => void;
  sampleRef: SampleRef;
  timeRef: TimeRef;
  sharedClock: React.MutableRefObject<number>;
  follower: boolean;
  restart: number;
}) {
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const clock = useRef(0);
  const reported = useRef(-1);
  const ended = useRef(false);
  const reportIn = useRef(0);
  const stamps = useRef({ time: Number.NaN, key: "" });
  const valuesRef = useRef(values);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const timeCallback = useRef(onTime);
  const completeCallback = useRef(onComplete);
  const loopCallback = useRef(onLoop);
  const shotRef = useRef(shot);
  const followerRef = useRef(follower);
  const loopRef = useRef(loop);
  const shared = useRef(sharedClock);
  const goalPosition = useMemo(() => new THREE.Vector3(), []);
  const goalTarget = useMemo(() => new THREE.Vector3(), []);

  valuesRef.current = values;
  playingRef.current = playing;
  speedRef.current = speed;
  timeCallback.current = onTime;
  completeCallback.current = onComplete;
  loopCallback.current = onLoop;
  shotRef.current = shot;
  followerRef.current = follower;
  loopRef.current = loop;
  shared.current = sharedClock;

  useEffect(() => {
    if (playingRef.current || followerRef.current) return;
    clock.current = Math.min(Math.max(time, 0), duration);
  }, [time, duration]);

  useEffect(() => {
    stamps.current = { time: Number.NaN, key: "" };
    sampleRef.current = null;
    clock.current = 0;
    ended.current = false;
  }, [compiled, sampleRef, restart]);

  useFrame((state, delta) => {
    const gap = Math.min(delta, FRAME_GAP_CAP);
    if (typeof document !== "undefined" && document.hidden) return;

    if (followerRef.current) {
      clock.current = Math.min(Math.max(shared.current.current, 0), duration);
    } else {
      if (playingRef.current) clock.current += gap * speedRef.current;
      if (playingRef.current && clock.current >= duration) {
        if (loopRef.current) {
          clock.current %= duration;
          ended.current = false;
          loopCallback.current?.();
        } else {
          clock.current = duration;
          if (!ended.current) {
            ended.current = true;
            completeCallback.current();
          }
        }
      }
      if (clock.current < duration - 1e-6) ended.current = false;
      shared.current.current = clock.current;
    }

    timeRef.current = clock.current;
    const key = JSON.stringify(valuesRef.current);
    if (stamps.current.time !== clock.current || stamps.current.key !== key) {
      stamps.current = { time: clock.current, key };
      sampleRef.current = compiled.sample(clock.current, valuesRef.current);
    }

    const goal = shotRef.current;
    if (goal) {
      const ease = 1 - Math.exp(-3.4 * gap);
      goalPosition.set(goal.position[0], goal.position[1], goal.position[2]);
      goalTarget.set(goal.target[0], goal.target[1], goal.target[2]);
      state.camera.position.lerp(goalPosition, ease);
      if (controls) {
        controls.target.lerp(goalTarget, ease);
        controls.update();
      } else {
        state.camera.lookAt(goalTarget);
      }
    }

    reportIn.current += gap;
    if (!followerRef.current && reportIn.current >= REPORT_SECONDS) {
      reportIn.current = 0;
      if (Math.abs(clock.current - reported.current) > 1e-4) {
        reported.current = clock.current;
        timeCallback.current(clock.current);
      }
    }
  }, -2);

  return null;
}

export default function SceneCanvas({
  scene,
  values,
  playing,
  time,
  speed,
  onTime,
  onComplete,
  shot,
  onManualOrbit,
  sharedClock,
  follower = false,
  highlight = null,
  onLoop,
  restart = 0,
}: SceneCanvasProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const compiled = useMemo(() => compileScene(scene), [scene]);
  const sceneValues = useMemo(() => Object.fromEntries(scene.variables.map((variable) => {
    const candidate = values[variable.name];
    const value = Number.isFinite(candidate) && candidate >= variable.min && candidate <= variable.max ? candidate : variable.value;
    return [variable.name, value];
  })), [scene, values]);
  const sampleRef = useRef<null>(null) as SampleRef;
  const labelBoxes=useRef<LabelBox[]>([]);
  const timeRef = useRef(0) as TimeRef;
  const loopRef = useRef(scene.loop);
  loopRef.current = scene.loop;

  useEffect(() => {
    setSupported(webglSupported());
  }, []);

  if (supported === false) {
    return (
      <BoardFallback reason="This browser or this device has no working WebGL, so the 3D board cannot be drawn here." />
    );
  }

  return (
    <BoardBoundary key={scene.title}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: scene.camera.position, fov: 42, near: 0.05, far: 800 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#DCE1E5", 1);
        }}
      >
        <Driver
          compiled={compiled}
          duration={scene.duration}
          loop={scene.loop}
          values={sceneValues}
          playing={playing}
          speed={speed}
          time={time}
          shot={shot}
          onTime={onTime}
          onComplete={onComplete}
          onLoop={onLoop}
          sampleRef={sampleRef}
          timeRef={timeRef}
          sharedClock={sharedClock}
          follower={follower}
          restart={restart}
        />
        <ambientLight intensity={0.6} color="#d7ebe1" />
        <hemisphereLight intensity={0.34} color="#e2f3ea" groundColor="#788895" />
        <directionalLight
          castShadow
          position={[12, 18, 9]}
          intensity={1.6}
          color="#fff2df"
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={1}
          shadow-camera-far={90}
          shadow-camera-left={-28}
          shadow-camera-right={28}
          shadow-camera-top={28}
          shadow-camera-bottom={-28}
          shadow-bias={-0.0005}
        />
        <directionalLight position={[-10, 7, -12]} intensity={0.32} color="#a3e0c0" />
        {scene.world.showGrid ? (
          <Grid
            position={[0, scene.world.groundY, 0]}
            args={[160, 160]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#B6BFC8"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#99A5B2"
            fadeDistance={72}
            fadeStrength={1.5}
            infiniteGrid
          />
        ) : null}
        <mesh position={[0, scene.world.groundY - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <shadowMaterial transparent opacity={0.26} />
        </mesh>
        <LabelLayout.Provider value={labelBoxes}>
        <SceneObjects
          scene={scene}
          compiled={compiled}
          values={sceneValues}
          sampleRef={sampleRef}
          timeRef={timeRef}
          highlighted={highlight ? highlight.objects : []}
        />
        <Connectors scene={scene} sampleRef={sampleRef} />
        <Vectors vectors={scene.vectors} sampleRef={sampleRef} timeRef={timeRef} only={highlight ? highlight.vectors : null} />
        </LabelLayout.Provider>
        <OrbitControls
          makeDefault
          target={scene.camera.target}
          enableDamping
          dampingFactor={0.12}
          minDistance={3}
          maxDistance={90}
          maxPolarAngle={Math.PI / 2 - 0.02}
          onStart={onManualOrbit}
        />
      </Canvas>
    </BoardBoundary>
  );
}
