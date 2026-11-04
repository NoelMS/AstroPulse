# AstroPulse interface specification

The single source of truth for how AstroPulse looks and behaves, including `archive/`. When code and this file disagree, change the code. If a change needs something not covered here, extend this file first, as narrowly as possible.

## Lineage

The visual system is adopted from the owner's Proof-Carrying Data Analyst frontend (`frontend/styles/*.css` in that repository): its tokens, type, header-and-sidebar shell, editorial rules, verdict language, timeline steps, technical surfaces and motion layer. AstroPulse adapts those patterns to a 3D observing workstation; it does not invent a parallel language. One deliberate deviation: the light theme's muted text is #66655f instead of the reference's #74736e, which measured 4.32:1 on the page and 3.73:1 on the sidebar and so failed the 4.5:1 rule below.

## Design direction

AstroPulse is an observing workstation for a high-energy astrophysics group: people who reduce archival ESO and ESA data, fit X-ray and optical spectra, and run timing analysis on neutron stars and black holes. The sky, the spectrum and the figures are the content; the chrome around them should recede until it is needed.

- Personality: a quiet instrument console. Dense where the numbers are, silent everywhere else.
- Colour: a cool blue-black taken from the night-sky surface (`--color-sky`), so the window reads as an extension of the viewport. One green accent, reserved for verified results. No warm neutrals, which belong to the owner's other projects.
- Type: IBM Plex Sans in sentence case for every label, tab and button, the way a lab notebook is written. Plex Mono only for values, units and class codes. Uppercase is kept for one thing, the fit verdict.
- Layout: one 48px header bar, a narrow source list grouped by compact-object class, the stage, and an inspector whose secondary scene options are folded away by default.
- Motion: functional only, as described under Motion.
- Not for this project: tracked uppercase eyebrows and nav, a two-tone split header, stacked header toolbars, warm near-black palettes, cards and glows.

## Principles

1. Editorial, not dashboard. Structure comes from type and 1px rules. A section starts with a rule in the text colour; rows are separated by border-colour hairlines. No cards, glows or gradients.
2. One accent, reserved for verification and positive state. Green means "this fit is acceptable" or "this step finished". It is never decoration.
3. The sky is the only image surface. Everything else is the warm neutral theme, dark by default.
4. The selected source is global context. It stays selected in the sidebar across every view.
5. Numbers are the content. Tabular figures everywhere; key results are set large.
6. Motion explains a change: masked reveals when a view opens, timeline bars that fill as work runs, a one-time intro. Everything is complete without it, and reduced motion removes it.

## Tokens

