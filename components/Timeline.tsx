"use client";

import type { CSSProperties } from "react";
import UiIcon from "./UiIcon";

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
  volume=1,
  onVolume,
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
  volume?:number;
  onVolume?:(volume:number)=>void;
}) {
  const span = Math.max(duration, 0.01);
  const shown = Math.min(time, span);
  const fill = { "--fill": `${(shown / span) * 100}%` } as CSSProperties;

  return (
    <div className="timeline">
      <div className="timeline-row">
        <button
          type="button"
          className="btn btn-primary timeline-play"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!playing && playBlocked}
          title={playBlocked ? "Enter a prediction before you play." : undefined}
          onClick={playing ? onPause : onPlay}
        >
          <UiIcon name={playing ? "pause" : "play"} size={24}/>
        </button>
        <button type="button" className="btn timeline-reset" aria-label="Reset" title="Reset" onClick={onReset}>
          <UiIcon name="reset"/>
        </button>
        <output className="clock num">
          {shown.toFixed(2)} s / {span.toFixed(2)} s
        </output>
        <input className="scrub" style={fill} type="range" min={0} max={span} step={0.01} value={shown} aria-label="Scrub the animation" onChange={event=>onSeek(Number(event.target.value))}/>
        <div className="timeline-tail">
          <label className="field">
            <select aria-label="Speed" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
              {SPEEDS.map((option) => (
                <option key={option} value={option}>
                  {option}x
                </option>
              ))}
            </select>
          </label>
          <div className="timeline-audio">
            <button className="timeline-sound" type="button" aria-label={muted?"Enable narration":"Mute narration"} aria-pressed={!muted} disabled={!narrationReady} title={narrationReady ? "Narration" : "This browser has no speech voice installed."} onClick={()=>onMute(!muted)}><UiIcon name={muted?"mute":"volume"}/></button>
            {onVolume ? <input type="range" aria-label="Narration volume" min={0} max={1} step={.05} value={volume} disabled={!narrationReady} onChange={event=>onVolume(Number(event.target.value))}/> : null}
          </div>
          <label className="toggle timeline-follow">
            <input type="checkbox" checked={shots} onChange={(event) => onShots(event.target.checked)} />
            <span>Follow camera</span>
            <span className="timeline-switch" aria-hidden="true"/>
          </label>
        </div>
      </div>
    </div>
  );
}
