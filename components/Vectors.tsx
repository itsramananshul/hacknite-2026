"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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
        new THREE.Color(vector.color || "#a3e0c0"),
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
      <group ref={labelHolder}><Html center zIndexRange={[22, 0]} style={{ pointerEvents: "none" }}>
        <span className="tag3d tag3d-vector">
          {vector.label || vector.kind}
          <b>{shownMagnitude.toFixed(2)}</b>
        </span>
      </Html></group>
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