Defined on `:root` in `astropulse.css` and `archive/console.css`. Dark is the default; `:root[data-theme="light"]` switches palettes. The choice is stored in `localStorage` under `astropulse-theme` and applied before first paint. The archive frame reads the same key and follows changes through the `storage` event.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg` | #0f1215 | #f3f5f6 | Page and stage background |
| `--color-text` | #e6e9ec | #101418 | Primary text, section rules, axes |
| `--color-secondary` | #aab1b8 | #555d65 | Secondary text, model components |
| `--color-muted` | #8a929a | #5c646c | Labels, captions, eyebrows |
| `--color-surface` | #181c20 | #e5e9ec | Hover and selected rows |
| `--color-elevated` | #1d2226 | #fafbfc | Dialogs, raised controls |
| `--color-sidebar` | #0f1215 | #f3f5f6 | Source list (equal to the page; separated by a hairline only) |
| `--color-border` | #252b31 | #d3d9dd | Hairlines |
| `--color-border-strong` | #3c444c | #aeb6bc | Control borders |
| `--color-focus` | #d6dce2 | #101418 | Focus ring |
| `--color-field` | #13171a | #fbfcfc | Inputs, segmented control trough |
| `--color-accent` | #7cc49a | #2e7a4f | Verified, finished, ready |
| `--color-fail` | #e48c6e | #9a3b1b | Failed, stopped, poor fit |
| `--color-caution` | #d6b45c | #7c5d0b | Thresholds and warnings |
| `--color-primary` / `--color-on-primary` | #e6e9ec / #0f1215 | #101418 / #f3f5f6 | Primary buttons, active segment |
| `--color-tech` family | #080a0c, #0d1013, #e3e7ea, #8a939b, #20262b | #12161a, #1a1f24, same text | XSPEC terminal |
| `--color-sky` | #04060b | #04060b | 3D viewport and media viewers, both themes |

Type: IBM Plex Sans 400, 500, 600 for the interface; IBM Plex Mono 400, 500 for code, units and indices. Labels are sentence case; only `.verdict` is uppercase. Scale tokens: eyebrow 11px, meta 12.5px, body 15px, lead 17px, section clamp(20px, 2vw, 26px), title clamp(30px, 3.6vw, 46px), result clamp(40px, 5vw, 64px). Spacing tokens `--space-1` to `--space-9` (4 to 96px). Radii 3px and 6px. Durations 180, 420 and 700ms; easing `cubic-bezier(0.16, 1, 0.3, 1)`.

Charts drawn by `astropulse.js` and `console.js` use these tokens through `var()` in SVG attributes. Data series are monochrome: observed points in `--color-secondary`, the fitted model in `--color-text`, components dashed in `--color-secondary` and `--color-muted`, thresholds in `--color-caution`. The 3D scene and canvases keep their physical colours.

## Layout

```
+--------------+-------------------------------------------------+--------------------+
| AstroPulse   | Sandbox  Spectral fit  Reduction  Timing  Archive |  o Scene ready  Light theme |
+--------------+-----------------------------------------+--------------------+
| Black holes 4| [System|ISCO|...] [Relativistic|...]  Freeze  Reset view  Sound | Cygnus X-1 |
| Cygnus X-1 HMXB                                        |  facts             |
| ...          |              sky / scene                |  observation       |
| Neutron stars 6                                        |  [Fit this spectrum] |
| Crab Pulsar PSR                                        |  Scene options  +  |
+--------------+-----------------------------------------+--------------------+
```

- Header height 48px, one colour, one hairline below. Its first column matches the 208px source list so the tabs start on the stage edge. It holds only the wordmark, the views, the scene status and the theme toggle.
- Scene controls (Freeze, Reset view, Sound) live in the stage toolbar beside the camera and model controls they act on. The image and video dialog opens from the inspector thumbnail and its Image and Video links.
- The source list groups sources under "Black holes" and "Neutron stars" with counts. Each row is the name plus a mono class code (HMXB, LMXB, MQ, XRT, PSR, XRP, UCXB); the full class is in the row title and the inspector.
- The inspector is 320px. Simulation options sit in a `details` element, "Scene options", closed by default.
- Workstation views replace the stage and inspector: eyebrow, title, lead, then sections, each opened by a rule in the text colour.
- Below 1100px the source list narrows to 184px, the inspector to 280px, and the toolbar labels become visually hidden (they stay as accessible names). Below 860px everything stacks and the source list becomes a horizontal strip.

## Components

| Component | Class | Rule |
|---|---|---|
| Wordmark | `.wordmark` | 26px CSS mark (`.mark`, a conic ring that turns while the simulation runs and glows on live checks), "Astro" in the text colour and "Pulse" in the brand orange (#f0a35c dark, #b4561a light; used nowhere else), 16px 600, with a 10.5px muted tagline |
| Panel rail | `.panel-bar`, `.panel-toggle` | Each side panel opens with a muted eyebrow title and a chevron button; collapsed, the panel becomes a 36px rail with the chevron and a vertical title |
| Sky map | `.sky-map` | Hammer projection in galactic coordinates, Galactic Centre in the middle, longitude increasing to the left; hairline outline, dashed plane, selected source ringed |
| Scene option | `.opt` | Label and value on one line, control full width below |
| Nav | `.nav-btn` | Sentence case 14px, muted; the current view is text colour with a 2px bar on the header hairline |
| Status | `.status` | 7px dot plus a 12.5px label. `data-state` is `ready` (accent dot), `busy` (pulsing text dot) or `error` (fail) |
| Theme toggle | `#btn-theme` | Text button that names the theme it switches to |
| Eyebrow | `.eyebrow` | 11px sentence case, 500, muted |
| Section head | `.section__head` | Title and meta above a 1px rule in the text colour |
| Source group | `.source-group` | Class name and count, 11px muted |
| Source card | `.target-pill` | Glyph (black hole: dark disc with an orange ring; neutron star: blue dot with a field line; pulsar: blue dot with a beam), name, class and distance, then a 40px sparkline and the 7-day flux on the right |
| Old sidebar row | `.target-pill` | Name and mono class code on one line; hover uses `--color-surface`, the current row adds a 2px inset bar in the text colour |
| Scene options | `.sandbox-controls-drawer` | `details` with a `+` / `-` marker, closed by default |
| Segmented control | `.segmented` | Trough in `--color-field`; the active option is filled `--color-primary` |
| Buttons | `.btn--primary`, `.btn--secondary`, `.btn--text` | Sentence case 13px, 500, 40px tall. Primary is inverted text colour. A trailing arrow slides 6px on hover |
| Facts | `.facts` | Two columns; dt 12.5px muted |
| Compare grid | `.compare` | Cells divided by hairlines, values in mono |
| Verdict | `.verdict` | Uppercase 13px tracking 0.16em; `--verified` uses the accent and `--failed` uses fail |
| Timeline | `.reflex-node` | Workflow steps as columns with a 2px top bar. `data-state`: `wait` (border), `active` (filling text-colour bar), `done` (full bar) |
| Technical surface | `.tech` | XSPEC: tech background, mono 12.5px, uppercase head |
| Figure | `figure.figure-panel` | Chart, then a meta caption that begins with "Figure N." Figures are numbered in reading order across the views: 1 to 3 Spectral fit, 4 Reduction, 5 to 9 Timing. Captions say when data are synthetic |
| Chart | `svgChart()` in `astropulse.js` | Ticks on both axes, hairline grid in `--color-border`, axes in `--color-text`, log axes label decades. Reference lines dashed in `--color-caution`, markers as open circles in `--color-text` |
| Result cell | `.compare` inside `.timing-results` | Quantity, mono value, a `.marker` reading Recovered (`--pass`), Not recovered (`--fail`) or No injection (`--neutral`), then the meta note with the injected value and the pass rule |
| Trailed spectrogram | `.trailed` | Canvas in a hairline frame, ink ramp from `--color-bg` to `--color-text`, a dashed `--color-caution` line at the selected phase, velocity axis below |
| Stage caption | `.stage-caption` | Meta text on the sky, bottom left, in the tech text colours with a soft shadow. Names the model in bold, then says what it shows and what the camera mode does |
| Live line | `.live-line` | Inspector line with an eyebrow and the 7-day live flux; hidden without the server |
| Live table | `.live-table` | Hairline rows, mono right-aligned numbers, sans headers. Sparklines in `--color-secondary` break at gaps over 20 days. Trend markers: Brightening in `--color-caution`, Steady and Fading neutral |
| Report list | `.live-alerts` | Date in mono meta, title as a link, matched sources as caution markers |
| Scene note | `.scene-note` | Meta line in the inspector that says what the 3D model computes and what is not to scale |
| Dialog | `.media-modal-window` | Elevated panel, 6px radius, one large shadow, blurred backdrop |
| Intro | `#intro` | Shown from first paint via `html.intro-pending`; name, then line, then the app. Once per session, never under reduced motion |
| Live focus | `.live-focus` | Source, large flux, light curve to now, replay; side column with Paranal altitude, a 24-hour altitude chart with night shading, and the simulation link. Clocks tick each second; nothing flashes |

