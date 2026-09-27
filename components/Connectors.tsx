"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneScript } from "@/lib/schema";
import type { SampleRef } from "./SceneObjects";

type Connector = SceneScript["connectors"][number];
type LineHandle = THREE.Object3D & { geometry: { setPositions(points: Float32Array): void } };

function ConnectorLine({ connector, sampleRef }: { connector: Connector; sampleRef: SampleRef }) {
  const ref = useRef<THREE.Object3D | null>(null);
  const count = connector.kind === "spring" ? 100 : 2;
  const points = useMemo(() => new Float32Array(count * 3), [count]);
  const axis = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const start = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  // Allocate every segment before Three caches the instanced draw count.
  const seed = useMemo(() => Array.from({length:count},(_,i)=>[0,i*.001,0] as [number,number,number]), [count]);

  useFrame(() => {
    const line = ref.current as LineHandle | null;
    const sample = sampleRef.current;
    if (!line || !sample) return;
    const resolve = (endpoint: string, destination: THREE.Vector3): boolean => {
      const object = sample.objects.find((item) => item.id === endpoint);
      if (object) {
        destination.fromArray(object.position);
        return object.visible;
      }
      const coordinates = endpoint.split(",").map(Number);
      if (coordinates.length !== 3 || !coordinates.every(Number.isFinite)) return false;
      destination.set(coordinates[0], coordinates[1], coordinates[2]);
      return true;
    };
    line.visible = resolve(connector.from, start) && resolve(connector.to, end);
    if (!line.visible) return;
    axis.subVectors(end, start);
    const length = axis.length();
    if (length < 1e-6) { line.visible = false; return; }
    axis.normalize();
    normal.set(Math.abs(axis.y) < 0.9 ? 0 : 1, Math.abs(axis.y) < 0.9 ? 1 : 0, 0);
    normal.cross(axis).normalize();
    tangent.crossVectors(axis, normal).normalize();
    for (let index = 0; index < count; index += 1) {
      const fraction = index / (count - 1);
      point.lerpVectors(start, end, fraction);
      if (connector.kind === "spring" && index > 0 && index < count - 1) {
        const radius = Math.min(0.12, length / 12);
        const angle = fraction * Math.PI * 20;
        point.addScaledVector(normal, Math.cos(angle) * radius);
        point.addScaledVector(tangent, Math.sin(angle) * radius);
      }
      point.toArray(points, index * 3);
    }
    line.geometry.setPositions(points);
  });

  return <Line ref={(node) => { ref.current = node; }} points={seed} color="#536579" lineWidth={connector.kind === "rod" ? 4 : 2} />;
}

export default function Connectors({ scene, sampleRef }: { scene: SceneScript; sampleRef: SampleRef }) {
  return <group>{scene.connectors.map((connector) => <ConnectorLine key={connector.id} connector={connector} sampleRef={sampleRef} />)}</group>;
}
