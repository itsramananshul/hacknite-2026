"use client";

import type { CSSProperties } from "react";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export default function Timeline({
  duration,
  time,
  playing,
  speed,
  muted,
  narrationReady,
  shots,
  playBlocked = false,
  onPlay,
  onPause,
  onSeek,
  onSpeed,
  onReset,
  onMute,
  onShots,
}: {
  duration: number;
  time: number;
  playing: boolean;
  speed: number;
  muted: boolean;
  narrationReady: boolean;
  shots: boolean;
  playBlocked?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onSpeed: (speed: number) => void;
  onReset: () => void;
  onMute: (muted: boolean) => void;
  onShots: (shots: boolean) => void;
}) {
  const span = Math.max(duration, 0.01);
  const shown = Math.min(time, span);
  const fill = { "--fill": `${(shown / span) * 100}%` } as CSSProperties;

  return (
    <div className="timeline">
      <div className="timeline-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!playing && playBlocked}
          title={playBlocked ? "Enter a prediction before you play." : undefined}
          onClick={playing ? onPause : onPlay}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          Reset
        </button>
        <output className="clock num">
          {shown.toFixed(2)} s / {span.toFixed(2)} s
        </output>
        <div className="timeline-tail">
          <label className="field">
            <span>Speed</span>
            <select value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
              {SPEEDS.map((option) => (
                <option key={option} value={option}>
                  {option}x
                </option>
              ))}
            </select>
          </label>
          <label className="toggle" title={narrationReady ? undefined : "This browser has no speech voice installed."}>
            <input
              type="checkbox"
              checked={!muted}
              disabled={!narrationReady}
              onChange={(event) => onMute(!event.target.checked)}
            />
            Narration
          </label>
          <label className="toggle">
            <input type="checkbox" checked={shots} onChange={(event) => onShots(event.target.checked)} />
            Step camera
          </label>
        </div>
      </div>
      <input
        className="scrub"
        style={fill}
        type="range"
        min={0}
        max={span}
        step={0.01}
        value={shown}
        aria-label="Scrub the animation"
        onChange={(event) => onSeek(Number(event.target.value))}
      />
    </div>
  );
}