## 3D scene

The sky and the scene keep physical colours; none of the theme tokens apply inside the viewport. The canvas is opaque on `--color-sky`.

- Stars are soft round sprites coloured by blackbody temperature, never square points.
- Black holes are ray-traced in a fragment shader on a bounding sphere; the disk shader is shared with the flat neutron-star disk. Disk colour is a temperature ramp, not true colour, and the scene note says so.
- Companions use the star shader (limb darkening, granulation, irradiation). Gas is particles, not tubes. Glows are additive sprites.
- Camera presets: System frames the whole binary, ISCO sits just above the disk plane near the inner edge, Galaxy looks down on the solar neighbourhood, Free starts from an oblique angle and leaves the camera to the user.
- Animation time stops when the scene is frozen and starts frozen under reduced motion. Nothing renders while another view is open.

## States

Hover raises a row to `--color-surface` or a button to `--color-elevated`. The current or selected item uses `--color-surface` plus `aria-current`, or the inverted segment. Focus is a 2px `--color-focus` outline with 3px offset, keyboard only. Disabled is opacity 0.45. Busy shows a pulsing dot or an active timeline bar. Results use the verdict colours.

## Motion

- View change: the new view fades and rises 6px over 220ms; heavy rendering waits for the next frame. No View Transitions API, which snapshots the WebGL canvas.
- Figures and sections fade and rise 10px, staggered 40ms up to six items, the first time a view opens. No clip-path animation.
- Timeline bars fill with the slow duration. The status dot pulses only while busy.
- `prefers-reduced-motion: reduce`: no intro, no reveals, transitions at 1ms.

## Accessibility and input

Native controls throughout. Non-native clickables carry `role="button"` and `tabindex="0"` and respond to Enter and Space. Keys 1 to 6 switch views, [ and ] collapse the side panels, and Escape closes the media dialog. Text contrast is at least 4.5:1 in both themes. Scrollbars stay hidden by the owner's earlier decision; the reference's pill scrollbars are the documented alternative if that decision changes.

## Project constraints

No source comments, no emojis, ASCII only. External code: Three.js r128 with OrbitControls, anime.js 3.2.2, Google Fonts.
