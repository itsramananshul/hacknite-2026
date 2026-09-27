# Chalk

An interactive science and mathematics notebook by Anshul Raman and Jayrajsinh Gohil. Give it a numerical problem as text or a photo, then explore its solution through a 3D scene, equations, and adjustable values.

The interface follows the supplied notebook design: warm white pages, serif derivations, blue controls, and a light 3D viewport.

## Features

- Ten offline examples: projectile motion, a rough incline, an Atwood pulley, a circular orbit, elastic collision, ideal pipe flow, a travelling wave, damped springs, a source-free RLC circuit, and falling through a fluid with linear drag.
- Separate explanation-video and interactive-simulation views. Generate a real MP4 with Manim: spoken explanation, typeset equations, a diagram following the checked motion, and final answers. Download the completed film.
- 3D playback, trails, force and velocity arrows, connectors, camera shots, timeline scrubbing, and speed controls.
- Adjustable parameters and recalculated answers without a model call.
- Predict before Play with hidden answers and numerical feedback.
- Clickable equations that highlight the corresponding step's objects and vectors.
- Visible problem statements, model assumptions, warnings, and worked solutions.
- Text, photo upload, manual webcam capture, and natural-language scene edits.
- Each submitted question opens its own notebook page immediately, with a generation status and streamed answers. Pages and manually created notebooks are saved to your Supabase account and can be reopened from another signed-in browser. The Notebooks rail opens the notebook and question tree. New accounts create their own first notebook.
- Optional browser narration, muted initially. Availability depends on the browser.
- Share links that restore a validated scene and its parameter values.

## Run locally

Install dependencies with `npm install` and copy `.env.example` to `.env.local`. Sign in to your existing OpenCode Go account in OpenCode. The startup uses DeepSeek V4.1 Flash for text and photos; Gemini is not required. Keep authentication in OpenCode's local account store, never in browser code. Set `CHALK_HOST=0.0.0.0` to serve the website over your Wi-Fi. The model bridge stays on loopback.

```sh
npm run dev:opencode
npm test
npm run typecheck
npm run build
```

## Solver and scene checks

`POST /api/solve` accepts problem text or a resized image. The first OpenCode model call returns a worked solution and constant arithmetic expressions. Chalk evaluates these expressions on the server to obtain numerical answers. The second call returns a structured scene script with math expressions instead of executable rendering code. `POST /api/edit` re-solves the problem after the requested change using the same pipeline. Each runtime session denies tools and is cleaned up when the request ends; problem text cannot invoke coding tools.

Expressions are parsed with mathjs and checked against an AST whitelist before compilation. Assignments, property access, arbitrary functions, strings, and nonfinite results are rejected. Validation checks references, bounds, 200 timeline samples, selected slider extremes, and answer agreement within 2 percent. New OpenCode/Ollama scenes are also checked for ineffective sliders: each adjustable variable must change evaluated answers or sampled geometry. An invalid scene receives one repair attempt. The OpenCode path withholds a scene that remains invalid or disagrees with the calculated answers.

The browser requests an NDJSON stream and displays calculated answers before scene generation completes. JSON clients retain the original complete-response format. A live Venturi-manometer photo test returned checked answers in 10.4 seconds and a validated scene in 158.3 seconds, including repair. These are measured timings, not a latency guarantee. Ollama on a second computer remains available through the setup in `MAC_MODEL_SETUP.md`.

These checks catch structural and numerical errors. They do not prove that an inferred physical model fits a problem. The examples use stated idealizations; the pipe example uses continuity and Bernoulli rather than a turbulence solver. New problems may produce an explanation or diagram that is less complete than a cached example.

## Rendering

React Three Fiber and drei render the scene. A compiled expression sampler drives objects, vectors, connectors, and answers. Paths are capped at 160 samples, and vector readouts refresh on a throttle. KaTeX displays the authored equations. If WebGL is unavailable, the interface keeps calculated answers and explanatory controls available.

## Explanation videos

Run `npm run setup:video` once to install the isolated Python/Manim runtime, then start the local app. Select **Watch explanation**, then **Generate explanation video**. Python, FFmpeg, and a TeX installation are needed for rendering and typeset equations. On Windows, installed System.Speech voices provide narration; other systems currently render written explanations without voice. The renderer uses a fixed Python template and validated sampled scene data, never generated Python code. Rendering runs in a background job and the MP4 appears when complete. The video job reference is saved with its question, so switching views or refreshing can resume the completed or in-progress film. MP4 files remain on the local host: another browser can play them through that same server, but this is not cloud media storage. Video generation currently runs locally, not on Vercel.

The advanced examples implement specific analytic differential-equation models: underdamped viscous spring motion, underdamped source-free series RLC response, and linear fluid drag. They state initial conditions, idealizations and sign conventions. Circuit motion is a charge indicator rather than an electron trajectory. These are not universal solvers for turbulence, nonlinear systems, or arbitrary advanced physics.

## Validation

Tests cover unsafe expressions, scene references, numerical checks, slider ranges, projectile landing, incline motion, pulley motion, orbital relationships, collision conservation, ideal flow, and waves. OpenCode integration tests additionally check constant answer calculation, denied tools, provider failures, and request cleanup. Run the commands above to validate your checkout.

## Deployment

The OpenCode bridge connects only to a server on the same computer. Run Chalk at `http://127.0.0.1:3000/` and keep the local OpenCode server running. The startup command starts or reuses the server on port 4098. Change the model IDs through the `OPENCODE_MODEL` and `OPENCODE_VISION_MODEL` environment variables. Usage follows your existing OpenCode account's limits.

For an optional hosted Google backend, set `CHALK_SOLVER=gemini` and a server-side `GEMINI_API_KEY`. That path retains Google's code-execution solver. A Vercel deployment cannot reach your laptop's loopback OpenCode server. Install the Vercel CLI with `npm i -g vercel` for deployment, environment management, and logs. Never put provider keys in a `NEXT_PUBLIC_` variable.
