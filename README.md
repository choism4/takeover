![Takeover: live webcam gestures and mouse-drawn annotations become precise crop and caption edits](docs/assets/takeover-concept-v3.png)

# Vibe editing. Made physical.

**Your voice. Your gestures. Your edit.**

Lean in. Frame the shoe with your hands. **“Zoom in here.”**

See the crop. Lean back. **“Whoa, that is too close. Back off a little.”**

Raise a palm. Lower it slowly. **“Half speed.”**

**Takeover turns the way you direct into the way you edit.** Your words, visible gestures, and pointer meet at the moment on screen. The app interprets the instruction, applies it through Shoty, and brings back the rendered result. Watch, react, refine.

[See it in action](#direct-the-edit) · [Under the hood](#what-does-this-shoe-actually-mean) · [Use Takeover](#use-takeover)

## Direct the edit

Pause on a subject. Keep your face and both hands in the webcam. Point at an exact spot, or draw directly over the footage. Give the edit a direction.

| You say | You show | The edit |
| --- | --- | --- |
| “Okay, zoom in on this shoe a little.” | Lean in and frame it with both hands. | Tighten the product shot around the pointed shoe. |
| “Whoa, that is too close. Back off a little.” | Lean back and bring your hands inward. | Reduce the previous zoom. |
| “Hold on. Slow this shot down to half speed.” | Raise an open palm, then lower it slowly. | Slow the selected shot to 0.5×. |
| “This feels a little cold. Make it warmer.” | Turn your hand as if adjusting a dial. | Warm that shot's color. |
| “Add FEEL THE AIR as a caption down here.” | Point below the shoe on screen and in the camera. | Place the headline beneath the product. |
| “Make the caption bigger, and move it up a little.” | Spread your hands, then lift one palm. | Revise the same caption's size and position. |
| “Actually, undo that last change.” | Give a small backward wave while saying undo. | Restore the previous caption style. |

The spoken instruction specifies the change; your visible performance reinforces it. Each accepted direction becomes a real edit in Shoty and a new native video export. Wait for **Applied**, watch it, and keep directing.

<details>
<summary>See the workspace</summary>

![Takeover's actual workspace, with footage, director camera, and an inspectable history of applied directions](docs/assets/workspace.png)

The illustration at the top explains the concept. This is the working interface: one preview, your camera, and the directions that changed the video.

</details>

## What does “this shoe” actually mean?

That short sentence leaves out the shot, timestamp, subject, crop center, and edit amount. People fill those gaps with shared context. Takeover captures that context.

When speech begins, it records the source time, session time, and pointer position. Recent frames pair the footage with the director's camera and visible strokes. The interpreter receives those together with the current successful edit state.

That gives **“this”** a subject, **“here”** a source moment, and **“a little less”** a previous decision to revise.

Gestures support an explicit spoken instruction. A facial expression or nod alone does not authorize an edit. An unclear request produces a clarification instead of a guessed change.

## One direction, end to end

```text
Chrome
  final speech + speech-start anchor + pointer / strokes + composite frames
       │
       ▼
POST /api/direct
  cue + frames + current successful state
       │
       ▼
Multimodal planner
  Claude API, or authenticated Codex CLI
  → { status, message, evidence, edits }
       │
       ├── clarify / hold → explain; keep the current edit
       ├── undo           → restore the previous successful revision
       │
       ▼ edit
Bounded state reducer → fresh Shoty sequence → native export
       │
       ▼
Commit state + history → replace video preview → next direction
```

The model interprets intent. Application code owns the edit vocabulary, numeric bounds, shot identities, and execution. Shoty owns the timeline changes and rendering.

## Two clocks, one intended moment

The source playhead and the directing session run on different clocks. Pausing, seeking, trimming, or slowing a shot makes that distinction essential.

| Coordinate | Meaning |
| --- | --- |
| `sourceTime` | Position in the original footage when speech begins. |
| `sessionTime` | Elapsed directing time, used to align speech, pointer events, and captured context. |
| `explicitTime` | A source timestamp parsed from the spoken instruction, when present. |
| Output time | Position in the edited sequence after speed and trim changes. |

For a source point `t` inside shot `k`, output placement follows:

```text
output(t) = Σ duration(j) + clamp(t − sourceStart(k), 0, retainedLength(k)) / speed(k)
            j < k

duration(j) = round(retainedLength(j) / speed(j) × fps) / fps
```

Caption intervals live in source coordinates. Each interval is intersected with the retained portion of every shot, mapped through its speed, and quantized to output frames. A caption spanning multiple shots becomes multiple correctly placed render segments.

Pointer coordinates are normalized inside the actual video image, accounting for letterboxing. When pointing at an edited crop, the browser maps the point back into source coordinates before passing it to the interpreter.

## A small language of real edits

The planner returns one of four outcomes: `edit`, `clarify`, `hold`, or `undo`. An edit contains up to eight operations. A zoom operation, for example, carries:

```json
{
  "action": "zoom",
  "shotId": "hero",
  "value": 1.2,
  "target": { "x": 0.51, "y": 0.52 }
}
```

The schema also carries caption and interval fields; the example shows the fields relevant to zoom. The reducer validates operations against the existing shots and applies absolute settings to a cloned state.

| Operation | Bounds / behavior |
| --- | --- |
| Zoom | 1–1.8×, with a normalized source target. |
| Exposure | −1.5 to +1.5 EV. |
| Contrast / saturation | 0.5–1.6 / 0–1.8; neutral is 1. |
| Temperature | −2000 to +2000 creative units. |
| Speed | 0.5–2×; subsequent clips are placed using the new duration. |
| Trim | Shorten a shot's tail; retain at least 0.2 seconds. |
| Caption | Exact authored text, source interval, size, and position; revisions use the existing caption ID. |
| Reset / undo | Reset the selected shot, or restore the previous successful revision. |

Claude uses streamed, schema-constrained responses through the Anthropic SDK. The alternative Codex adapter runs an ephemeral, read-only CLI invocation with a JSON output schema. Both feed the same validation and execution path.

## Rendering is the commit boundary

Each edit renders into a **fresh Shoty sequence**. Clip transforms, color grades, linked audio speed, and caption graphics are applied through explicit CLI calls. The previous successful sequence remains available while export runs.

Only a completed, non-empty native export advances the server's state and undo history. On failure, the preview retains the last successful result and the engine attempts to reopen its sequence. Voice undo restores a previous sequence and immutable export without asking the model to recreate the edit.

The browser queues directions. The server additionally rejects concurrent edit requests with `409`. Each direction records its progression through interpretation, editing, rendering, and completion or failure.

**Start directing** also starts a composite recording of footage, pointer, webcam, transcript, and director microphone audio. **Stop directing** waits for queued work, then saves the recording and a JSON session manifest. This session recording and the native edited video are separate outputs.

## Use Takeover

1. **Start directing.** Allow camera and microphone access. Keep your face and hands in view.
2. **Show the moment.** Pause on the subject, point to it, or draw a mark on the footage.
3. **Give a direction.** Speak naturally. Wait for **Applied** before the next instruction.
4. **Refine it.** Watch the rendered result, adjust the previous decision, or ask to undo it. **Space** plays or pauses.
5. **Stop directing.** Save the composite recording and the session's direction log. The native edited video is a separate output.

The workspace runs locally in desktop Chrome. It connects to a configured Shoty project and a multimodal interpreter. Source media, edited exports, and session recordings are stored locally.

## Code and verification

| Module | Responsibility |
| --- | --- |
| [public/app.mjs](public/app.mjs) | Speech, camera, pointer/strokes, direction queue, and composite recording. |
| [src/capture.mjs](src/capture.mjs) | Speech-start anchors, recent frames, strokes, and explicit timecodes. |
| [src/anthropic-planner.mjs](src/anthropic-planner.mjs) · [src/planner.mjs](src/planner.mjs) | Claude and Codex interpretation adapters. |
| [src/director.mjs](src/director.mjs) | Shot state, bounded reducer, follow-ups, and time/coordinate mapping. |
| [src/captions.mjs](src/captions.mjs) | Source-to-output caption segmentation and escaped graphic content. |
| [src/shoty.mjs](src/shoty.mjs) | Native timeline construction, export, and sequence restoration. |
| [src/server.mjs](src/server.mjs) | Local API, serialization, persistence, and recording storage. |

```sh
npm test
```

The suite covers source timing, coordinate mapping, edit validation, captions, cue capture, API serialization, rollback, undo, and interface contracts. Browser checks exercise speech and camera input with simulated devices and real MediaRecorder capture.
