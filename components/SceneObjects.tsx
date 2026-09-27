"use client";

import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { compileScene } from "@/lib/expressions";
import type { SceneObject, SceneScript } from "@/lib/schema";

export type CompiledSceneApi = ReturnType<typeof compileScene>;
export type SceneSample = ReturnType<CompiledSceneApi["sample"]>;
export type SampleRef = React.MutableRefObject<SceneSample | null>;
export type TimeRef = React.MutableRefObject<number>;

type LineHandle = THREE.Object3D & { geometry: { setPositions(points: Float32Array): void } };

const MAX_POINTS = 160;
const PATH_REFRESH_MS = 90;

interface Sizes {
  x: number;
  y: number;
  z: number;
  radius: number;
}

function readSize(object: SceneObject): Sizes {
  return {
    x: Math.max(0.02, object.size.x || 1),
    y: Math.max(0.02, object.size.y || 1),
    z: Math.max(0.02, object.size.z || 1),
    radius: Math.max(0.02, object.size.radius || 0.18),
  };
}

function liesFlatByDefault(object: SceneObject): boolean {
  const zero = (value: string) => value.trim() === "0";
  return zero(object.rotation.x) && zero(object.rotation.y) && zero(object.rotation.z);
}

function Shape({ object, lit }: { object: SceneObject; lit: boolean }) {
  const size = readSize(object);
  const material = (
    <meshStandardMaterial
      color={object.color}
      roughness={0.6}
      metalness={0.08}
      emissive={lit ? "#a3e0c0" : "#000000"}
      emissiveIntensity={lit ? 0.42 : 0}
    />
  );
  switch (object.shape) {
    case "box":
    case "car":
    case "ramp":
      return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[size.x, size.y, size.z]} />
          {material}
        </mesh>
      );
    case "sphere":
    case "planet":
    case "pendulumBob":
      return (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[size.radius, 28, 20]} />
          {material}
        </mesh>
      );
    case "cylinder":
    case "pulley":
      return (
        <mesh castShadow receiveShadow rotation={object.shape === "pulley" ? [Math.PI / 2, 0, 0] : undefined}>
          <cylinderGeometry args={[size.radius, size.radius, object.shape === "pulley" ? size.z : size.y, 24]} />
          {material}
        </mesh>
      );
    case "cone":
      return (
        <mesh castShadow receiveShadow>
          <coneGeometry args={[size.radius, size.y, 24]} />
          {material}
        </mesh>
      );
    default:
      return (
        <mesh castShadow receiveShadow rotation={liesFlatByDefault(object) ? [-Math.PI / 2, 0, 0] : undefined}>
          <planeGeometry args={[size.x, size.z]} />
          {material}
        </mesh>
      );
  }
}

function labelHeight(object: SceneObject): number {
  const size = readSize(object);
  if (object.shape === "plane") return 0.12;
  if (object.shape === "box" || object.shape === "car") return size.y / 2 + 0.32;
  return size.radius + 0.3;
}

function Body({ object, sampleRef, lit }: { object: SceneObject; sampleRef: SampleRef; lit: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const node = group.current;
    const sample = sampleRef.current;
    if (!node || !sample) return;
    const frame = sample.objects.find((item) => item.id === object.id);
    if (!frame) {
      node.visible = false;
      return;
    }
    node.visible = frame.visible;
    node.position.set(frame.position[0], frame.position[1], frame.position[2]);
    node.rotation.set(frame.rotation[0], frame.rotation[1], frame.rotation[2]);
  });

  return (
    <group ref={group}>
      <Shape object={object} lit={lit} />
      {object.label ? (
        <Html position={[0, labelHeight(object), 0]} center zIndexRange={[24, 0]} style={{ pointerEvents: "none" }}>
          <span className="tag3d">{object.label}</span>
        </Html>
      ) : null}
    </group>
  );
}

