"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {LabelLayout} from "./LabelLayout";
import {placeLabel} from "@/lib/label-layout";
import * as THREE from "three";
import type { SceneVector } from "@/lib/schema";
import type { SampleRef, TimeRef } from "./SceneObjects";

const SCALE = 0.32;
const MAX_LENGTH = 3.2;
const LABEL_SECONDS = 0.12;
const LABEL_DRIFT = 0.005;

function VectorGlyph({
  vector,
  sampleRef,
  timeRef,
}: {
  vector: SceneVector;
  sampleRef: SampleRef;
  timeRef: TimeRef;
}) {
  const holder = useRef<THREE.Group>(null);
  const camera=useThree(state=>state.camera);
  const layout=useContext(LabelLayout);
  const screen=useMemo(()=>new THREE.Vector3(),[]);
  const extent=useMemo(()=>new THREE.Vector3(),[]);
  const basis=useMemo(()=>new THREE.Vector3(),[]);
  const labelHolder = useRef<THREE.Group>(null);
  const [shownMagnitude, setShownMagnitude] = useState(0);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const shownAt = useRef(-1);
  const shownValue = useRef(Number.NaN);
  const arrow = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        1,
        new THREE.Color(vector.kind === "velocity" ? "#176BFA" : vector.color || "#176BFA"),
        0.2,
        0.12,
      ),
    [vector.color],
  );

  useEffect(() => () => arrow.dispose(), [arrow]);

  useFrame(() => {
    const group = holder.current;
    const sample = sampleRef.current;
    if (!group || !sample) return;
    const frame = sample.vectors.find((item) => item.id === vector.id);
    const body = sample.objects.find((item) => item.id === vector.attachTo);
    if (!frame || !body) {
      group.visible = false;
      return;
    }
    const magnitude = Math.hypot(frame.components[0], frame.components[1], frame.components[2]);
    group.visible = body.visible && frame.visible && magnitude > 1e-4;
    group.position.set(body.position[0], body.position[1], body.position[2]);
    if (!group.visible) return;
    direction.set(frame.components[0], frame.components[1], frame.components[2]).normalize();
    arrow.setDirection(direction);
    const length = Math.min(MAX_LENGTH, Math.max(0.2, magnitude * SCALE));
    arrow.setLength(length, 0.2, 0.12);
    if (labelHolder.current) {
      labelHolder.current.position.copy(direction).multiplyScalar(length + 0.3);
      labelHolder.current.position.y += 0.2;
      // Vector captions share the object-caption collision layout.
      screen.copy(labelHolder.current.position).add(group.position);
      extent.copy(screen).addScaledVector(basis.setFromMatrixColumn(camera.matrixWorld,0),Math.min(3,(`${vector.label || vector.kind} ${magnitude.toFixed(2)}`).length*.11)/2).project(camera);
      screen.project(camera);
      const half=Math.abs(extent.x-screen.x)+.025;
      extent.copy(labelHolder.current.position).add(group.position).addScaledVector(basis.setFromMatrixColumn(camera.matrixWorld,1),.24).project(camera);
      const height=Math.abs(extent.y-screen.y)+.025;
      const boxes=layout?.current || [];
      const position=placeLabel(screen.x,screen.y,half,height,boxes);
      screen.x=position.x;screen.y=position.y;
      labelHolder.current.position.copy(screen.unproject(camera)).sub(group.position);
    }
    const now = timeRef.current;
    const drifted = Math.abs(magnitude - shownValue.current) > LABEL_DRIFT;
    const due = now - shownAt.current > LABEL_SECONDS;
    if (drifted || due) {
      setShownMagnitude(magnitude);
      shownAt.current = now;
      shownValue.current = magnitude;
    }
  });

  return (
    <group ref={holder}>
      <primitive object={arrow} />
      <group ref={labelHolder}><Billboard>
        <Text font="/fonts/chalk-mono.ttf" fontSize={0.18} maxWidth={3} color="#101D33" outlineWidth={0.006} outlineColor="#DCE1E5" anchorX="center" anchorY="bottom">{`${vector.label || vector.kind} ${shownMagnitude.toFixed(2)}`}</Text>
      </Billboard></group>
    </group>
  );
}

export default function Vectors({
  vectors,
  sampleRef,
  timeRef,
  only,
}: {
  vectors: SceneVector[];
  sampleRef: SampleRef;
  timeRef: TimeRef;
  only: string[] | null;
}) {
  const allowed = useMemo(() => (only ? new Set(only) : null), [only]);
  return (
    <group>
      {vectors
        .filter((vector) => (allowed ? allowed.has(vector.id) : true))
        .map((vector) => (
          <VectorGlyph key={vector.id} vector={vector} sampleRef={sampleRef} timeRef={timeRef} />
        ))}
    </group>
  );
}
