# Chalk

Chalk is a physics teaching board. Draw a mechanics problem, watch your own
sketch move, and read the closed form answer for the same scene with its
assumptions written out underneath.

## Run it locally

```bash
npm install
npm run dev     # http://127.0.0.1:3000
```

Other commands:

```bash
npm test        # node:test physics suite through tsx
npm run typecheck
npm run build
```

Node 20 or newer is required. The app ships no external font and makes no
network request of its own.

## Environment

The three presets bundled in `lib/presets.ts` work offline with no keys at all.
Reading a drawing, annotating a board, and asking Gemini for the reasoning need
the variables in `.env.example`:

```bash
GEMINI_API_KEY=                       # server only, from aistudio.google.com/apikey
GEMINI_MODEL=gemini-2.5-flash
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=       # tldraw watermark removal, safe in the browser
```

`GEMINI_API_KEY` is never given a `NEXT_PUBLIC_` prefix on purpose: a
`NEXT_PUBLIC_` variable is inlined into the browser bundle. Until a key is set,
those three controls answer with a readable error and the local solver result
stays on screen, because it is computed in the browser and never depends on a
model. No claim of an end to end run with Gemini has been made here, because
none has been made in this repository.

## What the page does

- **Presets.** A box sliding down a 30 degree ramp, a ball launched at 10 m/s
  and 45 degrees, and a 1 kg mass on a 20 N/m spring, plus a freefall preset if
  the engine exports one. Presets never need a key.
- **Draw a problem.** Sketch a board on the pad or upload a photo of a chalk
  problem. The reader turns the picture into a scene, reports how confident it
  is and what it noticed, cuts a small crop of each object, and the crops are
  drawn back onto the board. `Make it move` adopts the scene, pauses it at the
  first frame, and shows the question it read.
- **Experiment.** Sliders for the numbers the scene can sweep, produced by
  `parameterSpecs` and applied with `updateSceneParameter`, so a control can
  never claim to change something the solver does not use. The crops stay on the
  objects they came from.
- **Share scene.** Encodes the scene into a `#scene=` link and offers the
  clipboard, with a read only field to copy by hand. Opening a link restores the
  numbers and pauses at the start.
- **Explain this board.** Posts the scene to `/api/explain` and shows the answer
  as text. The local solver steps stay on screen, and a request is abandoned
  when the scene changes underneath it.
- **Annotate the board.** Pauses playback, reads a PNG snapshot of the canvas,
  and lets you draw a force arrow and a label on it. The stroke becomes a force
  in the scene, and only crops whose bodies still exist survive the edit.

## Known limits

- A shared link carries the numbers of a scene and nothing else. The picture that
  was drawn is not embedded, so a board opened from a link shows the chalk
  shapes instead.
- An invalid or truncated `#scene=` link reports the problem in plain language
  and offers the incline preset rather than failing quietly.
- Crops are the only picture the board draws. A crop that is missing, still
  loading, or empty leaves the chalk shape underneath it, so the diagram is
  always readable.
- The readouts describe the state at the current instant. A partial run is
  labelled "so far", and the finished value is the solver answer in the other
  column.

## Model and assumptions

The simulation is a closed form evaluation, not a stepped integrator. Every
position, velocity, force, and energy value on the board comes from evaluating
the equations of motion for the scene at the current time, so the diagram and
the answer are the same model rather than two implementations to compare. A
scene read from a picture and a preset travel the identical route through
`resolveScene`, `getDuration`, `sampleScene`, and `solveScene`.

Assumptions behind that model:

- Units are SI throughout: metres, kilograms, seconds, and newtons. The world
  origin is the lower left corner and the y axis points up.
- Bodies stay in the plane with a constant gravity, and air resistance is
  ignored.
- A ramp is a right triangle whose x and y are its lower left corner, whose
  width is the horizontal run, and whose height is width times the tangent of
  its slope angle. Every other body position is its centre.
- Friction uses a single coefficient, so the static and kinetic values are taken
  to be the same number. On a slope a body either accelerates downhill or comes
  to rest and stays there; it never reverses.
- A body is held to a surface instead of free to tumble, so a block on a ramp
  slides rather than rolls.
- Potential energy is measured against a stated reference plane, the top of the
  ground body if the scene has one and otherwise the world floor. A body below
  that plane therefore has a negative potential energy, which the readout says
  out loud.
- A spring is a physical Hooke spring with a stiffness in N/m, not a
  dimensionless constraint. Its equilibrium length includes the effect of
  gravity, and there is no damping.
- Applied forces, if a scene declares them, are constant vectors in newtons.

`sampleScene` throws on anything outside those assumptions rather than
returning a placeholder number, and the page shows the message with a reset
action instead of a fake answer.

## Repository map

- `lib/schema.ts` scene contract, validation, and label resolution.
- `lib/geometry.ts` unit conversions and shared shape helpers.
- `lib/engine.ts` the analytical model: `sampleScene`, `getDuration`, and the
  frame type.
- `lib/solvers.ts` closed form answers used by the answer column.
- `lib/presets.ts` the offline presets.
- `lib/sprites.ts` picture scaling and the crop cut for each body.
- `lib/scene-controls.ts` the slider specifications and the scene updates behind
  them.
- `lib/share.ts` the `#scene=` encoding, decoding, and link builder.
- `lib/gemini.ts` the server side model calls.
- `app/api` the parse, edit, and explain routes.
- `components/SimulationCanvas.tsx` the canvas renderer, the sprite pass, and
  the playback clock.
- `components/SketchInput.tsx` the drawing pad, the photo upload, and the
  reading request.
- `components/AnnotationPanel.tsx` the snapshot sketch pad and the force edit
  request.
- `app/page.tsx` the single page interface.