function buildPath(compiled: CompiledSceneApi, values: Record<string, number>, id: string, duration: number): Float32Array {
  const count = Math.min(MAX_POINTS, Math.max(2, Math.ceil(duration * 26) + 1));
  const flat = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const sample = compiled.sample((index / (count - 1)) * duration, values);
    const frame = sample.objects.find((item) => item.id === id);
    const source = frame ? frame.position : [0, 0, 0];
    flat[index * 3] = source[0];
    flat[index * 3 + 1] = source[1];
    flat[index * 3 + 2] = source[2];
  }
  return flat;
}

function toPoints(flat: Float32Array): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < flat.length; index += 3) {
    points.push(new THREE.Vector3(flat[index], flat[index + 1], flat[index + 2]));
  }
  return points;
}

function Trail({
  object,
  compiled,
  values,
  duration,
  timeRef,
}: {
  object: SceneObject;
  compiled: CompiledSceneApi;
  values: Record<string, number>;
  duration: number;
  timeRef: TimeRef;
}) {
  const faint = useRef<THREE.Object3D | null>(null);
  const live = useRef<THREE.Object3D | null>(null);
  const drawn = useRef(-1);
  const stamp = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const full = useMemo(
    () => buildPath(compiled, valuesRef.current, object.id, duration),
    [compiled, object.id, duration],
  );
  const flat = useRef(full);
  const seed = useMemo(
    () => [new THREE.Vector3(full[0], full[1], full[2]), new THREE.Vector3(full[3], full[4], full[5])],
    [],
  );

  const rebuild = useCallback(() => {
    const next = buildPath(compiled, valuesRef.current, object.id, duration);
    flat.current = next;
    drawn.current = -1;
    (faint.current as LineHandle | null)?.geometry.setPositions(next);
  }, [compiled, object.id, duration]);

  useEffect(() => {
    flat.current = full;
    drawn.current = -1;
    (faint.current as LineHandle | null)?.geometry.setPositions(full);
  }, [full]);

  useEffect(() => {
    const wait = PATH_REFRESH_MS - (Date.now() - stamp.current);
    if (timer.current !== null) clearTimeout(timer.current);
    if (wait <= 0) {
      stamp.current = Date.now();
      rebuild();
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      stamp.current = Date.now();
      rebuild();
    }, wait);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [values, rebuild]);

  useFrame(() => {
    const line = live.current as LineHandle | null;
    if (!line) return;
    const source = flat.current;
    const total = source.length / 3;
    const count = Math.max(
      2,
      Math.min(total, Math.ceil((timeRef.current / Math.max(duration, 0.001)) * total) + 1),
    );
    if (count === drawn.current) return;
    drawn.current = count;
    line.geometry.setPositions(count >= total ? source : source.slice(0, count * 3));
  });

  return (
    <group>
      <Line
        ref={(node) => {
          faint.current = node;
        }}
        points={toPoints(full)}
        color="#7fb99c"
        lineWidth={1}
        transparent
        opacity={0.26}
      />
      <Line
        ref={(node) => {
          live.current = node;
        }}
        points={seed}
        color="#a3e0c0"
        lineWidth={2.2}
        transparent
        opacity={0.95}
      />
    </group>
  );
}

export default function SceneObjects({
  scene,
  compiled,
  values,
  sampleRef,
  timeRef,
  highlighted,
}: {
  scene: SceneScript;
  compiled: CompiledSceneApi;
  values: Record<string, number>;
  sampleRef: SampleRef;
  timeRef: TimeRef;
  highlighted: string[];
}) {
  const lit = useMemo(() => new Set(highlighted), [highlighted]);
  return (
    <group>
      {scene.objects.map((object) => (
        <Body key={object.id} object={object} sampleRef={sampleRef} lit={lit.has(object.id)} />
      ))}
      {scene.objects
        .filter((object) => object.trail)
        .map((object) => (
          <Trail
            key={`trail-${object.id}`}
            object={object}
            compiled={compiled}
            values={values}
            duration={scene.duration}
            timeRef={timeRef}
          />
        ))}
    </group>
  );
}
