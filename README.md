# Chalk

An interactive physics workspace by Anshul Raman. Give it a numerical problem as text or a photo, then explore its solution through a 3D scene, equations, and adjustable values.

The interface follows the supplied Chalk design: a green board, handwritten wordmark, compact controls, and a cream answer panel.

## Features

- Seven offline examples: projectile motion, a rough incline, an Atwood pulley, a circular orbit, elastic collision, ideal pipe flow, and a travelling wave.
- 3D playback, trails, force and velocity arrows, connectors, camera shots, timeline scrubbing, and speed controls.
- Adjustable parameters and recalculated answers without a model call.
- Original and changed scenes on a shared timeline.
- Predict before Play with hidden answers and numerical feedback.
- Clickable equations that highlight the corresponding step's objects and vectors.
- Visible problem statements, model assumptions, warnings, and worked solutions.
- Text, photo upload, manual webcam capture, and natural-language scene edits.
- Optional browser narration, muted initially. Availability depends on the browser.
- Share links that restore a validated scene and its parameter values.

## Run locally

Install dependencies with `npm install`. Copy `.env.example` to `.env.local`, set a server-side `GEMINI_API_KEY`, and select an available Gemini model with `GEMINI_MODEL`. Production currently uses `gemini-3.6-flash`. Never put the key in a `NEXT_PUBLIC_` variable.

```sh
npm run dev
npm test
npm run typecheck
npm run build
```

## Solver and scene checks

`POST /api/solve` accepts problem text or a resized image. The first Gemini call uses code execution to compute numerical answers. The second returns a structured scene script with math expressions instead of executable rendering code. `POST /api/edit` re-solves the problem after the requested change using the same pipeline.

Expressions are parsed with mathjs and checked against an AST whitelist before compilation. Assignments, property access, arbitrary functions, strings, and nonfinite results are rejected. Validation checks references, bounds, 200 timeline samples, selected slider extremes, and answer agreement within 2 percent. An invalid scene receives one repair attempt. A safe scene with a remaining answer mismatch carries a warning; an unsafe scene is withheld.

These checks catch structural and numerical errors. They do not prove that an inferred physical model fits a problem. The examples use stated idealizations; the pipe example uses continuity and Bernoulli rather than a turbulence solver. New problems may produce an explanation or diagram that is less complete than a cached example.

## Rendering

React Three Fiber and drei render the scene. A compiled expression sampler drives objects, vectors, connectors, and answers. Comparison uses one shared clock. Paths are capped at 160 samples, and vector readouts refresh on a throttle. KaTeX displays the authored equations. If WebGL is unavailable, the interface keeps calculated answers and explanatory controls available.

## Validation

The 126 tests cover unsafe expressions, scene references, numerical checks, slider ranges, projectile landing, incline motion, pulley motion, orbital relationships, collision conservation, ideal flow, and waves. Production build and TypeScript checks pass.

## Deployment

Deploy with `npx vercel deploy --prod` after configuring server environment variables in the linked project. Model quotas and API credit belong to the Google account; quota and billing failures are reported visibly, and cached examples remain usable. A Google 402 response requires available API credit or a different working key before live solving can succeed.
