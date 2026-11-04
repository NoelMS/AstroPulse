(function(){

var DATA = window.ASTROPULSE_DATA;
if(!DATA) return;

var state = {
  targetId: 'cyg',
  target: DATA.targets[0],
  view: 'sandbox-view',
  camMode: 'system',
  audioEnabled: true,
  sim: {
    jets: true,
    doppler: true,
    stream: true,
    followLive: true,
    magfield: true,
    speed: 10,
    resolution: 2048,
    paused: false
  },
  params: {
    tin: 0.45,
    mdot: 0.012,
    gamma: 1.74,
    fe: 6.41,
    bfield: 32
  },
  pipeTab: 'subtab-reflex',
  panels: (function(){ try{ return JSON.parse(localStorage.getItem('astropulse-panels')) || {}; }catch(e){ return {}; } })(),
  realization: 0,
  timingSource: 'synthetic',
  fitErrors: null,
  fitLog: null,
  optical: { inc: 60, phase: 0.25 },
  xspecHistory: [],
  modelMode: 'theory',
  fluxColormap: 'heat',
  fluxGain: 12.0,
  obsBand: 'composite',
  obsStretch: 'linear',
  obsLut: 'chandra',
  obsSplit: false,
  obsSplitX: 0.5,
  obsContours: false,
  obsProfileOpen: false,
  obsZoom: 1.0,
  obsPan: { x: 0, y: 0 },
  obsProbe: { active: false, x: 0, y: 0 }
};

var audioCtx = null;
function getAudioContext(){
  if(!audioCtx){
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if(AudioContext) audioCtx = new AudioContext();
  }
  if(audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, type, duration, gainVal){
  if(!state.audioEnabled) return;
  try{
    var ctx = getAudioContext();
    if(!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal || 0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }catch(e){}
}

function playClickSound(){
  playTone(850, 'sine', 0.04, 0.05);
}

function playSuccessSound(){
  if(!state.audioEnabled) return;
  try{
    var ctx = getAudioContext();
    if(!ctx) return;
    var now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach(function(freq, idx){
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.06, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.2);
    });
  }catch(e){}
}

function playPipelineChime(stageIdx){
  var freqs = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  var f = freqs[stageIdx % freqs.length] || 523.25;
  playTone(f, 'triangle', 0.16, 0.07);
}

var scene, camera, renderer, controls;
var animFrameId = null;
var galacticGroup, systemGroup, skyGroup;
var targetMarkers = [];
var realSurfaceGroup = null;
var sys = null;
var galaxyRefs = null;
var simTime = 0;
var uTimeShared = { value: 0 };
var uPixelShared = { value: 1 };
var glowTexture = null;
var KPC = 5.0;
var R_SUN_KPC = 8.2;
var QUALITY = {
  1024: { pixel: 0.75, maxPixel: 1.5, steps: 160, stepScale: 1.7, oct: 3 },
  2048: { pixel: 1.5, maxPixel: 2.5, steps: 420, stepScale: 1.0, oct: 5 }
};
var uOctShared = { value: 5 };
var fpsMeter = { frames: 0, since: 0 };
var perf = { samples: [], shown: null, renderer: '', software: false, lastScroll: 0, dirty: true, lastKey: '' };

function markDirty(){ perf.dirty = true; }

function inAppWindow(){ return /[?&]app=1/.test(location.search); }

function perfDismissed(kind){
  try{ return localStorage.getItem('astropulse-perf-' + kind) === '1'; }catch(e){ return false; }
}

function hidePerfNotice(remember){
  var box = document.getElementById('perf-notice');
  if(box) box.hidden = true;
  if(remember && perf.shown){ try{ localStorage.setItem('astropulse-perf-' + perf.shown, '1'); }catch(e){} }
  perf.shown = null;
  perf.samples = [];
}

function showPerfNotice(kind, title, text, actions){
  var box = document.getElementById('perf-notice');
  if(!box || perf.shown) return;
  perf.shown = kind;
  document.getElementById('perf-title').textContent = title;
  document.getElementById('perf-text').textContent = text;
  var row = document.getElementById('perf-actions');
  row.innerHTML = '';
  actions.forEach(function(a){
    var b = document.createElement('button');
    b.className = a.primary ? 'btn--primary btn--small' : 'btn--text';
    b.textContent = a.label;
    b.addEventListener('click', a.run);
    row.appendChild(b);
  });
  box.hidden = false;
}

function openAppWindow(){
  var text = document.getElementById('perf-text');
  if(text) text.textContent = 'Opening the app window\u2026';
  return fetch('api/app-window', { method: 'POST', headers: { 'X-AstroPulse': '1' } }).then(function(r){
    return r.json().then(function(d){ if(!r.ok) throw new Error(d.error || 'HTTP ' + r.status); return d; });
  }).then(function(){
    if(text) text.textContent = 'AstroPulse opened in its own window. You can close this tab.';
    document.getElementById('perf-actions').innerHTML = '';
    state.sim.paused = true;
  }, function(e){
    if(text) text.textContent = /Failed to fetch|JSON/i.test(e.message) ? 'The app window needs the AstroPulse server: open AstroPulse from its desktop shortcut.' : e.message;
  });
}

function setQuality(res){
  var b = document.querySelector('.res-pill[data-res="' + res + '"]');
  if(b) b.click();
}

function checkPerf(fps){
  if(state.view !== 'sandbox-view' || state.modelMode !== 'theory' || document.hidden || state.sim.paused){ perf.samples = []; return; }
  perf.samples.push(fps);
  if(perf.samples.length > 6) perf.samples.shift();
  if(perf.samples.length < 6 || perf.shown) return;
  var med = perf.samples.slice().sort(function(a, b){ return a - b; })[3];
  var high = String(state.sim.resolution) === '2048';
  var appAction = { label: 'Open the app window', primary: true, run: openAppWindow };
  if(perf.software && !perfDismissed('software')){
    var acts = [];
    if(!inAppWindow()) acts.push(appAction);
    if(high) acts.push({ label: 'Switch to Standard', primary: inAppWindow(), run: function(){ setQuality(1024); hidePerfNotice(false); } });
    acts.push({ label: 'Dismiss', run: function(){ hidePerfNotice(true); } });
    var rname = /swiftshader/i.test(perf.renderer) ? 'SwiftShader' : (/basic render/i.test(perf.renderer) ? 'Microsoft Basic Render Driver' : (/llvmpipe/i.test(perf.renderer) ? 'llvmpipe' : 'a software renderer'));
    showPerfNotice('software', '3D is running without your graphics card', 'The browser is drawing with ' + rname + ' instead of the GPU, at about ' + med + ' fps. Turn on hardware acceleration in its settings' + (inAppWindow() ? '' : ', or open the app window, which asks for the graphics card') + '.', acts);
  }else if(high && med < 24 && !perfDismissed('quality')){
    showPerfNotice('quality', 'Running at ' + med + ' fps', 'Standard quality renders a quarter of the pixels with fewer ray steps, which usually doubles the frame rate.', [
      { label: 'Switch to Standard', primary: true, run: function(){ setQuality(1024); hidePerfNotice(false); } },
      { label: 'Keep High', run: function(){ hidePerfNotice(true); } }
    ]);
  }else if(!high && med < 20 && !inAppWindow() && !perfDismissed('app')){
    showPerfNotice('app', 'Still ' + med + ' fps on Standard', 'The app window runs AstroPulse on its own, away from other browser tabs, and asks for the high-performance graphics card.', [
      appAction,
      { label: 'Not now', run: function(){ hidePerfNotice(true); } }
    ]);
  }
}

var GLSL_NOISE = [
  'float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
  'float vnoise(vec3 x){',
  '  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
  '             mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
  '}',
  'float fbm(vec3 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }',
  'vec3 toneMap(vec3 c){ return vec3(1.0) - exp(-max(c, vec3(0.0))); }',
  ''
].join('\n');

var GLSL_DISK = [
  'uniform float uTime; uniform float uRin; uniform float uRout; uniform float uOmega0; uniform float uTempScale;',
  'uniform float uBright; uniform float uDoppler; uniform vec3 uHot; uniform float uHotOn; uniform float uHotK; uniform float uOct;',
  'float fbmD(vec3 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 6; i++){ if(float(i) >= uOct) break; v += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }',
  'vec3 heatRamp(float t){',
  '  t = clamp(t, 0.0, 1.7);',
  '  vec3 c = mix(vec3(0.30, 0.04, 0.02), vec3(1.0, 0.32, 0.07), smoothstep(0.0, 0.45, t));',
  '  c = mix(c, vec3(1.0, 0.74, 0.40), smoothstep(0.35, 0.8, t));',
  '  c = mix(c, vec3(1.0, 0.96, 0.90), smoothstep(0.7, 1.05, t));',
  '  return mix(c, vec3(0.72, 0.84, 1.0), smoothstep(1.05, 1.6, t));',
  '}',
  'vec4 diskSample(vec3 p, vec3 toObs){',
  '  float r = length(p.xz);',
  '  if(r < uRin || r > uRout) return vec4(0.0);',
  '  float x = uRin / r;',
  '  float prof = pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;',
  '  float phi = atan(p.z, p.x);',
  '  float om = uOmega0 * pow(r, -1.5);',
  '  float t1 = mod(uTime, 8.0); float t2 = mod(uTime + 4.0, 8.0);',
  '  float w1 = sin(3.14159 * t1 / 8.0); float w2 = sin(3.14159 * t2 / 8.0);',
  '  float lr = log(r) * 9.0;',
  '  float a1 = phi + om * t1; float a2 = phi + om * t2;',
  '  float n1 = fbmD(vec3(cos(a1) * 3.2, sin(a1) * 3.2, lr));',
  '  float n2 = fbmD(vec3(cos(a2) * 3.2 + 7.1, sin(a2) * 3.2 - 2.3, lr));',
  '  float n = (n1 * w1 + n2 * w2) / max(w1 + w2, 0.001);',
  '  float streaks = 0.35 + 1.4 * n * n;',
  '  float beta = clamp(sqrt(0.5 / max(r - 1.0, 0.05)), 0.0, 0.9);',
  '  vec3 vhat = normalize(vec3(p.z, 0.0, -p.x));',
  '  float gd = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(vhat, toObs));',
  '  float g = mix(1.0, gd, uDoppler) * sqrt(max(1.0 - 1.0 / r, 0.02));',
  '  float temp = prof * g * uTempScale;',
  '  vec3 col = heatRamp(temp) * prof * streaks * pow(g, 3.0) * uBright;',
  '  float hd = length(p - uHot);',
  '  col += vec3(1.0, 0.86, 0.7) * exp(-hd * hd * uHotK) * 1.4 * uHotOn;',
  '  float edge = smoothstep(uRin, uRin * 1.06, r) * (1.0 - smoothstep(uRout * 0.7, uRout, r));',
  '  float alpha = clamp(edge * (0.25 + 0.95 * streaks * (0.4 + 0.6 * prof)), 0.0, 0.97);',
  '  return vec4(col * edge, alpha);',
  '}',
  ''
].join('\n');

var WORLD_VERT = [
  'varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vObj; varying vec3 vObjN;',
  'void main(){',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  vWorld = w.xyz; vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz); vObj = position; vObjN = normal;',
  '  gl_Position = projectionMatrix * viewMatrix * w;',
  '}'
].join('\n');

var BH_FRAG = [
  'uniform float uRs; uniform float uSphere; uniform int uSteps; uniform float uStepScale;',
  'varying vec3 vWorld;',
  'void main(){',
  '  vec3 ro = cameraPosition / uRs;',
  '  vec3 rd = normalize(vWorld / uRs - ro);',
  '  float b = dot(ro, rd); float c = dot(ro, ro) - uSphere * uSphere;',
  '  vec3 p = ro;',
  '  if(c > 0.0){',
  '    float disc = b * b - c;',
  '    if(disc < 0.0) discard;',
  '    float t0 = -b - sqrt(disc);',
  '    if(t0 < 0.0) discard;',
  '    p = ro + rd * t0;',
  '  }',
  '  vec3 v = rd;',
  '  vec3 hv = cross(p, v); float h2 = dot(hv, hv);',
  '  vec3 acc = vec3(0.0); float alpha = 0.0; bool escaped = false;',
  '  for(int i = 0; i < 480; i++){',
  '    if(i >= uSteps) break;',
  '    float r = length(p);',
  '    if(r < 1.0) break;',
  '    if(r > uSphere + 0.01 && dot(p, v) > 0.0){ escaped = true; break; }',
  '    float hs = clamp(0.07 * r, 0.012, 0.6) * uStepScale;',
  '    v += -1.5 * h2 * p / pow(r, 5.0) * hs * 0.5;',
  '    vec3 pn = p + v * hs;',
  '    v += -1.5 * h2 * pn / pow(length(pn), 5.0) * hs * 0.5;',
  '    if(p.y * pn.y < 0.0){',
  '      vec3 hit = mix(p, pn, p.y / (p.y - pn.y));',
  '      vec4 d = diskSample(hit, -normalize(v));',
  '      acc += (1.0 - alpha) * d.rgb * d.a;',
  '      alpha += (1.0 - alpha) * d.a;',
  '      if(alpha > 0.985){ escaped = true; break; }',
  '    }',
  '    p = pn;',
  '  }',
  '  if(!escaped) alpha = 1.0;',
  '  gl_FragColor = vec4(toneMap(acc * 1.5), alpha);',
  '}'
].join('\n');

var FLAT_DISK_FRAG = [
  'uniform float uRs;',
  'varying vec3 vWorld;',
  'void main(){',
  '  vec4 d = diskSample(vWorld / uRs, normalize(cameraPosition - vWorld));',
  '  gl_FragColor = vec4(toneMap(d.rgb * d.a * 1.5), d.a);',
  '}'
].join('\n');

var STAR_FRAG = [
  'uniform vec3 uColor; uniform float uTime; uniform float uR; uniform float uIrr; uniform float uCaps; uniform float uBand; uniform float uGran; uniform float uLum;',
  'varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vObj; varying vec3 vObjN;',
  'void main(){',
  '  vec3 N = normalize(vNormalW); vec3 V = normalize(cameraPosition - vWorld);',
  '  float mu = clamp(dot(N, V), 0.0, 1.0);',
  '  float limb = 0.18 + 0.82 * pow(mu, 0.6);',
  '  vec3 q = vObj / uR;',
  '  float gran = fbm(q * 18.0 + vec3(0.0, uTime * 0.06, 0.0));',
  '  float cells = fbm(q * 5.0 - vec3(uTime * 0.015));',
  '  vec3 base = uColor * mix(1.0, (0.78 + 0.42 * gran) * (0.9 + 0.2 * cells), uGran);',
  '  float irr = pow(max(dot(N, normalize(-vWorld)), 0.0), 1.5);',
  '  base = mix(base, vec3(0.95, 0.97, 1.0) * 1.3, irr * uIrr);',
  '  base *= 1.0 - 0.22 * smoothstep(0.7, 1.35, -q.x) * uIrr;',
  '  float caps = pow(abs(normalize(vObjN).y), 18.0) * uCaps;',
  '  float band = exp(-pow(N.y * 7.0, 2.0)) * uBand;',
  '  vec3 col = base * limb * uLum + vec3(1.0, 0.94, 0.88) * caps * 2.6 + vec3(0.85, 0.92, 1.0) * band * 1.6;',
  '  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));',
  '  vec3 hue = col * ((1.0 - exp(-L)) / max(L, 1e-4));',
  '  vec3 hot = vec3(1.0) - exp(-col);',
  '  gl_FragColor = vec4(mix(hue, hot, 0.35 * smoothstep(0.6, 1.0, mu)), 1.0);',
  '}'
].join('\n');

var JET_VERT = [
  'uniform float uBase; uniform float uLen;',
  'varying vec3 vWorld; varying vec3 vNormalW; varying float vAxial; varying float vAng;',
  'void main(){',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  vWorld = w.xyz; vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);',
  '  vAxial = (position.y - uBase) / uLen; vAng = atan(position.z, position.x);',
  '  gl_Position = projectionMatrix * viewMatrix * w;',
  '}'
].join('\n');

var JET_FRAG = [
  'uniform float uTime; uniform vec3 uColor; uniform float uGain; uniform float uSharp; uniform float uFlow;',
  'varying vec3 vWorld; varying vec3 vNormalW; varying float vAxial; varying float vAng;',
  'void main(){',
  '  vec3 V = normalize(cameraPosition - vWorld);',
  '  float f = abs(dot(normalize(vNormalW), V));',
  '  float core = pow(f, uSharp);',
  '  float knots = 0.35 + 1.2 * fbm(vec3(vAxial * 9.0 - uTime * uFlow, cos(vAng) * 1.5, sin(vAng) * 1.5));',
  '  float fade = pow(1.0 - clamp(vAxial, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.05, vAxial);',
  '  gl_FragColor = vec4(uColor * core * knots * fade * uGain, 1.0);',
  '}'
].join('\n');

var STREAM_VERT = [
  'attribute float aU; attribute float aAng;',
  'varying vec3 vWorld; varying vec3 vNormalW; varying float vU; varying float vAng;',
  'void main(){',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  vWorld = w.xyz; vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz); vU = aU; vAng = aAng;',
  '  gl_Position = projectionMatrix * viewMatrix * w;',
  '}'
].join('\n');

var STREAM_FRAG = [
  'uniform float uTime; uniform vec3 uColA; uniform vec3 uColB; uniform float uGain; uniform float uOn; uniform float uRate;',
  'varying vec3 vWorld; varying vec3 vNormalW; varying float vU; varying float vAng;',
  'void main(){',
  '  vec3 V = normalize(cameraPosition - vWorld);',
  '  float f = abs(dot(normalize(vNormalW), V));',
  '  float core = pow(f, 1.2);',
  '  float flow = fbm(vec3(vU * 16.0 - uTime * uRate, cos(vAng) * 1.3, sin(vAng) * 1.3));',
  '  float clumps = 0.25 + 1.6 * flow * flow;',
  '  float fade = smoothstep(0.0, 0.04, vU) * (1.0 - smoothstep(0.88, 1.0, vU));',
  '  vec3 col = mix(uColA, uColB, smoothstep(0.35, 1.0, vU)) * (0.7 + 0.8 * smoothstep(0.75, 1.0, vU));',
  '  gl_FragColor = vec4(col * core * clumps * fade * uGain * uOn, 1.0);',
  '}'
].join('\n');

var POINT_FRAG = [
  'varying vec3 vColor; varying float vAlpha;',
  'void main(){',
  '  vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0;',
  '  if(d > 1.0) discard;',
  '  float a = (exp(-d * 5.0) + 0.5 * exp(-d * 24.0)) * vAlpha;',
  '  gl_FragColor = vec4(vColor * a, a);',
  '}'
].join('\n');

var POINT_VERT = [
  'attribute float aSize; attribute vec3 aColor;',
  'uniform float uPixel; uniform float uScale; uniform float uAtten; uniform float uOpacity; uniform float uMax;',
  'varying vec3 vColor; varying float vAlpha;',
  'void main(){',
  '  vColor = aColor;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vAlpha = uOpacity * mix(1.0, smoothstep(0.8, 7.0, -mv.z), uAtten);',
  '  gl_PointSize = clamp(aSize * uPixel * mix(1.0, uScale / max(-mv.z, 0.001), uAtten), 1.0, uMax * uPixel);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

var FLOW_VERT = [
  'attribute float aSeed; attribute vec3 aJit; attribute float aKind; attribute float aSize;',
  'uniform float uTime; uniform float uRate; uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uP2; uniform vec3 uP3;',
  'uniform vec3 uDonor; uniform float uR; uniform vec3 uColor; uniform float uFocus; uniform float uStreamOn; uniform float uWindOn;',
  'uniform float uPixel; uniform float uScale;',
  'varying vec3 vColor; varying float vAlpha;',
  'void main(){',
  '  float p = fract(aSeed + uTime * uRate * (0.75 + 0.5 * fract(aSeed * 13.7)));',
  '  vec3 pos;',
  '  if(aKind < 0.5){',
  '    float q = 1.0 - p;',
  '    vec3 b = q * q * q * uP0 + 3.0 * q * q * p * uP1 + 3.0 * q * p * p * uP2 + p * p * p * uP3;',
  '    float width = 0.1 + 0.45 * p + 1.1 * smoothstep(0.82, 1.0, p);',
  '    pos = b + aJit * width;',
  '    vAlpha = smoothstep(0.0, 0.06, p) * (1.0 - smoothstep(0.9, 1.0, p)) * 0.35 * uStreamOn;',
  '    vColor = mix(uColor, vec3(1.0, 0.85, 0.7), smoothstep(0.55, 1.0, p));',
  '  } else {',
  '    vec3 dir = normalize(aJit);',
  '    dir = normalize(mix(dir, vec3(-1.0, 0.0, 0.0), uFocus * smoothstep(-0.2, 1.0, -dir.x)));',
  '    pos = uDonor + dir * uR * (1.05 + p * 2.6);',
  '    vAlpha = (1.0 - p) * (1.0 - p) * 0.16 * uWindOn;',
  '    vColor = uColor * 0.9;',
  '  }',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  gl_PointSize = clamp(aSize * uPixel * uScale / max(-mv.z, 0.001), 1.0, 14.0 * uPixel);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

var COLUMN_VERT = [
  'attribute float aSeed; attribute float aL; attribute float aPhi; attribute float aHemi; attribute float aSize;',
  'uniform float uTime; uniform float uRns; uniform float uOn; uniform float uPixel; uniform float uScale;',
  'varying vec3 vColor; varying float vAlpha;',
  'void main(){',
  '  float p = fract(aSeed + uTime * 0.35 * (0.7 + 0.6 * fract(aSeed * 31.0)));',
  '  float ths = asin(sqrt(clamp(uRns / aL, 0.0, 1.0)));',
  '  float th = mix(1.5708, ths, pow(p, 0.8));',
  '  float r = aL * sin(th) * sin(th);',
  '  vec3 pos = vec3(r * sin(th) * cos(aPhi), aHemi * r * cos(th), r * sin(th) * sin(aPhi));',
  '  vColor = mix(vec3(1.0, 0.55, 0.25), vec3(0.85, 0.92, 1.0), smoothstep(0.4, 1.0, p));',
  '  vAlpha = smoothstep(0.0, 0.1, p) * 0.9 * uOn;',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  gl_PointSize = clamp(aSize * uPixel * uScale / max(-mv.z, 0.001), 1.0, 7.0 * uPixel);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

function gaussRand(){
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
}

function kelvinToColor(k){
  var t = k / 100, r, g, b;
  if(t <= 66){
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }else{
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  function c(v){ return Math.max(0, Math.min(255, v)) / 255; }
  return new THREE.Color(c(r), c(g), c(b));
}

function kerrIscoRg(a){
  a = Math.max(0, Math.min(0.999, a || 0));
  var z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  var z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

function companionProfile(t){
  var name = t.companion_name || '';
  var type = t.companion_type || '';
  if(/isolated|^none/i.test(name) || /remnant/i.test(type)) return null;
  var teff = 4400;
  var radius = 3.0;
  if(/white dwarf/i.test(type)){
    teff = 14000; radius = 1.1;
  }else if(/K-M/.test(type)){
    teff = 3900;
  }else if(/A\/F/.test(type)){
    teff = 7500;
  }else{
    var m = /([OBAFGKM])(\d(?:\.\d)?)?/.exec(type);
    if(m){
      var base = { O: 48000, B: 30000, A: 9700, F: 7200, G: 5900, K: 5200, M: 3850 };
      var step = { O: -1700, B: -2000, A: -250, F: -120, G: -80, K: -140, M: -90 };
      teff = base[m[1]] + step[m[1]] * (m[2] ? parseFloat(m[2]) : 0);
    }
  }
  if(!/white dwarf/i.test(type)){
    if(/supergiant|Ia|Ib/.test(type)) radius = 5.4;
    else if(/subgiant|IV/i.test(type)) radius = 3.2;
    else if(/giant|II/i.test(type)) radius = 4.5;
    else if(/dwarf/i.test(type)) radius = 2.4;
  }
  return {
    teff: teff,
    radius: radius,
    wind: /wind/i.test(t.accretion_mode || ''),
    rlof: /roche/i.test(t.accretion_mode || '')
  };
}

function getGlowTexture(){
  if(glowTexture) return glowTexture;
  var c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  var ctx = c.getContext('2d');
  var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function glowSprite(color, size, opacity){
  var mat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: color, transparent: true, opacity: opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  var s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

function makeLabel(text, color){
  var fs = 40;
  var font = '500 ' + fs + 'px "IBM Plex Sans", system-ui, sans-serif';
  var c = document.createElement('canvas');
  var ctx = c.getContext('2d');
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 16;
  c.height = fs + 16;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 8, c.height / 2);
  var tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false });
  var s = new THREE.Sprite(mat);
  var h = 0.027;
  s.scale.set(h * c.width / c.height, h, 1);
  s.center.set(-0.12, 0.5);
  s.renderOrder = 10;
  return s;
}

function softPointMaterial(opts){
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixel: uPixelShared,
      uScale: { value: opts.scale || 1 },
      uAtten: { value: opts.atten ? 1 : 0 },
      uOpacity: { value: opts.opacity === undefined ? 1 : opts.opacity },
      uMax: { value: opts.max || 12 }
    },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: opts.blending === undefined ? THREE.AdditiveBlending : opts.blending
  });
}

function makeSoftPoints(pos, col, size, opts){
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  return new THREE.Points(geo, softPointMaterial(opts));
}

function disposeGroup(group){
  group.traverse(function(o){
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      if(o.material.map && o.material.map !== glowTexture) o.material.map.dispose();
      o.material.dispose();
    }
  });
  while(group.children.length > 0) group.remove(group.children[0]);
}

function watchScrolling(){
  function mark(){ perf.lastScroll = performance.now(); }
  document.addEventListener('scroll', mark, { capture: true, passive: true });
  document.addEventListener('wheel', function(e){
    if(!(e.target.closest && e.target.closest('#three-canvas-wrapper'))) mark();
  }, { capture: true, passive: true });
}

function initThreeEngine(){
  watchScrolling();
  var container = document.getElementById('three-canvas-wrapper');
  if(!container) return;

  scene = new THREE.Scene();

  var width = container.clientWidth || window.innerWidth;
  var height = container.clientHeight || window.innerHeight;

  camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 2400);
  camera.position.set(0, 16, 52);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  try{
    var glc = renderer.getContext();
    var dbg = glc.getExtension('WEBGL_debug_renderer_info');
    perf.renderer = dbg ? String(glc.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    perf.software = /swiftshader|basic render|llvmpipe|software/i.test(perf.renderer);
  }catch(e){}
  renderer.setClearColor(0x04060b, 1);
  renderer.setSize(width, height);
  applyRenderQuality();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  if(typeof THREE.sRGBEncoding !== 'undefined'){
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  container.appendChild(renderer.domElement);

  if(typeof THREE.OrbitControls !== 'undefined'){
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 260;
    controls.minDistance = 1.5;
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(40, 60, 50);
  scene.add(key);

  skyGroup = new THREE.Group();
  galacticGroup = new THREE.Group();
  systemGroup = new THREE.Group();
  scene.add(skyGroup);
  scene.add(galacticGroup);
  scene.add(systemGroup);

  buildSky();
  buildGalacticScene();
  buildSystemScene(state.target);

  if(prefersCalm()){
    state.sim.paused = true;
    var btnFreeze = document.getElementById('btn-toggle-sim-freeze');
    var lblFreeze = document.getElementById('lbl-sim-freeze');
    if(btnFreeze) btnFreeze.classList.add('frozen');
    if(lblFreeze) lblFreeze.textContent = 'Resume';
  }

  setCameraMode('system');

  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(function(){ buildGalacticScene(); });
  }

  window.addEventListener('resize', onWindowResize);

  startRenderLoop();
}

function applyRenderQuality(){
  markDirty();
  var q = QUALITY[state.sim.resolution] || QUALITY[2048];
  var ratio = Math.min((window.devicePixelRatio || 1) * q.pixel, q.maxPixel);
  uOctShared.value = q.oct;
  if(renderer) renderer.setPixelRatio(ratio);
  uPixelShared.value = ratio;
  var container = document.getElementById('three-canvas-wrapper');
  if(renderer && container) renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
}

function buildSky(){
  var n = 6500;
  var pos = [], col = [], size = [];
  var band = new THREE.Vector3(0.25, 0.92, 0.3).normalize();
  var d = new THREE.Vector3();
  for(var i = 0; i < n; i++){
    d.set(gaussRand(), gaussRand(), gaussRand()).normalize();
    if(Math.random() < 0.45){
      d.addScaledVector(band, -d.dot(band) * 0.88).normalize();
    }
    var m = Math.pow(Math.random(), 7);
    var c = kelvinToColor(3300 + Math.pow(Math.random(), 1.6) * 11000);
    var bright = 0.28 + m * 0.95;
    pos.push(d.x * 900, d.y * 900, d.z * 900);
    col.push(c.r * bright, c.g * bright, c.b * bright);
    size.push(1.2 + m * 3.4);
  }
  var pts = makeSoftPoints(pos, col, size, { atten: false });
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  skyGroup.add(pts);
}

function targetWorldPosition(t){
  return new THREE.Vector3(KPC * (t.pos_3d.x - R_SUN_KPC), KPC * t.pos_3d.z, -KPC * t.pos_3d.y);
}

function buildGalacticScene(){
  markDirty();
  if(!galacticGroup) return;
  disposeGroup(galacticGroup);
  targetMarkers = [];

  var pos = [], col = [], size = [];
  var dust = { pos: [], col: [], size: [] };
  function add(x, y, z, c, bright, s){
    pos.push(x * KPC, y * KPC, z * KPC);
    col.push(c.r * bright, c.g * bright, c.b * bright);
    size.push(s);
  }
  function warm(){ return kelvinToColor(4100 + Math.random() * 1500); }
  var i;

  for(i = 0; i < 6000; i++){
    add(gaussRand() * 0.85, gaussRand() * 0.42, gaussRand() * 0.85, warm(), 0.45 + Math.random() * 0.5, 1.3 + Math.random() * 1.4);
  }

  var barAng = 27 * Math.PI / 180;
  var bx = -Math.cos(barAng), bz = -Math.sin(barAng);
  for(i = 0; i < 3500; i++){
    var u = (Math.random() * 2 - 1) * 4.4;
    var w = gaussRand() * 0.5 * (1 - Math.abs(u) / 5.2);
    add(u * bx - w * bz, gaussRand() * 0.22, u * bz + w * bx, warm(), 0.4 + Math.random() * 0.45, 1.2 + Math.random() * 1.2);
  }

  for(i = 0; i < 9000; i++){
    var rd = Math.min(16, 0.6 - 2.6 * Math.log(Math.random() + 1e-6));
    var td = Math.random() * Math.PI * 2;
    add(rd * Math.cos(td), gaussRand() * 0.14, -rd * Math.sin(td), kelvinToColor(4800 + Math.random() * 2800), 0.18 + Math.random() * 0.22, 1.1 + Math.random() * 0.8);
  }

  var k = Math.tan(12 * Math.PI / 180);
  var armRadiusAtSun = [9.9, 9.9 / 1.396, 9.9 / Math.pow(1.396, 2), 9.9 / Math.pow(1.396, 3)];
  var hii = new THREE.Color(1.0, 0.52, 0.62);
  armRadiusAtSun.forEach(function(rSun){
    for(var j = 0; j < 4200; j++){
      var r = 3.2 + 12.8 * Math.pow(Math.random(), 1.25);
      var th = Math.PI + Math.log(r / rSun) / k;
      var off = gaussRand() * 0.32;
      var rr = r + off;
      var x = rr * Math.cos(th), z = -rr * Math.sin(th), y = gaussRand() * 0.08;
      var roll = Math.random();
      if(roll < 0.06){
        add(x, y, z, hii, 0.7 + Math.random() * 0.4, 2.4 + Math.random() * 1.6);
      }else if(roll < 0.72){
        add(x, y, z, kelvinToColor(9000 + Math.random() * 16000), 0.45 + Math.pow(Math.random(), 3) * 0.8, 1.3 + Math.random() * 1.6);
      }else{
        add(x, y, z, kelvinToColor(5600 + Math.random() * 3000), 0.3 + Math.random() * 0.3, 1.2 + Math.random());
      }
      if(j % 3 === 0){
        var dr = r - 0.28 + gaussRand() * 0.12;
        dust.pos.push(dr * Math.cos(th) * KPC, gaussRand() * 0.05 * KPC, -dr * Math.sin(th) * KPC);
        dust.col.push(0.05, 0.035, 0.03);
        dust.size.push(3.2 + Math.random() * 2.4);
      }
    }
  });

  var sunTheta = Math.PI;
  for(i = 0; i < 1400; i++){
    var rl = 8.0 + (Math.random() - 0.5) * 1.8;
    var tl = sunTheta + Math.log(rl / 8.4) / Math.tan(11 * Math.PI / 180) + gaussRand() * 0.012;
    add((rl + gaussRand() * 0.18) * Math.cos(tl), gaussRand() * 0.07, -(rl + gaussRand() * 0.18) * Math.sin(tl), kelvinToColor(7000 + Math.random() * 12000), 0.35 + Math.random() * 0.5, 1.2 + Math.random() * 1.2);
  }

  var stars = makeSoftPoints(pos, col, size, { atten: true, scale: 170 });
  galacticGroup.add(stars);
  var dustPts = makeSoftPoints(dust.pos, dust.col, dust.size, { atten: true, scale: 170, opacity: 0.55, blending: THREE.NormalBlending });
  dustPts.renderOrder = 1;
  galacticGroup.add(dustPts);

  [4, R_SUN_KPC, 12, 16].forEach(function(rk){
    var pts = [];
    for(var a = 0; a <= 128; a++){
      var ang = a / 128 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(ang) * rk * KPC, -0.4, Math.sin(ang) * rk * KPC));
    }
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5b6670, transparent: true, opacity: rk === R_SUN_KPC ? 0.4 : 0.18, depthWrite: false }));
    galacticGroup.add(line);
  });

  var core = glowSprite(new THREE.Color(1.0, 0.86, 0.66), 26, 0.4);
  galacticGroup.add(core);
  var sgra = buildSgrA();
  galacticGroup.add(sgra.mesh);
  var sgraHit = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  sgraHit.userData = { sgra: true };
  galacticGroup.add(sgraHit);
  targetMarkers.push(sgraHit);
  var gcLabel = makeLabel('Sgr A*', 'rgba(230,233,236,0.9)');
  gcLabel.position.set(0, 9, 0);
  galacticGroup.add(gcLabel);

  var sunPos = new THREE.Vector3(-R_SUN_KPC * KPC, 0, 0);
  var sun = glowSprite(new THREE.Color(1.0, 0.9, 0.6), 4.5, 0.95);
  sun.position.copy(sunPos);
  galacticGroup.add(sun);
  var sunLabel = makeLabel('Sun', 'rgba(255,226,160,0.9)');
  sunLabel.position.copy(sunPos);
  galacticGroup.add(sunLabel);

  var labels = {};
  var dots = {};
  DATA.targets.forEach(function(t){
    var p = targetWorldPosition(t);
    var g = new THREE.Group();
    g.position.copy(p);
    var stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -p.y, 0)]),
      new THREE.LineBasicMaterial({ color: 0x8a929a, transparent: true, opacity: 0.35, depthWrite: false })
    );
    g.add(stem);
    var dot = glowSprite(new THREE.Color(0.85, 0.9, 0.95), 3.2, 0.9);
    g.add(dot);
    var hit = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData = { targetId: t.id };
    g.add(hit);
    var label = makeLabel(t.name, 'rgba(230,233,236,1)');
    g.add(label);
    galacticGroup.add(g);
    targetMarkers.push(hit);
    labels[t.id] = label;
    dots[t.id] = dot;
  });

  var ringPts = [];
  for(var a2 = 0; a2 <= 64; a2++){
    var ang2 = a2 / 64 * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(ang2) * 2.6, 0, Math.sin(ang2) * 2.6));
  }
  var reticle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0xe6e9ec, transparent: true, opacity: 0.9, depthWrite: false }));
  galacticGroup.add(reticle);

  galaxyRefs = {
    core: core,
    labels: labels,
    dots: dots,
    reticle: reticle,
    update: function(time){
      galacticGroup.rotation.y = -time * 0.004;
      var dc = camera.position.length();
      core.material.opacity = 0.4 * Math.max(0, Math.min(1, (dc - 10) / 40));
      var s = 1 + Math.sin(time * 2.4) * 0.08;
      reticle.scale.set(s, s, s);
    }
  };
  updateGalacticTargetHighlight();
}

var SGRA = { rs: 0.32, sphere: 12, spin: 0.9 };

function buildSgrA(){
  var rinRs = 1.6 + (kerrIscoRg(SGRA.spin) - 1) / 5 * 1.4;
  var disk = makeDiskUniforms(rinRs, 9, 0.9);
  disk.uTempScale = { value: 0.62 };
  disk.uBright = { value: 1.1 };
  var q = QUALITY[state.sim.resolution] || QUALITY[2048];
  var rayU = { uRs: { value: SGRA.rs }, uSphere: { value: SGRA.sphere }, uSteps: { value: q.steps }, uStepScale: { value: q.stepScale } };
  var mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, disk, rayU),
    vertexShader: WORLD_VERT,
    fragmentShader: GLSL_NOISE + GLSL_DISK + BH_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  var mesh = new THREE.Mesh(new THREE.SphereGeometry(SGRA.sphere * SGRA.rs, 48, 24), mat);
  mesh.renderOrder = 3;
  SGRA.ray = rayU;
  return { mesh: mesh };
}

function flyToSgrA(){
  state.camMode = 'galactic';
  if(controls) controls.minDistance = 0.8;
  safeAnimeCamera(0, 0.35, 2.9, 0, 0, 0, 1600);
  var el = document.getElementById('stage-caption');
  if(el) el.innerHTML = '<strong>Sgr A*.</strong> The 4 million solar mass black hole at the centre of the Milky Way, ray-traced like the stellar-mass ones but drawn about 170 million times larger than true scale so it shows at galactic scale. Its feeble, hot accretion flow glows dull orange. Scroll out or choose Galaxy to return.';
  playClickSound();
}

function updateGalacticTargetHighlight(){
  markDirty();
  if(!state.target || !galaxyRefs) return;
  galaxyRefs.reticle.position.copy(targetWorldPosition(state.target));
  Object.keys(galaxyRefs.labels).forEach(function(id){
    var on = id === state.target.id;
    galaxyRefs.labels[id].visible = on || id === galaxyRefs.hovered;
    galaxyRefs.labels[id].material.opacity = on ? 1 : 0.75;
    galaxyRefs.dots[id].material.opacity = on ? 1 : 0.55;
  });
}

function getAstronomicalColormap(lum, cmap, r, g, b){
  var col = new THREE.Color();
  if(cmap === 'optical'){
    col.setRGB(r, g, b);
  }else if(cmap === 'chandra'){
    if(lum < 0.25){
      col.setRGB(lum * 2.0, 0.0, lum * 3.5);
    }else if(lum < 0.65){
      col.setRGB((lum - 0.25) * 1.5, (lum - 0.25) * 2.2, 0.95);
    }else{
      col.setRGB(0.95, 0.95, 0.75 + (lum - 0.65) * 0.7);
    }
  }else if(cmap === 'viridis'){
    col.setHSL((1.0 - lum) * 0.75 + 0.15, 0.9, 0.15 + lum * 0.7);
  }else if(cmap === 'wire'){
    col.setHex(0x38bdf8);
  }else{
    if(lum < 0.33){
      col.setRGB(lum * 3.0, 0.02, 0.05);
    }else if(lum < 0.72){
      col.setRGB(1.0, (lum - 0.33) * 2.3, 0.08);
    }else{
      col.setRGB(1.0, 0.95, (lum - 0.72) * 3.2);
    }
  }
  return col;
}

var obsImagePrimary = null;
var obsImageSecondary = null;
var obsCachedTargetId = null;
var obsCanvas = null;
var obsCtx = null;
var obsIsDragging = false;
var obsDragStart = { x: 0, y: 0 };
var obsSplitDragging = false;

function initRealObservatory(){
  obsCanvas = document.getElementById('real-obs-canvas');
  if(!obsCanvas) return;
  obsCtx = obsCanvas.getContext('2d');

  obsCanvas.addEventListener('mousedown', function(e){
    obsIsDragging = true;
    obsDragStart.x = e.clientX - state.obsPan.x;
    obsDragStart.y = e.clientY - state.obsPan.y;
  });

  window.addEventListener('mousemove', function(e){
    if(obsSplitDragging){
      var rect = obsCanvas.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      state.obsSplitX = Math.max(0.05, Math.min(0.95, pct));
      renderRealObservatory();
      return;
    }
    if(obsIsDragging){
      state.obsPan.x = e.clientX - obsDragStart.x;
      state.obsPan.y = e.clientY - obsDragStart.y;
      renderRealObservatory();
    }
  });

  window.addEventListener('mouseup', function(){
    obsIsDragging = false;
    obsSplitDragging = false;
  });

  obsCanvas.addEventListener('wheel', function(e){
    e.preventDefault();
    var zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    var newZoom = Math.max(0.4, Math.min(8.0, state.obsZoom * zoomFactor));
    state.obsZoom = newZoom;
    renderRealObservatory();
  }, { passive: false });

  obsCanvas.addEventListener('mousemove', function(e){
    var rect = obsCanvas.getBoundingClientRect();
    state.obsProbe.active = true;
    state.obsProbe.x = e.clientX - rect.left;
    state.obsProbe.y = e.clientY - rect.top;
    updatePhotometricProbe();
    renderRealObservatory();
  });

  obsCanvas.addEventListener('mouseleave', function(){
    state.obsProbe.active = false;
    renderRealObservatory();
  });

  var splitHandle = document.getElementById('obs-split-handle');
  if(splitHandle){
    splitHandle.addEventListener('mousedown', function(e){
      e.stopPropagation();
      obsSplitDragging = true;
    });
  }

  document.querySelectorAll('.obs-tool-btn[data-band]').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.obsBand = btn.getAttribute('data-band');
      document.querySelectorAll('.obs-tool-btn[data-band]').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      renderRealObservatory();
      playClickSound();
    });
  });

  var btnSplit = document.getElementById('btn-split-toggle');
  if(btnSplit){
    btnSplit.addEventListener('click', function(){
      state.obsSplit = !state.obsSplit;
      btnSplit.classList.toggle('active', state.obsSplit);
      var divEl = document.getElementById('obs-split-divider');
      if(divEl) divEl.classList.toggle('hidden', !state.obsSplit);
      renderRealObservatory();
      playClickSound();
    });
  }

  var btnContours = document.getElementById('btn-contours-toggle');
  if(btnContours){
    btnContours.addEventListener('click', function(){
      state.obsContours = !state.obsContours;
      btnContours.classList.toggle('active', state.obsContours);
      btnContours.textContent = state.obsContours ? 'Contours: ON' : 'Contours: OFF';
      renderRealObservatory();
      playClickSound();
    });
  }

  var btnProf = document.getElementById('btn-profile-toggle');
  var profDrawer = document.getElementById('real-obs-profile-drawer');
  if(btnProf && profDrawer){
    btnProf.addEventListener('click', function(){
      state.obsProfileOpen = !state.obsProfileOpen;
      btnProf.classList.toggle('active', state.obsProfileOpen);
      profDrawer.classList.toggle('hidden', !state.obsProfileOpen);
      if(state.obsProfileOpen) renderRadialProfileChart();
      playClickSound();
    });
  }

  var btnCloseProf = document.getElementById('btn-close-profile-drawer');
  if(btnCloseProf && profDrawer && btnProf){
    btnCloseProf.addEventListener('click', function(){
      state.obsProfileOpen = false;
      btnProf.classList.remove('active');
      profDrawer.classList.add('hidden');
      playClickSound();
    });
  }

  document.querySelectorAll('.obs-stretch-pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.obsStretch = btn.getAttribute('data-stretch');
      document.querySelectorAll('.obs-stretch-pill').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      renderRealObservatory();
      playClickSound();
    });
  });

  document.querySelectorAll('.obs-lut-pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.obsLut = btn.getAttribute('data-lut');
      document.querySelectorAll('.obs-lut-pill').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      renderRealObservatory();
      playClickSound();
    });
  });

  var bZoomIn = document.getElementById('btn-obs-zoom-in');
  if(bZoomIn){
    bZoomIn.addEventListener('click', function(){
      state.obsZoom = Math.min(8.0, state.obsZoom * 1.3);
      renderRealObservatory();
      playClickSound();
    });
  }
  var bZoomOut = document.getElementById('btn-obs-zoom-out');
  if(bZoomOut){
    bZoomOut.addEventListener('click', function(){
      state.obsZoom = Math.max(0.4, state.obsZoom / 1.3);
      renderRealObservatory();
      playClickSound();
    });
  }
  var bZoomReset = document.getElementById('btn-obs-zoom-reset');
  if(bZoomReset){
    bZoomReset.addEventListener('click', function(){
      state.obsZoom = 1.0;
      state.obsPan.x = 0;
      state.obsPan.y = 0;
      renderRealObservatory();
      playClickSound();
    });
  }
}

function updatePhotometricProbe(){
  var t = state.target;
  if(!t) return;
  var probe = state.obsProbe;
  if(!probe.active || !obsCanvas) return;

  var w = obsCanvas.width;
  var h = obsCanvas.height;
  var nx = (probe.x - w / 2 - state.obsPan.x) / (w * 0.5 * state.obsZoom);
  var ny = (probe.y - h / 2 - state.obsPan.y) / (h * 0.5 * state.obsZoom);
  var distCenter = Math.sqrt(nx * nx + ny * ny);

  var raBase = t.ra || '19h 58m 21.7s';
  var decBase = t.dec || '+35 12 06';
  var raSecOffset = (nx * 14.2).toFixed(2);
  var decArcOffset = (ny * -12.4).toFixed(1);

  var elRa = document.getElementById('probe-ra');
  if(elRa) elRa.textContent = raBase + ' (' + (raSecOffset >= 0 ? '+' : '') + raSecOffset + 's)';

  var elDec = document.getElementById('probe-dec');
  if(elDec) elDec.textContent = decBase + ' (' + (decArcOffset >= 0 ? '+' : '') + decArcOffset + '")';

  var baseFlux = Math.max(12, Math.exp(-distCenter * 2.8) * 48000 + (Math.random() * 45));
  var elFlux = document.getElementById('probe-flux');
  if(elFlux) elFlux.textContent = baseFlux.toFixed(0) + ' cts/s/px';

  var snr = Math.max(2.4, (baseFlux / Math.sqrt(baseFlux + 28)).toFixed(1));
  var elSnr = document.getElementById('probe-snr');
  if(elSnr) elSnr.textContent = snr + ' sigma';
}

function renderRadialProfileChart(){
  var svg = document.getElementById('svg-radial-profile');
  if(!svg) return;
  svg.innerHTML = '';

  var w = 340, h = 180;
  var pad = { top: 15, right: 15, bottom: 25, left: 40 };
  var plotW = w - pad.left - pad.right;
  var plotH = h - pad.top - pad.bottom;

  var pts = [];
  var nPts = 28;
  for(var i = 0; i < nPts; i++){
    var r = (i / (nPts - 1)) * 10.0;
    var profileVal = 100.0 / Math.pow(1.0 + Math.pow(r / 1.4, 2.0), 1.15) + (Math.random() * 3.5 - 1.75);
    if(profileVal < 1.0) profileVal = 1.0;
    pts.push({ r: r, val: profileVal });
  }

  var pathD = '';
  pts.forEach(function(pt, idx){
    var x = pad.left + (pt.r / 10.0) * plotW;
    var y = pad.top + plotH - (Math.log10(pt.val) / 2.0) * plotH;
    pathD += (idx === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  });

  var psfD = '';
  for(var pi = 0; pi < 40; pi++){
    var pr = (pi / 39) * 10.0;
    var pVal = 100.0 * Math.exp(-Math.pow(pr / 1.1, 2.0));
    if(pVal < 1.0) pVal = 1.0;
    var px = pad.left + (pr / 10.0) * plotW;
    var py = pad.top + plotH - (Math.log10(pVal) / 2.0) * plotH;
    psfD += (pi === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
  }

  var svgContent = '<line x1="' + pad.left + '" y1="' + (pad.top + plotH) + '" x2="' + (pad.left + plotW) + '" y2="' + (pad.top + plotH) + '" stroke="var(--color-text)"/>' +
    '<line x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (pad.top + plotH) + '" stroke="var(--color-text)"/>' +
    '<path d="' + psfD + '" fill="none" stroke="var(--color-muted)" stroke-width="1.5" stroke-dasharray="5,3"/>' +
    '<path d="' + pathD + '" fill="none" stroke="var(--color-text)" stroke-width="1.6"/>';

  pts.forEach(function(pt){
    var cx = pad.left + (pt.r / 10.0) * plotW;
    var cy = pad.top + plotH - (Math.log10(pt.val) / 2.0) * plotH;
    svgContent += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2" fill="var(--color-secondary)"/>';
  });

  svgContent += '<text x="' + (pad.left + plotW / 2) + '" y="' + (h - 6) + '" fill="var(--color-secondary)" font-size="9" text-anchor="middle" font-family="var(--font-sans)">Radius theta (arcsec)</text>' +
    '<text x="12" y="' + (pad.top + plotH / 2) + '" fill="var(--color-secondary)" font-size="9" text-anchor="middle" transform="rotate(-90 12 ' + (pad.top + plotH / 2) + ')" font-family="var(--font-sans)">log I(theta)</text>';

  svg.innerHTML = svgContent;
}

var GRMHD_PROFILES = {
  cyg: {
    name: 'Cygnus X-1',
    metric: 'Extreme Kerr Spacetime',
    param1Lbl: 'Spin a*:',
    param1Val: '0.998 c',
    param2Lbl: 'ISCO Radius:',
    param2Val: '1.24 R_g',
    param3Lbl: 'Lense-Thirring:',
    param3Val: '142.8 Hz',
    type: 'black_hole',
    coreColor: '#ffffff',
    innerColor: '#38bdf8',
    midColor: '#0284c7',
    outerColor: '#312e81',
    jetColor: '#0ea5e9',
    bfield: '1.2e8 G',
    spin: 0.998,
    isco: 1.24,
    doppler: 2.8,
    jetPower: 1.0,
    accretionMode: 'Focused Wind / Hard State'
  },
  crab: {
    name: 'Crab Pulsar',
    metric: 'Relativistic Magnetosphere',
    param1Lbl: 'Dipole Field B:',
    param1Val: '3.8e12 G',
    param2Lbl: 'Light Cylinder:',
    param2Val: '42.5 R_g (1590 km)',
    param3Lbl: 'Spin Period:',
    param3Val: '33.4 ms (29.9 Hz)',
    type: 'pulsar',
    coreColor: '#e0f2fe',
    innerColor: '#06b6d4',
    midColor: '#0284c7',
    outerColor: '#b45309',
    jetColor: '#38bdf8',
    bfield: '3.8e12 G',
    spin: 29.9,
    isco: 4.2,
    doppler: 1.2,
    jetPower: 0.9,
    accretionMode: 'Synchrotron Wind Nebula'
  },
  grs: {
    name: 'GRS 1915+105',
    metric: 'Extreme Kerr Microquasar',
    param1Lbl: 'Spin a*:',
    param1Val: '0.980 c',
    param2Lbl: 'ISCO Radius:',
    param2Val: '1.38 R_g',
    param3Lbl: 'Ejection Velocity:',
    param3Val: '0.92 c (Superluminal)',
    type: 'black_hole',
    coreColor: '#fff7ed',
    innerColor: '#f97316',
    midColor: '#ea580c',
    outerColor: '#7f1d1d',
    jetColor: '#fb923c',
    bfield: '4.5e7 G',
    spin: 0.980,
    isco: 1.38,
    doppler: 2.4,
    jetPower: 1.4,
    superluminal: true,
    accretionMode: 'Limit-Cycle Thermal Outburst'
  },
  v404: {
    name: 'V404 Cygni',
    metric: 'Precessing Kerr Metric',
    param1Lbl: 'Spin a*:',
    param1Val: '0.750 c',
    param2Lbl: 'ISCO Radius:',
    param2Val: '3.12 R_g',
    param3Lbl: 'Precession Freq:',
    param3Val: '0.12 Hz (8.3 s)',
    type: 'black_hole',
    coreColor: '#fdf4ff',
    innerColor: '#ec4899',
    midColor: '#c026d3',
    outerColor: '#4c1d95',
    jetColor: '#d946ef',
    bfield: '8.2e7 G',
    spin: 0.750,
    isco: 3.12,
    doppler: 1.9,
    jetPower: 1.2,
    precessing: true,
    accretionMode: 'Cataclysmic Super-Eddington Flare'
  },
  maxi: {
    name: 'MAXI J1820+070',
    metric: 'Moderate Kerr Metric',
    param1Lbl: 'Spin a*:',
    param1Val: '0.840 c',
    param2Lbl: 'ISCO Radius:',
    param2Val: '2.45 R_g',
    param3Lbl: 'Corona Scale:',
    param3Val: '8.5 R_g (Dynamic)',
    type: 'black_hole',
    coreColor: '#f8fafc',
    innerColor: '#60a5fa',
    midColor: '#2563eb',
    outerColor: '#1e3a8a',
    jetColor: '#93c5fd',
    bfield: '2.1e7 G',
    spin: 0.840,
    isco: 2.45,
    doppler: 2.0,
    jetPower: 0.85,
    coronaCloud: true,
    accretionMode: 'Hard-to-Soft Transition'
  },
  her: {
    name: 'Her X-1',
    metric: 'Channeled Magnetic Dipole',
    param1Lbl: 'Dipole Field B:',
    param1Val: '3.2e12 G',
    param2Lbl: 'Alfven Radius:',
    param2Val: '28.4 R_g',
    param3Lbl: 'Spin Period:',
    param3Val: '1.24 s (0.81 Hz)',
    type: 'pulsar',
    coreColor: '#faf5ff',
    innerColor: '#a855f7',
    midColor: '#7c3aed',
    outerColor: '#065f46',
    jetColor: '#c084fc',
    bfield: '3.2e12 G',
    spin: 0.81,
    isco: 3.5,
    doppler: 1.3,
    jetPower: 0.7,
    warpedDisk: true,
    accretionMode: 'Warped Precessing Curtain'
  },
  sco: {
    name: 'Sco X-1',
    metric: 'Near-Eddington Z-Source',
    param1Lbl: 'B-Field B:',
    param1Val: '5.0e8 G (Low)',
    param2Lbl: 'Inner Boundary:',
    param2Val: '1.65 R_g (NS Surface)',
    param3Lbl: 'kHz QPO Freq:',
    param3Val: '840 Hz (Fast)',
    type: 'neutron_star',
    coreColor: '#fffbeb',
    innerColor: '#fbbf24',
    midColor: '#d97706',
    outerColor: '#0e7490',
    jetColor: '#fde047',
    bfield: '5.0e8 G',
    spin: 8.5,
    isco: 1.65,
    doppler: 1.5,
    jetPower: 0.6,
    boundaryLayer: true,
    accretionMode: 'Radiation-Dominated Boundary Layer'
  },
  vela: {
    name: 'Vela X-1',
    metric: 'Wind-Fed Magnetosphere',
    param1Lbl: 'Dipole Field B:',
    param1Val: '2.6e12 G',
    param2Lbl: 'Alfven Radius:',
    param2Val: '34.2 R_g',
    param3Lbl: 'Spin Period:',
    param3Val: '283.5 s (Slow Pulsar)',
    type: 'pulsar',
    coreColor: '#f0fdf4',
    innerColor: '#22c55e',
    midColor: '#16a34a',
    outerColor: '#075985',
    jetColor: '#4ade80',
    bfield: '2.6e12 G',
    spin: 0.15,
    isco: 3.8,
    doppler: 1.1,
    jetPower: 0.75,
    windWake: true,
    accretionMode: 'Supersonic Bondi-Hoyle Wake'
  },
  '4u': {
    name: '4U 1820-30',
    metric: 'Ultracompact Burster',
    param1Lbl: 'Orbital Period:',
    param1Val: '11.4 min (P_orb)',
    param2Lbl: 'He-Disk Radius:',
    param2Val: '1.80 R_g',
    param3Lbl: 'Burst Cycle:',
    param3Val: '3.2 hr Thermonuclear',
    type: 'neutron_star',
    coreColor: '#fff1f2',
    innerColor: '#f43f5e',
    midColor: '#e11d48',
    outerColor: '#9a3412',
    jetColor: '#fb7185',
    bfield: '1.0e9 G',
    spin: 3.2,
    isco: 1.8,
    doppler: 1.4,
    jetPower: 0.5,
    thermonuclearBurst: true,
    accretionMode: 'Thermonuclear Flame Front'
  },
  cen: {
    name: 'Cen X-3',
    metric: 'Eclipsing Accretion Shock',
    param1Lbl: 'Dipole Field B:',
    param1Val: '3.0e12 G',
    param2Lbl: 'Alfven Radius:',
    param2Val: '26.8 R_g',
    param3Lbl: 'Spin Period:',
    param3Val: '4.84 s (0.21 Hz)',
    type: 'pulsar',
    coreColor: '#ecfdf5',
    innerColor: '#10b981',
    midColor: '#059669',
    outerColor: '#3730a3',
    jetColor: '#34d399',
    bfield: '3.0e12 G',
    spin: 0.21,
    isco: 3.2,
    doppler: 1.3,
    jetPower: 0.8,
    eclipsingFunnel: true,
    accretionMode: 'Dual Cyclotron Polar Funnel'
  }
};

var grmhdState = {
  active: false,
  running: true,
  speed: 1.0,
  time: 0,
  targetId: 'cyg',
  target: null,
  particles: [],
  plasmons: []
};
var grmhdAnimId = null;

function initGrmhdParticles(cfg){
  grmhdState.particles = [];
  var count = 220;
  for(var i = 0; i < count; i++){
    var u = Math.random();
    var r = (cfg.isco * 14) + Math.pow(u, 1.4) * 220;
    var theta = Math.random() * Math.PI * 2;
    var speed = (cfg.type === 'black_hole') ? (0.025 + (1.0 / (Math.sqrt(Math.max(1, r)) * 0.4))) : (0.02 + 0.04 * (1.0 - u));
    grmhdState.particles.push({
      r: r,
      theta: theta,
      speed: speed,
      size: 1.0 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      z: (Math.random() - 0.5) * 8.0
    });
  }
  grmhdState.plasmons = [];
  if(cfg.superluminal){
    for(var p = 0; p < 6; p++){
      grmhdState.plasmons.push({
        dist: 20 + p * 60,
        speed: 1.8 + p * 0.2,
        size: 8 + p * 3,
        alpha: 0.8 - p * 0.12
      });
    }
  }
}

function updateGrmhdTelemetry(target){
  var cfg = GRMHD_PROFILES[target.id] || GRMHD_PROFILES['cyg'];
  var tTitle = document.getElementById('grmhd-telem-title');
  if(tTitle) tTitle.textContent = cfg.name.toUpperCase() + ' RELATIVISTIC GRMHD';
  var vMet = document.getElementById('grmhd-val-metric');
  if(vMet) vMet.textContent = cfg.metric;
  var l1 = document.getElementById('grmhd-lbl-param1');
  if(l1) l1.textContent = cfg.param1Lbl;
  var v1 = document.getElementById('grmhd-val-param1');
  if(v1) v1.textContent = cfg.param1Val;
  var l2 = document.getElementById('grmhd-lbl-param2');
  if(l2) l2.textContent = cfg.param2Lbl;
  var v2 = document.getElementById('grmhd-val-param2');
  if(v2) v2.textContent = cfg.param2Val;
  var l3 = document.getElementById('grmhd-lbl-param3');
  if(l3) l3.textContent = cfg.param3Lbl;
  var v3 = document.getElementById('grmhd-val-param3');
  if(v3) v3.textContent = cfg.param3Val;
}

function startGrmhdSimulation(target){
  grmhdState.active = true;
  grmhdState.target = target;
  grmhdState.targetId = target.id;
  var cfg = GRMHD_PROFILES[target.id] || GRMHD_PROFILES['cyg'];
  initGrmhdParticles(cfg);
  updateGrmhdTelemetry(target);
  if(!grmhdAnimId){
    grmhdAnimId = requestAnimationFrame(grmhdSimLoop);
  }
}

function stopGrmhdSimulation(){
  grmhdState.active = false;
  if(grmhdAnimId){
    cancelAnimationFrame(grmhdAnimId);
    grmhdAnimId = null;
  }
}

function grmhdSimLoop(){
  if(!grmhdState.active) return;
  var canvas = document.getElementById('grmhd-sim-canvas');
  if(!canvas){
    grmhdAnimId = requestAnimationFrame(grmhdSimLoop);
    return;
  }
  var ctx = canvas.getContext('2d');
  if(!ctx){
    grmhdAnimId = requestAnimationFrame(grmhdSimLoop);
    return;
  }
  var w = canvas.clientWidth || window.innerWidth;
  var h = canvas.clientHeight || window.innerHeight;
  var resized = false;
  if(canvas.width !== w || canvas.height !== h){
    canvas.width = w;
    canvas.height = h;
    resized = true;
  }
  if(state.sim.paused && !resized){
    grmhdAnimId = requestAnimationFrame(grmhdSimLoop);
    return;
  }

  var cx = w / 2;
  var cy = h / 2;
  var cfg = GRMHD_PROFILES[grmhdState.targetId] || GRMHD_PROFILES['cyg'];
  var t = grmhdState.time;
  var spd = (state.sim.paused || !grmhdState.running) ? 0 : grmhdState.speed * state.sim.speed / 10;

  ctx.fillStyle = 'rgba(2, 4, 8, 0.32)';
  ctx.fillRect(0, 0, w, h);

  var baseR = Math.min(w, h) * 0.22;

  if(cfg.type === 'black_hole'){
    var wob = cfg.precessing ? Math.sin(t * 0.8) * 0.18 : 0;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    var jetGrad = ctx.createLinearGradient(cx, cy, cx + wob * 350, cy - 400);
    jetGrad.addColorStop(0, '#ffffff');
    jetGrad.addColorStop(0.2, cfg.jetColor);
    jetGrad.addColorStop(0.8, cfg.outerColor);
    jetGrad.addColorStop(1, 'transparent');

    ctx.fillStyle = jetGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + wob * 350 - 50, cy - 420);
    ctx.lineTo(cx + wob * 350 + 50, cy - 420);
    ctx.lineTo(cx + 10, cy);
    ctx.closePath();
    ctx.fill();

    var jetGradLower = ctx.createLinearGradient(cx, cy, cx - wob * 350, cy + 400);
    jetGradLower.addColorStop(0, '#ffffff');
    jetGradLower.addColorStop(0.2, cfg.jetColor);
    jetGradLower.addColorStop(0.8, cfg.outerColor);
    jetGradLower.addColorStop(1, 'transparent');

    ctx.fillStyle = jetGradLower;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx - wob * 350 - 50, cy + 420);
    ctx.lineTo(cx - wob * 350 + 50, cy + 420);
    ctx.lineTo(cx + 10, cy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for(var hy = -400; hy <= 400; hy += 10){
      var hx = Math.sin(hy * 0.04 + t * 2.8) * (8 + Math.abs(hy) * 0.08);
      if(hy === -400) ctx.moveTo(cx + hx + wob * (-hy), cy + hy);
      else ctx.lineTo(cx + hx + wob * (-hy), cy + hy);
    }
    ctx.stroke();

    if(cfg.superluminal && grmhdState.plasmons.length > 0){
      for(var pi = 0; pi < grmhdState.plasmons.length; pi++){
        var pl = grmhdState.plasmons[pi];
        if(grmhdState.running){
          pl.dist += pl.speed * spd;
          if(pl.dist > 450) pl.dist = 20;
        }
        var pAlpha = Math.max(0, 0.9 - (pl.dist / 450));
        ctx.fillStyle = 'rgba(251, 146, 60, ' + pAlpha + ')';
        ctx.beginPath();
        ctx.arc(cx + wob * pl.dist, cy - pl.dist, pl.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - wob * pl.dist, cy + pl.dist, pl.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    var outerDiskR = baseR * 1.85;
    var innerIscoR = baseR * (cfg.isco / 3.0);

    var diskGlow = ctx.createRadialGradient(cx, cy, innerIscoR, cx, cy, outerDiskR);
    diskGlow.addColorStop(0, cfg.innerColor);
    diskGlow.addColorStop(0.5, cfg.midColor);
    diskGlow.addColorStop(1, 'transparent');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.0, 0.44);
    ctx.fillStyle = diskGlow;
    ctx.beginPath();
    ctx.arc(0, 0, outerDiskR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.2;
    for(var arm = 0; arm < 4; arm++){
      ctx.beginPath();
      var armOffset = (arm * Math.PI / 2) - (t * 0.8 * grmhdState.speed);
      for(var ar = innerIscoR; ar < outerDiskR; ar += 6){
        var aTheta = armOffset + Math.log(ar / innerIscoR) * 2.2;
        var ax = Math.cos(aTheta) * ar;
        var ay = Math.sin(aTheta) * ar;
        if(ar === innerIscoR) ctx.moveTo(ax, ay);
        else ctx.lineTo(ax, ay);
      }
      ctx.stroke();
    }
    ctx.restore();

    var dopGrad = ctx.createRadialGradient(cx - (baseR * 0.6), cy, 10, cx, cy, baseR * 1.5);
    dopGrad.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
    dopGrad.addColorStop(0.35, cfg.innerColor);
    dopGrad.addColorStop(1, 'transparent');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.0, 0.44);
    ctx.fillStyle = dopGrad;
    ctx.beginPath();
    ctx.arc(0, 0, outerDiskR * 0.85, Math.PI * 0.5, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if(cfg.coronaCloud){
      var corR = innerIscoR * 2.2 + Math.sin(t * 2.5) * 6;
      var corGrad = ctx.createRadialGradient(cx, cy, innerIscoR * 0.5, cx, cy, corR);
      corGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      corGrad.addColorStop(0.6, 'rgba(96, 165, 250, 0.22)');
      corGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = corGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, corR, 0, Math.PI * 2);
      ctx.fill();
    }

    var rHorizon = innerIscoR * 0.72;
    var rPhoton = innerIscoR * 0.95;

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.0;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rPhoton * 1.35, rPhoton * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = cfg.innerColor;
    ctx.lineWidth = 7.0;
    ctx.shadowColor = cfg.innerColor;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rHorizon, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

  }else{
    ctx.save();
    var spinFreq = cfg.spin || 1.0;
    var sweepAngle = t * Math.min(spinFreq, 6.0) * 0.8;
    var maxBeamR = baseR * 3.4;

    ctx.save();
    ctx.lineWidth = 1.4;
    for(var arm = 0; arm < 2; arm++){
      var armAngle = sweepAngle + arm * Math.PI;
      for(var spiralPass = 0; spiralPass < 2; spiralPass++){
        var phaseOffset = spiralPass * (Math.PI * 0.5);
        ctx.beginPath();
        var waveStarted = false;
        for(var sr = 20; sr <= 380; sr += 8){
          var wavePhase = armAngle + phaseOffset - (sr / 24.0);
          var sx = cx + Math.cos(wavePhase) * sr;
          var sy = cy + Math.sin(wavePhase) * sr * 0.52;
          if(!waveStarted){
            ctx.moveTo(sx, sy);
            waveStarted = true;
          }else{
            ctx.lineTo(sx, sy);
          }
        }
        var armAlpha = Math.max(0.02, 0.28 * (1.0 - spiralPass * 0.45));
        ctx.strokeStyle = (spiralPass === 0) ? cfg.jetColor : cfg.innerColor;
        ctx.globalAlpha = armAlpha;
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for(var beam = 0; beam < 2; beam++){
      var bAng = sweepAngle + beam * Math.PI;
      var cosB = Math.cos(bAng);
      var sinB = Math.sin(bAng);
      var uBx = cosB;
      var uBy = sinB * 0.52;
      var nBx = -sinB;
      var nBy = cosB * 0.52;

      var tipX = cx + uBx * maxBeamR;
      var tipY = cy + uBy * maxBeamR;
      var halfW = maxBeamR * 0.26;

      var beamGradWide = ctx.createLinearGradient(cx, cy, tipX, tipY);
      beamGradWide.addColorStop(0, '#ffffff');
      beamGradWide.addColorStop(0.18, cfg.jetColor);
      beamGradWide.addColorStop(0.65, cfg.innerColor);
      beamGradWide.addColorStop(1, 'transparent');

      ctx.fillStyle = beamGradWide;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + uBx * (maxBeamR * 0.5) + nBx * (halfW * 0.45), cy + uBy * (maxBeamR * 0.5) + nBy * (halfW * 0.45), tipX + nBx * halfW, tipY + nBy * halfW);
      ctx.lineTo(tipX - nBx * halfW, tipY - nBy * halfW);
      ctx.quadraticCurveTo(cx + uBx * (maxBeamR * 0.5) - nBx * (halfW * 0.45), cy + uBy * (maxBeamR * 0.5) - nBy * (halfW * 0.45), cx, cy);
      ctx.closePath();
      ctx.fill();

      var beamGradCore = ctx.createLinearGradient(cx, cy, tipX, tipY);
      beamGradCore.addColorStop(0, '#ffffff');
      beamGradCore.addColorStop(0.22, cfg.jetColor);
      beamGradCore.addColorStop(0.8, 'transparent');

      var coreHalfW = halfW * 0.38;
      ctx.fillStyle = beamGradCore;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX + nBx * coreHalfW, tipY + nBy * coreHalfW);
      ctx.lineTo(tipX - nBx * coreHalfW, tipY - nBy * coreHalfW);
      ctx.closePath();
      ctx.fill();

      var pulseCount = 12;
      var pulseSpeed = 1.4 * grmhdState.speed;
      for(var pk = 0; pk < pulseCount; pk++){
        var pulsePhase = ((t * pulseSpeed + (pk / pulseCount)) % 1.0);
        var pr = 18 + pulsePhase * (maxBeamR - 18);
        var px = cx + uBx * pr;
        var py = cy + uBy * pr;
        var pw = 6 + pr * 0.22;
        var pAlpha = Math.sin(pulsePhase * Math.PI) * Math.pow(1.0 - pulsePhase, 0.7);

        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = pAlpha * 0.9;
        ctx.lineWidth = Math.max(1.2, 3.2 * (1.0 - pulsePhase));
        ctx.beginPath();
        ctx.moveTo(px - nBx * pw, py - nBy * pw);
        ctx.quadraticCurveTo(px + uBx * (pw * 0.45), py + uBy * (pw * 0.45), px + nBx * pw, py + nBy * pw);
        ctx.stroke();

        var pBlobGrad = ctx.createRadialGradient(px, py, 1, px, py, pw * 0.85);
        pBlobGrad.addColorStop(0, '#ffffff');
        pBlobGrad.addColorStop(0.4, cfg.jetColor);
        pBlobGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = pBlobGrad;
        ctx.globalAlpha = pAlpha * 0.45;
        ctx.beginPath();
        ctx.arc(px, py, pw * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.save();
    var magAxis = sweepAngle + Math.PI * 0.5;
    var cosMag = Math.cos(magAxis);
    var sinMag = Math.sin(magAxis);
    for(var loopSide = -1; loopSide <= 1; loopSide += 2){
      for(var dLoop = 1; dLoop <= 5; dLoop++){
        var lShell = 24 + dLoop * 22;
        ctx.beginPath();
        var loopStarted = false;
        for(var phi = 0.15; phi <= Math.PI - 0.15; phi += 0.12){
          var lr = lShell * Math.pow(Math.sin(phi), 2);
          var lTheta = phi * loopSide;
          var localX = lr * Math.sin(lTheta);
          var localY = lr * Math.cos(lTheta);
          var rotX = cx + (localX * cosMag - localY * sinMag);
          var rotY = cy + (localX * sinMag + localY * cosMag) * 0.52;
          if(!loopStarted){
            ctx.moveTo(rotX, rotY);
            loopStarted = true;
          }else{
            ctx.lineTo(rotX, rotY);
          }
        }
        ctx.strokeStyle = cfg.innerColor;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        var beadPhase = ((t * 1.5 + dLoop * 0.28) % 1.0) * (Math.PI - 0.3) + 0.15;
        var br = lShell * Math.pow(Math.sin(beadPhase), 2);
        var bTheta = beadPhase * loopSide;
        var bLocalX = br * Math.sin(bTheta);
        var bLocalY = br * Math.cos(bTheta);
        var bX = cx + (bLocalX * cosMag - bLocalY * sinMag);
        var bY = cy + (bLocalX * sinMag + bLocalY * cosMag) * 0.52;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(bX, bY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    var nsDiskR = baseR * 1.6;
    var nsGlow = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, nsDiskR);
    nsGlow.addColorStop(0, cfg.innerColor);
    nsGlow.addColorStop(0.55, cfg.midColor);
    nsGlow.addColorStop(1, 'transparent');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.0, 0.44);
    ctx.fillStyle = nsGlow;
    ctx.beginPath();
    ctx.arc(0, 0, nsDiskR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if(cfg.accretionMode === 'Synchrotron Wind Nebula' || cfg.jetPower >= 0.85){
      var torusR = baseR * 0.88;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, torusR, torusR * 0.44, 0, 0, Math.PI * 2);
      ctx.strokeStyle = cfg.jetColor;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = cfg.jetColor;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.45 + Math.sin(t * 3.0) * 0.15;
      ctx.stroke();
      ctx.restore();
    }

    if(cfg.thermonuclearBurst){
      var bPhase = (t * 0.4) % 6.0;
      if(bPhase < 1.2){
        var bWave = bPhase / 1.2;
        var bAlpha = 1.0 - bWave;
        ctx.strokeStyle = 'rgba(244, 63, 94, ' + bAlpha + ')';
        ctx.lineWidth = 6 * (1.0 - bWave);
        ctx.beginPath();
        ctx.ellipse(cx, cy, bWave * baseR * 1.8, bWave * baseR * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if(cfg.windWake){
      ctx.save();
      var wakeGrad = ctx.createLinearGradient(cx, cy, cx + baseR * 2.0, cy + baseR * 0.5);
      wakeGrad.addColorStop(0, 'rgba(34, 197, 94, 0.45)');
      wakeGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = wakeGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 25);
      ctx.lineTo(cx + baseR * 2.2, cy - 90);
      ctx.lineTo(cx + baseR * 2.2, cy + 90);
      ctx.lineTo(cx, cy + 25);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    var flashAlignment = Math.pow(Math.max(0, Math.sin(sweepAngle)), 8) + Math.pow(Math.max(0, Math.sin(sweepAngle + Math.PI)), 8);
    if(flashAlignment > 0.04){
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      var fRad = 32 + flashAlignment * 95;
      var fGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, fRad);
      fGrad.addColorStop(0, '#ffffff');
      fGrad.addColorStop(0.3, cfg.jetColor);
      fGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = fGrad;
      ctx.globalAlpha = Math.min(1.0, flashAlignment * 1.2);
      ctx.beginPath();
      ctx.arc(cx, cy, fRad, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.0;
      ctx.globalAlpha = flashAlignment * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx - fRad * 1.5, cy);
      ctx.lineTo(cx + fRad * 1.5, cy);
      ctx.stroke();
      ctx.restore();
    }

    var rNS = baseR * 0.22;
    var nsCoreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rNS);
    nsCoreGrad.addColorStop(0, '#ffffff');
    nsCoreGrad.addColorStop(0.4, cfg.coreColor);
    nsCoreGrad.addColorStop(0.85, cfg.innerColor);
    nsCoreGrad.addColorStop(1, cfg.outerColor);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rNS, 0, Math.PI * 2);
    ctx.fillStyle = nsCoreGrad;
    ctx.shadowColor = cfg.innerColor;
    ctx.shadowBlur = 24;
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rNS * 1.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if(grmhdState.particles && grmhdState.particles.length > 0){
    ctx.save();
    for(var i = 0; i < grmhdState.particles.length; i++){
      var p = grmhdState.particles[i];
      if(grmhdState.running){
        p.theta += p.speed * 0.04 * spd;
        p.r -= 0.35 * spd;
        var rMin = (cfg.type === 'black_hole') ? (cfg.isco * 12) : 24;
        if(p.r <= rMin){
          p.r = baseR * 1.8;
          p.theta = Math.random() * Math.PI * 2;
        }
      }
      var px = cx + Math.cos(p.theta) * p.r;
      var py = cy + Math.sin(p.theta) * p.r * 0.44 + p.z;
      var pDop = 1.0 - Math.sin(p.theta) * 0.45 * (cfg.doppler / 2.0);

      var pCol = (px < cx) ? cfg.coreColor : cfg.outerColor;
      var pSize = Math.max(0.8, p.size * pDop);
      var pAlpha = Math.min(1.0, Math.max(0.15, pDop));

      ctx.fillStyle = pCol;
      ctx.globalAlpha = pAlpha;
      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  grmhdState.time += 0.018 * spd;
  grmhdAnimId = requestAnimationFrame(grmhdSimLoop);
}

function initNasaSimulation(){
  var btnPlay = document.getElementById('btn-nasa-play-pause');
  if(btnPlay){
    btnPlay.addEventListener('click', function(){
      grmhdState.running = !grmhdState.running;
      btnPlay.textContent = grmhdState.running ? 'Pause' : 'Play';
      playClickSound();
    });
  }

  var btnSpeed = document.getElementById('btn-nasa-speed');
  var speeds = [1.0, 0.5, 0.25];
  var sIdx = 0;
  if(btnSpeed){
    btnSpeed.addEventListener('click', function(){
      sIdx = (sIdx + 1) % speeds.length;
      grmhdState.speed = speeds[sIdx];
      btnSpeed.textContent = (speeds[sIdx] === 0.25 ? '0.25x' : speeds[sIdx].toFixed(1) + 'x');
      playClickSound();
    });
  }

  var btnFull = document.getElementById('btn-nasa-fullscreen');
  var nViewport = document.getElementById('nasa-video-viewport');
  if(btnFull && nViewport){
    btnFull.addEventListener('click', function(){
      if(document.fullscreenElement){
        document.exitFullscreen();
      }else{
        nViewport.requestFullscreen().catch(function(){});
      }
      playClickSound();
    });
  }

  var telemCard = document.getElementById('nasa-video-telemetry');
  var btnCloseTelem = document.getElementById('btn-close-nasa-telem');
  if(btnCloseTelem && telemCard){
    btnCloseTelem.addEventListener('click', function(e){
      e.stopPropagation();
      telemCard.style.display = 'none';
      playClickSound();
    });
  }
}

function renderRealObservatory(){
  if(!obsCanvas || !obsCtx) return;
  var container = document.getElementById('real-observatory-wrapper');
  if(!container) return;

  var w = container.clientWidth || window.innerWidth;
  var h = container.clientHeight || window.innerHeight;
  obsCanvas.width = w;
  obsCanvas.height = h;

  var t = state.target;
  if(!t) return;
  var om = t.observatory_media || {};
  var primarySrc = om.image || 'assets/cygx1_chandra.jpg';
  var secondarySrc = (t.id === 'crab') ? 'assets/crab_xray_chandra.jpg' : primarySrc;

  if(!obsImagePrimary || obsCachedTargetId !== t.id){
    obsCachedTargetId = t.id;
    obsImagePrimary = new Image();
    obsImagePrimary.onload = function(){
      renderRealObservatory();
    };
    obsImagePrimary.src = primarySrc;

    obsImageSecondary = new Image();
    obsImageSecondary.onload = function(){
      if(state.obsSplit) renderRealObservatory();
    };
    obsImageSecondary.src = secondarySrc;
    return;
  }

  obsCtx.fillStyle = '#030508';
  obsCtx.fillRect(0, 0, w, h);

  if(!obsImagePrimary.complete || obsImagePrimary.naturalWidth === 0) return;

  var imgW = obsImagePrimary.naturalWidth;
  var imgH = obsImagePrimary.naturalHeight;
  var aspect = imgW / imgH;

  var fitW = w;
  var fitH = w / aspect;
  if(fitH > h){
    fitH = h;
    fitW = h * aspect;
  }

  var drawW = fitW * state.obsZoom;
  var drawH = fitH * state.obsZoom;
  var drawX = (w - drawW) / 2 + state.obsPan.x;
  var drawY = (h - drawH) / 2 + state.obsPan.y;

  function applyFilterStyle(ctx, lut, stretch){
    if(lut === 'heat'){
      ctx.filter = 'contrast(135%) saturate(180%) hue-rotate(-20deg)';
    }else if(lut === 'optical'){
      ctx.filter = 'contrast(110%) saturate(110%)';
    }else if(lut === 'plasma'){
      ctx.filter = 'contrast(140%) saturate(220%) hue-rotate(60deg)';
    }else if(lut === 'viridis'){
      ctx.filter = 'contrast(125%) saturate(160%) hue-rotate(140deg)';
    }else if(lut === 'mono'){
      ctx.filter = 'grayscale(100%) contrast(140%)';
    }else{
      ctx.filter = 'contrast(130%) saturate(140%) hue-rotate(15deg)';
    }
    if(stretch === 'log'){
      ctx.filter += ' brightness(125%)';
    }else if(stretch === 'asinh'){
      ctx.filter += ' brightness(115%) contrast(110%)';
    }else if(stretch === 'sqrt'){
      ctx.filter += ' brightness(108%)';
    }
  }

  if(state.obsSplit && obsImageSecondary && obsImageSecondary.complete){
    var splitPx = w * state.obsSplitX;
    var dividerEl = document.getElementById('obs-split-divider');
    if(dividerEl){
      dividerEl.style.left = splitPx + 'px';
      dividerEl.classList.remove('hidden');
    }

    obsCtx.save();
    obsCtx.beginPath();
    obsCtx.rect(0, 0, splitPx, h);
    obsCtx.clip();
    applyFilterStyle(obsCtx, state.obsLut, state.obsStretch);
    obsCtx.drawImage(obsImageSecondary, drawX, drawY, drawW, drawH);
    obsCtx.restore();

    obsCtx.save();
    obsCtx.beginPath();
    obsCtx.rect(splitPx, 0, w - splitPx, h);
    obsCtx.clip();
    applyFilterStyle(obsCtx, 'heat', state.obsStretch);
    obsCtx.drawImage(obsImagePrimary, drawX, drawY, drawW, drawH);
    obsCtx.restore();

    obsCtx.fillStyle = 'rgba(6, 182, 212, 0.9)';
    obsCtx.font = '10px monospace';
    obsCtx.fillText('CHANDRA X-RAY', 24, h - 24);
    obsCtx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    obsCtx.fillText('JWST INFRARED', w - 120, h - 24);

  }else{
    var dividerEl = document.getElementById('obs-split-divider');
    if(dividerEl) dividerEl.classList.add('hidden');

    obsCtx.save();
    applyFilterStyle(obsCtx, state.obsLut, state.obsStretch);
    obsCtx.drawImage(obsImagePrimary, drawX, drawY, drawW, drawH);
    obsCtx.restore();
  }

  if(state.obsContours){
    obsCtx.save();
    obsCtx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
    obsCtx.lineWidth = 1;
    var cx = drawX + drawW / 2;
    var cy = drawY + drawH / 2;
    [0.12, 0.24, 0.38, 0.55, 0.75].forEach(function(rFrac, cIdx){
      obsCtx.beginPath();
      var rx = (drawW * 0.45) * rFrac;
      var ry = (drawH * 0.45) * rFrac * (t.id === 'crab' ? 0.78 : 0.95);
      obsCtx.ellipse(cx, cy, rx, ry, (t.id === 'crab' ? -0.45 : 0), 0, Math.PI * 2);
      obsCtx.stroke();
    });
    obsCtx.restore();
  }

  if(state.obsProbe.active){
    obsCtx.save();
    var px = state.obsProbe.x;
    var py = state.obsProbe.y;
    obsCtx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    obsCtx.lineWidth = 1;
    obsCtx.beginPath();
    obsCtx.arc(px, py, 14, 0, Math.PI * 2);
    obsCtx.stroke();

    obsCtx.beginPath();
    obsCtx.moveTo(px - 22, py);
    obsCtx.lineTo(px - 16, py);
    obsCtx.moveTo(px + 16, py);
    obsCtx.lineTo(px + 22, py);
    obsCtx.moveTo(px, py - 22);
    obsCtx.lineTo(px, py - 16);
    obsCtx.moveTo(px, py + 16);
    obsCtx.lineTo(px, py + 22);
    obsCtx.stroke();
    obsCtx.restore();
  }

  obsCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  obsCtx.font = '10px monospace';
  obsCtx.fillText('FOV: ' + (t.category === 'black_hole' ? '4.8 arcmin' : '6.2 arcmin') + ' | SCALE: ' + (state.obsZoom * 100).toFixed(0) + '%', 24, 118);
}

function buildRealWorldSurfaceModel(target, callback){
  var om = target.observatory_media || {};
  var imgSrc = om.image || 'assets/cygx1_chandra.jpg';

  function buildFallbackSurface(){
    var w = 84, h = 84;
    var geo = new THREE.PlaneGeometry(36, 36, w - 1, h - 1);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var gain = state.fluxGain || 12.0;
    var cmap = state.fluxColormap || 'heat';
    for(var y = 0; y < h; y++){
      for(var x = 0; x < w; x++){
        var idx = y * w + x;
        var dx = (x - w / 2) / (w * 0.32);
        var dy = (y - h / 2) / (h * 0.32);
        var r2 = dx * dx + dy * dy;
        var lum = Math.exp(-r2 * 2.2);
        pos.setZ(idx, Math.pow(lum, 1.4) * gain);
        var col = getAstronomicalColormap(lum, cmap, lum, lum * 0.6, lum * 0.2);
        colors[idx * 3] = col.r;
        colors[idx * 3 + 1] = col.g;
        colors[idx * 3 + 2] = col.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      wireframe: (cmap === 'wire'),
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.25
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2.3;
    mesh.position.set(0, -1.5, 0);
    var gridBase = new THREE.GridHelper(40, 20, 0x06b6d4, 0x1e2438);
    gridBase.position.y = -1.6;
    var group = new THREE.Group();
    group.add(mesh);
    group.add(gridBase);
    realSurfaceGroup = group;
    if(callback) callback(group);
  }

  var img = new Image();
  if(imgSrc.indexOf('http:' + '/' + '/') === 0 || imgSrc.indexOf('https:' + '/' + '/') === 0){
    img.crossOrigin = 'anonymous';
  }
  img.onload = function(){
    try{
      var w = 84, h = 84;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var pData = ctx.getImageData(0, 0, w, h).data;

      var geo = new THREE.PlaneGeometry(36, 36, w - 1, h - 1);
      var pos = geo.attributes.position;
      var colors = new Float32Array(pos.count * 3);
      var gain = state.fluxGain || 12.0;
      var cmap = state.fluxColormap || 'heat';

      for(var y = 0; y < h; y++){
        for(var x = 0; x < w; x++){
          var idx = y * w + x;
          var pIdx = idx * 4;
          var r = pData[pIdx] / 255.0;
          var g = pData[pIdx + 1] / 255.0;
          var b = pData[pIdx + 2] / 255.0;
          var lum = 0.299 * r + 0.587 * g + 0.114 * b;

          var fluxHeight = Math.pow(lum, 1.4) * gain;
          pos.setZ(idx, fluxHeight);

          var col = getAstronomicalColormap(lum, cmap, r, g, b);
          colors[idx * 3] = col.r;
          colors[idx * 3 + 1] = col.g;
          colors[idx * 3 + 2] = col.b;
        }
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      var mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        wireframe: (cmap === 'wire'),
        side: THREE.DoubleSide,
        roughness: 0.35,
        metalness: 0.25
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2.3;
      mesh.position.set(0, -1.5, 0);

      var gridBase = new THREE.GridHelper(40, 20, 0x334155, 0x1e293b);
      gridBase.position.y = -1.6;

      var group = new THREE.Group();
      group.add(mesh);
      group.add(gridBase);
      realSurfaceGroup = group;

      if(callback) callback(group);
    }catch(err){
      buildFallbackSurface();
    }
  };
  img.onerror = buildFallbackSurface;
  img.src = imgSrc;
}

function buildSystemScene(target){
  var elObsWrap = document.getElementById('real-observatory-wrapper');
  var elNasaWrap = document.getElementById('nasa-video-viewport');
  var elThreeWrap = document.getElementById('three-canvas-wrapper');
  var simDrawer = document.getElementById('sandbox-controls-drawer');

  if(elObsWrap) elObsWrap.classList.add('hidden');
  syncCameraPills();
  if(state.modelMode === 'real-surface' && state.camMode === 'isco') setCameraMode('system');
  updateStageCaption();

  if(state.modelMode === 'real-video'){
    if(elNasaWrap) elNasaWrap.classList.remove('hidden');
    if(elThreeWrap) elThreeWrap.style.display = 'none';
    if(simDrawer) simDrawer.style.display = 'none';
    var tCard = document.getElementById('nasa-video-telemetry');
    if(tCard) tCard.style.display = 'block';
    startGrmhdSimulation(target);
    return;
  }
  if(elNasaWrap){
    elNasaWrap.classList.add('hidden');
    stopGrmhdSimulation();
  }

  if(simDrawer) simDrawer.style.display = 'block';
  if(elThreeWrap) elThreeWrap.style.display = 'block';

  disposeGroup(systemGroup);
  sys = null;
  realSurfaceGroup = null;

  if(state.modelMode === 'real-surface'){
    buildRealWorldSurfaceModel(target, function(surfaceGroup){
      disposeGroup(systemGroup);
      realSurfaceGroup = surfaceGroup;
      markDirty();
      systemGroup.add(surfaceGroup);
    });
    return;
  }

  markDirty();
  sys = target.category === 'black_hole' ? buildBlackHoleSystem(target) : buildNeutronStarSystem(target);
  var note = document.getElementById('scene-note');
  if(note){
    if(target.category === 'black_hole'){
      note.textContent = 'Lensing is ray-traced in a non-spinning metric; the inner disk edge follows the ISCO for a* = ' + (target.spin_a_star || 0) + '. Disk colour maps temperature. Not to scale.';
    }else if(/rotation-powered/i.test(target.type)){
      note.textContent = 'Isolated pulsar: beams sweep with the spin, inside a synchrotron torus and filaments. Not to scale.';
    }else{
      note.textContent = 'The disk stops at the magnetospheric radius, ' + Math.round(target.alfven_radius_km || 0) + ' km, drawn on a compressed scale. Disk colour maps temperature. Not to scale.';
    }
  }
  updateSimulationPhysics();
  if(state.camMode === 'isco' || state.camMode === 'system') setCameraMode(state.camMode);
}

function makeDiskUniforms(rinRs, routRs, hotK){
  return {
    uTime: uTimeShared,
    uRin: { value: rinRs },
    uRout: { value: routRs },
    uOmega0: { value: 1.1 * Math.pow(rinRs, 1.5) },
    uTempScale: { value: 0.7 },
    uBright: { value: 1.2 },
    uDoppler: { value: 1 },
    uHot: { value: new THREE.Vector3(0, 0, 0) },
    uHotOn: { value: 0 },
    uHotK: { value: hotK },
    uOct: uOctShared
  };
}

function makeJetPair(o){
  var group = new THREE.Group();
  [1, -1].forEach(function(dir){
    [[o.r0, o.r1, o.gain * 0.45, 1.2], [o.r0 * 0.4, o.r1 * 0.35, o.gain, 2.5]].forEach(function(layer){
      var geo = new THREE.CylinderGeometry(layer[1], layer[0], o.len, 48, 60, true);
      geo.translate(0, o.len / 2 + o.base, 0);
      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: uTimeShared,
          uColor: { value: new THREE.Vector3(o.color[0], o.color[1], o.color[2]) },
          uGain: { value: layer[2] },
          uSharp: { value: layer[3] },
          uBase: { value: o.base },
          uLen: { value: o.len },
          uFlow: { value: o.flow }
        },
        vertexShader: JET_VERT,
        fragmentShader: GLSL_NOISE + JET_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      var mesh = new THREE.Mesh(geo, mat);
      if(dir < 0) mesh.rotation.x = Math.PI;
      mesh.renderOrder = 3;
      group.add(mesh);
    });
  });
  return group;
}

function starMaterial(color, radius, opts){
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(color.r, color.g, color.b) },
      uTime: uTimeShared,
      uR: { value: radius },
      uIrr: { value: opts.irr || 0 },
      uCaps: { value: opts.caps || 0 },
      uBand: { value: opts.band || 0 },
      uGran: { value: opts.gran === undefined ? 1 : opts.gran },
      uLum: { value: opts.lum || 2.3 }
    },
    vertexShader: WORLD_VERT,
    fragmentShader: GLSL_NOISE + STAR_FRAG
  });
}

function buildBinary(target, diskOuter, compactKind){
  var prof = companionProfile(target);
  if(!prof) return null;
  var pivot = new THREE.Group();
  var R = prof.radius;
  var elong = prof.rlof ? 0.42 : 0.14;
  var D = diskOuter + R * (1 + elong) + 3.2;

  var geo = new THREE.SphereGeometry(R, 96, 64);
  var pa = geo.attributes.position;
  for(var i = 0; i < pa.count; i++){
    var x = pa.getX(i);
    if(x < 0){
      var f = -x / R;
      pa.setX(i, x * (1 + elong * f * f * f));
    }
  }
  geo.computeVertexNormals();
  var color = kelvinToColor(prof.teff);
  var star = new THREE.Mesh(geo, starMaterial(color, R, { irr: compactKind === 'bh' ? 0.3 : 0.45, lum: prof.teff > 9000 ? 4.2 : 3.6 }));
  star.position.set(D, 0, 0);
  pivot.add(star);
  var halo = glowSprite(color, R * 4.2, 0.28);
  halo.position.copy(star.position);
  pivot.add(halo);
  var corona = glowSprite(color, R * 2.6, 0.7);
  corona.position.copy(star.position);
  pivot.add(corona);

  var l1 = new THREE.Vector3(D - R * (1 + elong), 0, 0);
  var phiEnd = -0.62;
  var rim = new THREE.Vector3(Math.cos(phiEnd) * diskOuter * 0.86, 0, Math.sin(phiEnd) * diskOuter * 0.86);
  var p1 = new THREE.Vector3(l1.x - (l1.x - rim.x) * 0.4, 0.2, -2.6);
  var p2 = new THREE.Vector3(rim.x + 2.4, 0.1, rim.z - 0.4);

  var curve = new THREE.CubicBezierCurve3(l1, p1, p2, rim);
  var tubeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTimeShared,
      uColA: { value: new THREE.Vector3(Math.min(1, color.r * 1.05), color.g, color.b) },
      uColB: { value: new THREE.Vector3(1.0, 0.84, 0.66) },
      uGain: { value: prof.rlof ? 1.5 : 0.8 },
      uOn: { value: 1 },
      uRate: { value: 1.8 }
    },
    vertexShader: STREAM_VERT,
    fragmentShader: GLSL_NOISE + STREAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  var tube = new THREE.Mesh(streamTube(curve, function(u){ return 0.1 + 0.32 * Math.pow(u, 1.4) + 0.25 * Math.pow(Math.max(0, (u - 0.85) / 0.15), 2); }, 160, 24), tubeMat);
  tube.renderOrder = 2;
  pivot.add(tube);
  var nozzle = glowSprite(color, R * 0.55, 0.6);
  nozzle.position.copy(l1);
  pivot.add(nozzle);

  var nStream = 1400;
  var nWind = prof.wind ? 1800 : 0;
  var n = nStream + nWind;
  var seed = new Float32Array(n), jit = new Float32Array(n * 3), kind = new Float32Array(n), sz = new Float32Array(n);
  for(var j = 0; j < n; j++){
    seed[j] = Math.random();
    jit[j * 3] = gaussRand(); jit[j * 3 + 1] = gaussRand() * 0.6; jit[j * 3 + 2] = gaussRand();
    kind[j] = j < nStream ? 0 : 1;
    sz[j] = j < nStream ? 0.6 + Math.random() * 0.8 : 3.0 + Math.random() * 4.0;
  }
  var fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  fgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  fgeo.setAttribute('aJit', new THREE.BufferAttribute(jit, 3));
  fgeo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  fgeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  var flowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTimeShared,
      uRate: { value: prof.rlof ? 0.16 : 0.1 },
      uP0: { value: l1 }, uP1: { value: p1 }, uP2: { value: p2 }, uP3: { value: rim },
      uDonor: { value: star.position.clone() },
      uR: { value: R },
      uColor: { value: new THREE.Vector3(Math.min(1, color.r * 1.1), Math.min(1, color.g), Math.min(1, color.b * 0.95)) },
      uFocus: { value: 0.35 },
      uStreamOn: { value: prof.rlof ? 1 : 0.55 },
      uWindOn: { value: 1 },
      uPixel: uPixelShared,
      uScale: { value: 160 }
    },
    vertexShader: FLOW_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var flow = new THREE.Points(fgeo, flowMat);
  flow.frustumCulled = false;
  flow.renderOrder = 2;
  pivot.add(flow);

  var hot = glowSprite(new THREE.Color(1.0, 0.86, 0.7), 2.4, 0.85);
  hot.position.copy(rim);
  hot.renderOrder = 2;
  pivot.add(hot);

  var period = target.orbital_period_days || 3;
  return {
    group: pivot,
    flowMat: flowMat,
    tubeMat: tubeMat,
    nozzle: nozzle,
    hot: hot,
    rim: rim,
    rlof: prof.rlof,
    wind: prof.wind,
    rate: 0.06 * Math.max(0.35, Math.min(3, 1 / Math.sqrt(period))),
    extent: D + R
  };
}

function streamTube(curve, radius, segs, radial){
  var frames = curve.computeFrenetFrames(segs, false);
  var pos = [], nor = [], uu = [], ang = [], idx = [];
  var p = new THREE.Vector3(), n = new THREE.Vector3();
  for(var i = 0; i <= segs; i++){
    var u = i / segs;
    curve.getPointAt(u, p);
    var r = radius(u);
    for(var j = 0; j <= radial; j++){
      var a = j / radial * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uu.push(u);
      ang.push(a);
    }
  }
  for(i = 0; i < segs; i++){
    for(j = 0; j < radial; j++){
      var a0 = i * (radial + 1) + j, b0 = a0 + radial + 1;
      idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  geo.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1));
  geo.setIndex(idx);
  return geo;
}

function updateBinary(binary, disk, rs, time){
  if(!binary) return;
  binary.group.rotation.y = time * binary.rate;
  if(disk){
    disk.uHot.value.copy(binary.rim).applyAxisAngle(new THREE.Vector3(0, 1, 0), binary.group.rotation.y).multiplyScalar(1 / rs);
  }
}

function buildBlackHoleSystem(t){
  var rs = 1.2;
  var routW = 14.4;
  var sphereRs = 13.2;
  var rinRs = 1.6 + (kerrIscoRg(t.spin_a_star) - 1) / 5 * 1.4;
  var disk = makeDiskUniforms(rinRs, routW / rs, 0.9);
  var q = QUALITY[state.sim.resolution] || QUALITY[2048];
  var rayU = { uRs: { value: rs }, uSphere: { value: sphereRs }, uSteps: { value: q.steps }, uStepScale: { value: q.stepScale } };
  var mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, disk, rayU),
    vertexShader: WORLD_VERT,
    fragmentShader: GLSL_NOISE + GLSL_DISK + BH_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  var bh = new THREE.Mesh(new THREE.SphereGeometry(sphereRs * rs, 64, 32), mat);
  bh.renderOrder = 1;
  systemGroup.add(bh);

  var jets = makeJetPair({ base: 1.9, len: 30, r0: 0.3, r1: 2.8, color: [0.62, 0.75, 1.0], gain: 0.75, flow: 1.6 });
  systemGroup.add(jets);

  var binary = buildBinary(t, routW, 'bh');
  if(binary) systemGroup.add(binary.group);

  return {
    kind: 'bh',
    rs: rs,
    disk: disk,
    ray: rayU,
    jets: jets,
    binary: binary,
    extent: binary ? binary.extent : routW,
    update: function(time){ updateBinary(binary, disk, rs, time); }
  };
}

function dipoleLines(Ls, nPhi, rns){
  var pts = [];
  Ls.forEach(function(L){
    var ths = Math.asin(Math.sqrt(Math.min(1, rns / L)));
    for(var k = 0; k < nPhi; k++){
      var ph = k / nPhi * Math.PI * 2;
      var prev = null;
      for(var s = 0; s <= 60; s++){
        var th = ths + (Math.PI - 2 * ths) * s / 60;
        var r = L * Math.sin(th) * Math.sin(th);
        var p = new THREE.Vector3(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph));
        if(prev){ pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); }
        prev = p;
      }
    }
  });
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
}

function buildColumns(rm, rns){
  var n = 2600;
  var seed = new Float32Array(n), L = new Float32Array(n), phi = new Float32Array(n), hemi = new Float32Array(n), sz = new Float32Array(n);
  for(var i = 0; i < n; i++){
    seed[i] = Math.random();
    L[i] = rm * (0.95 + Math.random() * 0.15);
    phi[i] = Math.random() * Math.PI * 2;
    hemi[i] = Math.random() < 0.5 ? 1 : -1;
    sz[i] = 0.5 + Math.random() * 0.7;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aL', new THREE.BufferAttribute(L, 1));
  geo.setAttribute('aPhi', new THREE.BufferAttribute(phi, 1));
  geo.setAttribute('aHemi', new THREE.BufferAttribute(hemi, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  var mat = new THREE.ShaderMaterial({
    uniforms: { uTime: uTimeShared, uRns: { value: rns }, uOn: { value: 1 }, uPixel: uPixelShared, uScale: { value: 160 } },
    vertexShader: COLUMN_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  return pts;
}

function buildPulsarWindNebula(){
  var pos = [], col = [], size = [];
  var i;
  for(i = 0; i < 5000; i++){
    var a = Math.random() * Math.PI * 2;
    var rr = 5.2 + gaussRand() * 0.7;
    var b = 0.5 + Math.random() * 0.5;
    pos.push(rr * Math.cos(a), gaussRand() * 0.35, rr * Math.sin(a));
    col.push(0.62 * b, 0.76 * b, 1.0 * b);
    size.push(1.0 + Math.random());
  }
  for(i = 0; i < 3000; i++){
    pos.push(gaussRand() * 3.0, gaussRand() * 2.3, gaussRand() * 3.0);
    col.push(0.22, 0.26, 0.45);
    size.push(2.0 + Math.random() * 1.5);
  }
  var d = new THREE.Vector3(), drift = new THREE.Vector3(), jitter = new THREE.Vector3();
  for(var f = 0; f < 140; f++){
    d.set(gaussRand(), gaussRand(), gaussRand()).normalize();
    drift.set(gaussRand(), gaussRand(), gaussRand()).normalize();
    var radius = 12 + Math.random() * 3.5;
    var green = Math.random() < 0.25;
    for(var s = 0; s < 46; s++){
      jitter.set(gaussRand(), gaussRand(), gaussRand()).multiplyScalar(0.02);
      d.addScaledVector(drift, 0.045).add(jitter).normalize();
      var bb = 0.4 + Math.random() * 0.6;
      pos.push(d.x * radius * 1.3, d.y * radius * 0.95, d.z * radius * 1.05);
      if(green) col.push(0.85 * bb, 0.75 * bb, 0.4 * bb);
      else col.push(1.0 * bb, 0.4 * bb, 0.2 * bb);
      size.push(1.2 + Math.random() * 1.2);
    }
  }
  return makeSoftPoints(pos, col, size, { atten: true, scale: 160 });
}

function buildNeutronStarSystem(t){
  var rs = 0.35;
  var rns = 0.9;
  var B = t.magnetic_field_gauss || 0;
  var rotationPowered = /rotation-powered/i.test(t.type);
  var highField = B >= 1e11 && !rotationPowered;
  var alf = t.alfven_radius_km || 30;
  var rm = Math.max(rns * 1.6, rns * (1 + 2.2 * Math.log10(Math.max(alf / 12, 1))));
  var rinW = highField ? rm : rns * 1.15;
  var routW = 11.2;
  var spinRate = t.spin_period_s ? Math.max(0.4, Math.min(6, 3 / Math.pow(t.spin_period_s, 0.25))) : 1.5;

  var spinGroup = new THREE.Group();
  systemGroup.add(spinGroup);
  var magGroup = new THREE.Group();
  magGroup.rotation.z = 0.32;
  spinGroup.add(magGroup);

  var ns = new THREE.Mesh(new THREE.SphereGeometry(rns, 64, 48), starMaterial(new THREE.Color(1.1, 1.25, 1.6), rns, {
    caps: highField || rotationPowered ? 1 : 0,
    band: highField || rotationPowered ? 0 : 1,
    gran: 0.35
  }));
  magGroup.add(ns);
  var nsGlow = glowSprite(new THREE.Color(0.75, 0.85, 1.0), rns * 5, 0.5);
  systemGroup.add(nsGlow);

  var fieldLs = rotationPowered ? [2.2, 3.6, 6, 9.5] : (highField ? [rm * 0.55, rm * 0.8, rm * 1.05, rm * 1.5, rm * 2.1] : [1.35, 1.8]);
  var field = dipoleLines(fieldLs, 8, rns);
  magGroup.add(field);

  var disk = null, columns = null, beams = null, jets = null, pwn = null;
  if(!rotationPowered){
    disk = makeDiskUniforms(rinW / rs, routW / rs, 0.087);
    var dmat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uRs: { value: rs } }, disk),
      vertexShader: WORLD_VERT,
      fragmentShader: GLSL_NOISE + GLSL_DISK + FLAT_DISK_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor
    });
    var dmesh = new THREE.Mesh(new THREE.RingGeometry(rinW, routW, 256, 8), dmat);
    dmesh.rotation.x = -Math.PI / 2;
    dmesh.renderOrder = 1;
    systemGroup.add(dmesh);
  }
  if(highField){
    columns = buildColumns(rinW, rns);
    magGroup.add(columns);
    [1, -1].forEach(function(s){
      var cap = glowSprite(new THREE.Color(1.0, 0.95, 0.85), 2.2, 0.9);
      cap.position.set(0, s * rns * 1.02, 0);
      magGroup.add(cap);
    });
  }
  if(!highField && !rotationPowered){
    var bl = new THREE.Mesh(new THREE.TorusGeometry(rns * 1.04, 0.07, 16, 128), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    bl.rotation.x = Math.PI / 2;
    systemGroup.add(bl);
  }
  if(rotationPowered){
    beams = makeJetPair({ base: 1.0, len: 26, r0: 0.1, r1: 2.2, color: [0.85, 0.9, 1.0], gain: 0.55, flow: 3.0 });
    magGroup.add(beams);
    jets = makeJetPair({ base: 1.2, len: 9, r0: 0.15, r1: 0.9, color: [0.6, 0.75, 1.0], gain: 0.8, flow: 1.0 });
    systemGroup.add(jets);
    pwn = buildPulsarWindNebula();
    systemGroup.add(pwn);
  }

  var binary = buildBinary(t, routW, 'ns');
  if(binary) systemGroup.add(binary.group);

  return {
    kind: 'ns',
    rs: rs,
    disk: disk,
    jets: jets,
    field: field,
    columns: columns,
    binary: binary,
    extent: binary ? binary.extent : 16,
    update: function(time){
      spinGroup.rotation.y = time * spinRate;
      if(pwn) pwn.rotation.y = time * 0.03;
      updateBinary(binary, disk, rs, time);
    }
  };
}

function updateSimulationPhysics(){
  markDirty();
  if(!sys) return;
  if(sys.jets) sys.jets.visible = state.sim.jets;
  if(sys.field) sys.field.visible = state.sim.magfield;
  if(sys.columns) sys.columns.material.uniforms.uOn.value = state.sim.stream ? 1 : 0;
  if(sys.binary){
    var u = sys.binary.flowMat.uniforms;
    u.uStreamOn.value = state.sim.stream ? (sys.binary.rlof ? 1 : 0.55) : 0;
    u.uWindOn.value = state.sim.stream ? 1 : 0;
    sys.binary.hot.visible = state.sim.stream;
    sys.binary.nozzle.visible = state.sim.stream && sys.binary.rlof;
    sys.binary.tubeMat.uniforms.uOn.value = state.sim.stream ? 1 : 0;
  }
  if(sys.disk){
    sys.disk.uDoppler.value = state.sim.doppler ? 1 : 0;
    sys.disk.uHotOn.value = state.sim.stream && sys.binary ? 1 : 0;
    sys.disk.uTempScale.value = 0.55 + 0.35 * Math.max(0.1, Math.min(2.5, state.params.tin));
    var lm = (Math.log(Math.max(state.params.mdot, 0.001)) / Math.LN10 + 2) / 2;
    var lf = state.sim.followLive ? liveFactor(state.target) : null;
    sys.disk.uBright.value = (1.2 + 0.8 * Math.max(0, Math.min(1, lm))) * (lf === null ? 1 : Math.sqrt(lf));
  }
  var q = QUALITY[state.sim.resolution] || QUALITY[2048];
  [sys.ray, SGRA.ray].forEach(function(r){
    if(!r) return;
    r.uSteps.value = q.steps;
    r.uStepScale.value = q.stepScale;
  });
}

var MODEL_TEXT = {
  theory: 'A physical model of the system. Light from the disk is ray-traced around the compact object, the disk glows by temperature and brightens on its approaching side, and gas flows in from the companion. Parameters come from the catalogue and the spectral fit.',
  'real-surface': 'The observatory image turned into a landscape: height and colour are photon counts per pixel, so point sources stand up as peaks above the diffuse background.',
  'real-video': 'An illustrative 2D animation in the style of general-relativistic magnetohydrodynamic simulations: plasma spiralling through the inner disk and into the jets, scaled to this source\u2019s spin and ISCO. It is not a solved simulation.'
};
var CAMERA_TEXT = {
  system: 'System view: the whole binary, compact object, disk and companion.',
  isco: 'ISCO view: close to the innermost stable circular orbit, where lensing and Doppler beaming are strongest.',
  galactic: 'Galaxy view: where each source sits in the Milky Way, from catalogue distances, with the Sun on the solar circle. Select a marker to switch source.',
  free: 'Free view: drag to orbit, scroll to zoom, right-drag to pan.'
};

function updateStageCaption(){
  var el = document.getElementById('stage-caption');
  if(!el) return;
  var label = { theory: 'Relativistic', 'real-surface': 'Flux surface', 'real-video': 'GRMHD' }[state.modelMode] || '';
  if(state.modelMode === 'real-video'){
    el.innerHTML = '<strong>' + label + '.</strong> ' + MODEL_TEXT[state.modelMode];
  }else if(state.camMode === 'galactic'){
    el.innerHTML = '<strong>Galaxy.</strong> Where each source sits in the Milky Way, from catalogue distances, with the Sun on the solar circle. Select a marker to switch source, or Sgr A* to fly into the central black hole.';
  }else{
    el.innerHTML = '<strong>' + label + '.</strong> ' + (MODEL_TEXT[state.modelMode] || '') + ' ' + (CAMERA_TEXT[state.camMode] || '');
  }
}

function syncCameraPills(){
  document.querySelectorAll('.cam-pill').forEach(function(p){
    var m = p.getAttribute('data-cam');
    var off = state.modelMode === 'real-video' || (state.modelMode === 'real-surface' && m === 'isco');
    p.disabled = off;
    p.title = off ? (state.modelMode === 'real-video' ? 'Camera modes apply to the 3D models, not the GRMHD animation' : 'The ISCO view applies to the Relativistic model') : '';
  });
}

function setCameraMode(mode){
  if(mode === 'isco' && state.modelMode === 'real-surface') return;
  state.camMode = mode;
  updateStageCaption();
  document.querySelectorAll('.cam-pill').forEach(function(p){
    var on = p.getAttribute('data-cam') === mode;
    p.classList.toggle('active', on);
    p.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if(!camera) return;
  var isNS = state.target && state.target.category !== 'black_hole';
  galacticGroup.visible = mode === 'galactic';
  systemGroup.visible = mode !== 'galactic';
  if(controls){
    controls.minDistance = mode === 'galactic' ? 1 : 1.5;
    controls.maxDistance = mode === 'galactic' ? 420 : 260;
  }
  if(mode === 'galactic'){
    safeAnimeCamera(-20, 95, 88, -20.5, 0, 0, 1100);
  }else if(mode === 'isco'){
    if(isNS && /rotation-powered/i.test(state.target.type)) safeAnimeCamera(0, 3.2, 15, 0, 0, 0, 1000);
    else if(isNS) safeAnimeCamera(0, 1.4, 7.5, 0, 0, 0, 1000);
    else safeAnimeCamera(0, 1.1, 10.5, 0, 0, 0, 1000);
  }else if(mode === 'system'){
    var ext = sys && sys.extent ? sys.extent : 30;
    safeAnimeCamera(ext * 0.15, ext * 0.75, ext * 2.35, ext * 0.15, 0, 0, 1100);
  }else{
    var extF = sys && sys.extent ? sys.extent : 30;
    safeAnimeCamera(extF * 1.2, extF * 0.3, extF * 1.0, extF * 0.2, 0, 0, 1100);
  }
}

var camTween = null;

function safeAnimeCamera(px, py, pz, tx, ty, tz, duration){
  var from = {
    x: camera.position.x, y: camera.position.y, z: camera.position.z,
    tx: controls ? controls.target.x : 0, ty: controls ? controls.target.y : 0, tz: controls ? controls.target.z : 0
  };
  function apply(v){
    camera.position.set(v.x, v.y, v.z);
    if(controls){
      controls.target.set(v.tx, v.ty, v.tz);
      controls.update();
    }else{
      camera.lookAt(v.tx, v.ty, v.tz);
    }
  }
  var to = { x: px, y: py, z: pz, tx: tx, ty: ty, tz: tz };
  if(typeof anime === 'undefined' || prefersCalm()){
    apply(to);
    return;
  }
  if(camTween) anime.remove(camTween);
  camTween = from;
  anime(Object.assign({ targets: from, duration: duration || 800, easing: 'easeOutCubic', update: function(){ apply(from); } }, to));
}

function startRenderLoop(){
  var clock = new THREE.Clock();
  function animate(){
    animFrameId = requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.1);
    var wall = performance.now();
    if(state.view !== 'sandbox-view' || state.modelMode === 'real-video' || document.hidden || wall - perf.lastScroll < 180){
      fpsMeter.frames = 0;
      fpsMeter.since = wall;
      return;
    }
    var speedMul = state.sim.speed / 10;
    if(!state.sim.paused) simTime += dt * speedMul;
    uTimeShared.value = simTime;
    skyGroup.position.copy(camera.position);
    if(systemGroup.visible){
      if(realSurfaceGroup && state.modelMode === 'real-surface' && !state.sim.paused){
        realSurfaceGroup.rotation.y += 0.18 * dt * speedMul;
      }
      if(sys) sys.update(simTime);
    }
    if(galacticGroup.visible && galaxyRefs) galaxyRefs.update(simTime);
    if(controls) controls.update();
    var viewKey = camera.position.toArray().map(function(v){ return v.toFixed(4); }).join(',') + '|' + simTime.toFixed(4) + '|' + state.camMode + '|' + state.modelMode;
    if(viewKey === perf.lastKey && !perf.dirty){
      fpsMeter.frames = 0;
      fpsMeter.since = performance.now();
      var idleEl = document.getElementById('fps-readout');
      if(idleEl) idleEl.textContent = 'idle';
      return;
    }
    perf.lastKey = viewKey;
    perf.dirty = false;
    renderer.render(scene, camera);
    fpsMeter.frames++;
    var span = performance.now() - fpsMeter.since;
    if(span >= 1000){
      var fpsEl = document.getElementById('fps-readout');
      var fpsNow = Math.round(fpsMeter.frames * 1000 / span);
      if(fpsEl) fpsEl.textContent = fpsNow + ' fps';
      checkPerf(fpsNow);
      fpsMeter.frames = 0;
      fpsMeter.since = performance.now();
    }
  }
  animate();
}

function onWindowResize(){
  markDirty();
  var container = document.getElementById('three-canvas-wrapper');
  if(!container || !camera || !renderer) return;
  var w = container.clientWidth || window.innerWidth;
  var h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderRealObservatory();
}

function selectTarget(id){
  var t = DATA.targets.find(function(item){ return item.id === id; });
  if(!t) return;

  state.targetId = id;
  state.target = t;

  state.params.tin = t.tin_kev || 0.45;
  state.params.mdot = t.eddington_fraction || 0.012;
  state.params.gamma = t.photon_index || 1.74;
  state.params.fe = t.fe_centroid_kev || 6.41;
  state.params.bfield = (t.magnetic_field_gauss ? t.magnetic_field_gauss / 1e11 : 32);
  state.fitErrors = null;
  state.fitLog = null;

  document.querySelectorAll('.target-pill').forEach(function(pill){
    pill.classList.toggle('active', pill.getAttribute('data-id') === id);
  });

  var activePill = document.querySelector('.target-pill.active');
  if(activePill){
    activePill.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  updateGalacticTargetHighlight();
  updateTargetHud();
  buildSystemScene(t);
  renderAllCharts();
  playClickSound();
}

function refreshParamLabels(){
  var e = state.fitErrors || {};
  function pm(v, d){
    if(v === undefined || !isFinite(v) || v <= 0) return '';
    return ' \u00b1 ' + v.toFixed(Math.max(d, Math.min(5, 1 - Math.floor(Math.log10(v)))));
  }
  function set(id, txt){ var el = document.getElementById(id); if(el) el.textContent = txt; }
  set('val-tin', state.params.tin.toFixed(2) + pm(e.tin, 2) + ' keV');
  set('val-mdot', state.params.mdot.toFixed(3) + pm(e.mdot, 3) + ' L_Edd');
  set('val-gamma', state.params.gamma.toFixed(2) + pm(e.gamma, 2));
  set('val-fe', state.params.fe.toFixed(2) + pm(e.fe, 2) + ' keV');
  set('val-bfield', (state.params.bfield / 10).toFixed(1) + pm(e.bfield !== undefined ? e.bfield / 10 : undefined, 1) + ' x 10^12 G');
  set('bfield-desc', 'Sets the cyclotron line, now at ' + (0.89 * state.params.bfield).toFixed(1) + ' keV after gravitational redshift.');
}

function updateTargetHud(){
  var t = state.target;
  var elName = document.getElementById('hud-target-name');
  if(elName) elName.textContent = t.name;

  var elType = document.getElementById('hud-target-type');
  if(elType) elType.textContent = t.type;

  var elState = document.getElementById('hud-target-state');
  if(elState) elState.textContent = t.state;

  var elDesc = document.getElementById('hud-target-desc');
  if(elDesc) elDesc.textContent = t.description;

  var elDist = document.getElementById('hud-target-dist');
  if(elDist) elDist.textContent = t.distance;

  var elMass = document.getElementById('hud-target-mass');
  if(elMass) elMass.textContent = t.mass_compact_msun + ' M\u2299';

  var elMode = document.getElementById('hud-target-mode');
  if(elMode) elMode.textContent = t.accretion_mode;

  var elEdd = document.getElementById('hud-target-edd');
  if(elEdd) elEdd.textContent = t.eddington_fraction;

  refreshParamLabels();

  var rngTin = document.getElementById('rng-tin');
  if(rngTin) rngTin.value = state.params.tin;
  var valTin = document.getElementById('val-tin');
  if(valTin) valTin.textContent = state.params.tin.toFixed(2) + ' keV';

  var rngMdot = document.getElementById('rng-mdot');
  if(rngMdot) rngMdot.value = state.params.mdot;
  var valMdot = document.getElementById('val-mdot');
  if(valMdot) valMdot.textContent = state.params.mdot.toFixed(3) + ' L_Edd';

  var rngGamma = document.getElementById('rng-gamma');
  if(rngGamma) rngGamma.value = state.params.gamma;
  var valGamma = document.getElementById('val-gamma');
  if(valGamma) valGamma.textContent = state.params.gamma.toFixed(2);

  var rngFe = document.getElementById('rng-fe');
  if(rngFe) rngFe.value = state.params.fe;
  var valFe = document.getElementById('val-fe');
  if(valFe) valFe.textContent = state.params.fe.toFixed(2) + ' keV';

  var bGroup = document.getElementById('group-bfield');
  if(bGroup){
    bGroup.style.display = t.category === 'neutron_star' ? 'flex' : 'none';
  }
  var cyclChip = document.getElementById('chip-cyclabs');
  if(cyclChip){
    cyclChip.style.display = t.category === 'neutron_star' ? 'inline-block' : 'none';
  }

  var om = t.observatory_media || {};
  var elThumb = document.getElementById('hud-media-thumb');
  if(elThumb && om.image) elThumb.src = om.image;

  var elResTag = document.getElementById('hud-media-res-tag');
  if(elResTag && om.image_resolution){
    var shortRes = om.image_resolution.split(' ')[0] + ' px';
    elResTag.textContent = shortRes;
  }

  var elTypeTag = document.getElementById('hud-media-type-tag');
  if(elTypeTag && om.image_facility){
    var facShort = om.image_facility.split('&')[0].trim();
    elTypeTag.textContent = facShort;
  }

  updatePhysicsDerivedMetrics();
  renderLiveLine();
  renderSkyMap();
}

function updatePhysicsDerivedMetrics(){
  var t = state.target;
  var tinKev = state.params.tin;
  var tinKelvin = tinKev * 1.16045e7;
  var mdotEdd = state.params.mdot;
  var massMsun = t.mass_compact_msun || 10;

  var mdotSec = mdotEdd * 1.4e18 * (massMsun / 10);
  var mdotYr = mdotSec * (3.15e7 / 1.989e33);

  var statTempK = document.getElementById('stat-temp-k');
  if(statTempK) statTempK.innerHTML = (tinKelvin / 1e6).toFixed(2) + ' &times; 10^6 K';

  var statTempKev = document.getElementById('stat-temp-kev');
  if(statTempKev) statTempKev.innerHTML = tinKev.toFixed(2) + ' keV';

  var statMdotYr = document.getElementById('stat-mdot-yr');
  if(statMdotYr) statMdotYr.innerHTML = (mdotYr * 1e9).toFixed(2) + ' &times; 10^-9 M&#9737;/yr';

  var statMdotSec = document.getElementById('stat-mdot-sec');
  if(statMdotSec) statMdotSec.innerHTML = (mdotSec / 1e17).toFixed(2) + ' &times; 10^17 g/s';

  var statInstab = document.getElementById('stat-instab-state');
  var statDesc = document.getElementById('stat-instab-desc');
  if(mdotEdd < 0.05){
    if(statInstab) statInstab.textContent = 'Low / hard';
    if(statDesc) statDesc.textContent = 'Truncated inner disk, jet active';
  }else if(mdotEdd < 0.35){
    if(statInstab) statInstab.textContent = 'Intermediate';
    if(statDesc) statDesc.textContent = 'Disk instability modulating the jet';
  }else{
    if(statInstab) statInstab.textContent = 'High / soft';
    if(statDesc) statDesc.textContent = 'Disk reaches the ISCO, jet quenched';
  }

}

function prefersCalm(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function revealView(view){
  if(!view || view.getAttribute('data-revealed')) return;
  view.setAttribute('data-revealed', '1');
  if(prefersCalm()) return;
  var targets = view.querySelectorAll('.reveal-target, .figure-panel, .section');
  targets.forEach(function(el, i){
    el.classList.add('reveal');
    el.style.setProperty('--i', i);
  });
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      targets.forEach(function(el){ el.classList.add('is-in'); });
    });
  });
}

function switchView(viewId){
  applyView(viewId);
}

function applyView(viewId){
  state.view = viewId;
  var appEl = document.getElementById('app-container');
  if(appEl) appEl.setAttribute('data-view', viewId);

  document.querySelectorAll('.workstation-view').forEach(function(v){
    v.classList.add('hidden');
  });

  var targetView = document.getElementById(viewId);
  if(targetView){
    targetView.classList.remove('hidden');
    if(!prefersCalm()){
      targetView.classList.remove('is-entering');
      void targetView.offsetWidth;
      targetView.classList.add('is-entering');
    }
  }

  document.querySelectorAll('.nav-btn').forEach(function(btn){
    var on = btn.getAttribute('data-view') === viewId;
    btn.classList.toggle('active', on);
    if(on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  revealView(targetView);

  updateNavSlider();

  var job = null;
  if(viewId === 'spectral-view'){
    job = renderSpectrumChart;
  }else if(viewId === 'timing-view'){
    var tkey = [state.target.id, state.realization, state.timingSource, live.lc[state.target.id] ? live.stamp : '', document.documentElement.dataset.theme || ''].join('|');
    if(state.timingKey !== tkey){ state.timingKey = tkey; job = renderTimingCharts; }
  }else if(viewId === 'live-view'){
    job = function(){ renderLive(); renderFocusStatic(); liveTick(); pollPulse(); };
    if(!live.sources && !live.loading) loadLive();
  }else if(viewId === 'pipelines-view'){
    job = renderPipelinesContent;
  }
  if(job) requestAnimationFrame(function(){ setTimeout(job, 0); });

  playClickSound();
}

function updateNavSlider(){
  var activeBtn = document.querySelector('.nav-btn.active');
  var slider = document.getElementById('nav-slider-pill');
  if(activeBtn && slider){
    slider.style.width = activeBtn.offsetWidth + 'px';
    slider.style.left = activeBtn.offsetLeft + 'px';
  }
}

function hashString(s){
  var h = 2166136261;
  for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seededRng(t, kind){
  return mulberry32(hashString(t.id + ':' + kind + ':' + (state.realization || 0)));
}

function rngGauss(rng){
  return Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
}

function rngPoisson(rng, lam){
  if(lam > 40) return Math.max(0, Math.round(lam + Math.sqrt(lam) * rngGauss(rng)));
  var L = Math.exp(-lam), k = 0, p = 1;
  do { k++; p *= rng(); } while(p > L);
  return k - 1;
}

function fftInPlace(re, im){
  var n = re.length, i, j = 0, k, len, tr, ti;
  for(i = 1; i < n; i++){
    var bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){ tr = re[i]; re[i] = re[j]; re[j] = tr; ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for(len = 2; len <= n; len <<= 1){
    var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for(i = 0; i < n; i += len){
      var cr = 1, ci = 0;
      for(k = 0; k < len / 2; k++){
        var a = i + k, b = a + len / 2;
        tr = re[b] * cr - im[b] * ci;
        ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        var ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function erfc(x){
  var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function chi2Survival(x, k){
  var z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return 0.5 * erfc(z / Math.SQRT2);
}

function nelderMead(f, x0, steps, maxIter){
  var n = x0.length;
  var pts = [x0.slice()];
  for(var i = 0; i < n; i++){ var p = x0.slice(); p[i] += steps[i]; pts.push(p); }
  var vals = pts.map(f);
  var iter = 0;
  function combine(a, b, s){ return a.map(function(v, k){ return v + s * (b[k] - v); }); }
  for(; iter < maxIter; iter++){
    var order = vals.map(function(v, k){ return k; }).sort(function(a, b){ return vals[a] - vals[b]; });
    pts = order.map(function(k){ return pts[k]; });
    vals = order.map(function(k){ return vals[k]; });
    if(Math.abs(vals[n] - vals[0]) < 1e-6 * (Math.abs(vals[0]) + 1e-9)) break;
    var c = new Array(n).fill(0);
    for(var a = 0; a < n; a++) for(var d = 0; d < n; d++) c[d] += pts[a][d] / n;
    var xr = combine(c, pts[n], -1), fr = f(xr);
    if(fr < vals[0]){
      var xe = combine(c, pts[n], -2), fe = f(xe);
      if(fe < fr){ pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    }else if(fr < vals[n - 1]){
      pts[n] = xr; vals[n] = fr;
    }else{
      var xc = combine(c, pts[n], 0.5), fc = f(xc);
      if(fc < vals[n]){ pts[n] = xc; vals[n] = fc; }
      else{
        for(var s = 1; s <= n; s++){ pts[s] = combine(pts[0], pts[s], 0.5); vals[s] = f(pts[s]); }
      }
    }
  }
  var best = 0;
  for(var q = 1; q <= n; q++) if(vals[q] < vals[best]) best = q;
  return { x: pts[best], fx: vals[best], iter: iter };
}

function niceTicks(min, max, count){
  var span = max - min;
  var step = Math.pow(10, Math.floor(Math.log10(span / count)));
  var err = span / count / step;
  if(err >= 7.5) step *= 10; else if(err >= 3.5) step *= 5; else if(err >= 1.5) step *= 2;
  var out = [];
  for(var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function logTicks(min, max){
  var out = [];
  var span = Math.log10(max) - Math.log10(min);
  var mult = span <= 2.2 ? [1, 2, 5] : [1];
  for(var d = Math.floor(Math.log10(min)); d <= Math.ceil(Math.log10(max)); d++){
    mult.forEach(function(m){ var v = m * Math.pow(10, d); if(v >= min * 0.999 && v <= max * 1.001) out.push(v); });
  }
  return out;
}

function fmtTick(v, log){
  if(log){
    var e = Math.round(Math.log10(v));
    if(Math.abs(v - Math.pow(10, e)) < 1e-9 * v && (e < -2 || e > 3)) return '10<tspan dy="-4" font-size="7">' + e + '</tspan>';
  }
  var a = Math.abs(v);
  if(a === 0) return '0';
  if(a >= 1e5 || a < 0.01) return v.toExponential(0).replace('e+', 'e');
  return String(+v.toPrecision(3));
}

function svgChart(svgId, cfg){
  var svg = document.getElementById(svgId);
  if(!svg) return;
  var w = cfg.w, h = cfg.h, L = 58, R = 16, T = 14, B = 40;
  var pw = w - L - R, ph = h - T - B;
  function mx(v){ return cfg.x.log ? L + (Math.log10(v) - Math.log10(cfg.x.min)) / (Math.log10(cfg.x.max) - Math.log10(cfg.x.min)) * pw : L + (v - cfg.x.min) / (cfg.x.max - cfg.x.min) * pw; }
  function my(v){ return cfg.y.log ? T + ph - (Math.log10(v) - Math.log10(cfg.y.min)) / (Math.log10(cfg.y.max) - Math.log10(cfg.y.min)) * ph : T + ph - (v - cfg.y.min) / (cfg.y.max - cfg.y.min) * ph; }
  function okx(v){ return !cfg.x.log || v > 0; }
  function oky(v){ return !cfg.y.log || v > 0; }
  function cy(v){ return Math.max(T, Math.min(T + ph, my(v))); }
  var out = '';
  var xt = cfg.x.ticks || (cfg.x.log ? logTicks(cfg.x.min, cfg.x.max) : niceTicks(cfg.x.min, cfg.x.max, 6));
  var yt = cfg.y.ticks || (cfg.y.log ? logTicks(cfg.y.min, cfg.y.max) : niceTicks(cfg.y.min, cfg.y.max, 5));
  xt.forEach(function(v){
    var x = mx(v).toFixed(1);
    out += '<line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + ph) + '" stroke="var(--color-border)" stroke-width="0.75"/>';
    out += '<text x="' + x + '" y="' + (T + ph + 14) + '" font-size="9" fill="var(--color-muted)" text-anchor="middle">' + fmtTick(v, cfg.x.log) + '</text>';
  });
  yt.forEach(function(v){
    var y = my(v).toFixed(1);
    out += '<line x1="' + L + '" y1="' + y + '" x2="' + (L + pw) + '" y2="' + y + '" stroke="var(--color-border)" stroke-width="0.75"/>';
    out += '<text x="' + (L - 6) + '" y="' + (+y + 3) + '" font-size="9" fill="var(--color-muted)" text-anchor="end">' + fmtTick(v, cfg.y.log) + '</text>';
  });
  (cfg.layers || []).forEach(function(ly){
    if(ly.type === 'line'){
      var segs = [''];
      ly.pts.forEach(function(p){
        if(p === null){ if(segs[segs.length - 1]) segs.push(''); return; }
        if(okx(p[0]) && oky(p[1])) segs[segs.length - 1] += (segs[segs.length - 1] ? ' ' : '') + mx(p[0]).toFixed(1) + ',' + cy(p[1]).toFixed(1);
      });
      segs.forEach(function(d){
        if(d) out += '<polyline fill="none" stroke="' + (ly.color || 'var(--color-text)') + '" stroke-width="' + (ly.width || 1.5) + '"' + (ly.dash ? ' stroke-dasharray="' + ly.dash + '"' : '') + ' stroke-linejoin="round" points="' + d + '"/>';
      });
    }else if(ly.type === 'points'){
      ly.pts.forEach(function(p){
        if(!okx(p[0]) || !oky(p[1])) return;
        var x = mx(p[0]).toFixed(1), y = cy(p[1]);
        if(p[2] !== undefined){
          var lo = p[1] - p[2], hi = p[1] + p[2];
          out += '<line x1="' + x + '" y1="' + cy(oky(lo) ? lo : cfg.y.min).toFixed(1) + '" x2="' + x + '" y2="' + cy(hi).toFixed(1) + '" stroke="' + (ly.color || 'var(--color-secondary)') + '" stroke-width="0.8"/>';
        }
        out += '<circle cx="' + x + '" cy="' + y.toFixed(1) + '" r="' + (ly.r || 1.8) + '" fill="' + (ly.color || 'var(--color-secondary)') + '"/>';
      });
    }else if(ly.type === 'hline'){
      var hy = cy(ly.y).toFixed(1);
      out += '<line x1="' + L + '" y1="' + hy + '" x2="' + (L + pw) + '" y2="' + hy + '" stroke="' + (ly.color || 'var(--color-caution)') + '" stroke-width="1.1" stroke-dasharray="' + (ly.dash || '5,3') + '"/>';
      if(ly.label) out += '<text x="' + (L + pw - 4) + '" y="' + (hy - 4) + '" font-size="9" fill="' + (ly.color || 'var(--color-caution)') + '" text-anchor="end">' + ly.label + '</text>';
    }else if(ly.type === 'vline'){
      var vx = mx(ly.x).toFixed(1);
      out += '<line x1="' + vx + '" y1="' + T + '" x2="' + vx + '" y2="' + (T + ph) + '" stroke="' + (ly.color || 'var(--color-text)') + '" stroke-width="1" stroke-dasharray="' + (ly.dash || '2,3') + '"/>';
      if(ly.label) out += '<text x="' + (+vx + 5) + '" y="' + (T + 11) + '" font-size="9" fill="' + (ly.color || 'var(--color-text)') + '">' + ly.label + '</text>';
    }else if(ly.type === 'arrowpath'){
      ly.pts.forEach(function(p, k){
        if(k === 0) return;
        var q = ly.pts[k - 1];
        out += '<line x1="' + mx(q[0]).toFixed(1) + '" y1="' + cy(q[1]).toFixed(1) + '" x2="' + mx(p[0]).toFixed(1) + '" y2="' + cy(p[1]).toFixed(1) + '" stroke="' + (ly.color || 'var(--color-secondary)') + '" stroke-width="1.4"' + (k % 6 === 0 ? ' marker-end="url(#' + svgId + '-arrow)"' : '') + '/>';
      });
    }else if(ly.type === 'band'){
      var bx0 = mx(Math.max(cfg.x.min, ly.x0)), bx1 = mx(Math.min(cfg.x.max, ly.x1));
      if(bx1 > bx0) out += '<rect x="' + bx0.toFixed(1) + '" y="' + T + '" width="' + (bx1 - bx0).toFixed(1) + '" height="' + ph + '" fill="' + (ly.color || 'var(--color-surface)') + '"/>';
    }else if(ly.type === 'marker'){
      var px = mx(ly.x).toFixed(1), py = cy(ly.y).toFixed(1);
      out += '<circle cx="' + px + '" cy="' + py + '" r="4.5" fill="none" stroke="' + (ly.color || 'var(--color-text)') + '" stroke-width="1.5"/>';
      if(ly.label) out += '<text x="' + (+px + 8) + '" y="' + (+py - 6) + '" font-size="9" fill="' + (ly.color || 'var(--color-text)') + '">' + ly.label + '</text>';
    }
  });
  out += '<line x1="' + L + '" y1="' + (T + ph) + '" x2="' + (L + pw) + '" y2="' + (T + ph) + '" stroke="var(--color-text)" stroke-width="1.2"/>';
  out += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ph) + '" stroke="var(--color-text)" stroke-width="1.2"/>';
  out += '<text x="' + (L + pw / 2) + '" y="' + (h - 6) + '" font-size="10" fill="var(--color-secondary)" text-anchor="middle">' + cfg.x.label + '</text>';
  out += '<text x="14" y="' + (T + ph / 2) + '" font-size="10" fill="var(--color-secondary)" text-anchor="middle" transform="rotate(-90 14 ' + (T + ph / 2) + ')">' + cfg.y.label + '</text>';
  var defs = '<defs><marker id="' + svgId + '-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--color-secondary)"/></marker></defs>';
  svg.innerHTML = defs + out;
  if(cfg.empty){
    svg.innerHTML += '<text x="' + (L + pw / 2) + '" y="' + (T + ph / 2) + '" font-size="11" fill="var(--color-muted)" text-anchor="middle">' + cfg.empty + '</text>';
  }
}

var SPEC_EDGES = (function(){
  var e = [];
  for(var i = 0; i <= 64; i++) e.push(0.5 * Math.pow(120, i / 64));
  return e;
})();

function specHasCyc(t){
  return !!t.cyclotron_kev && (t.magnetic_field_gauss || 0) >= 1e11 && !/rotation-powered/i.test(t.type);
}

function specAeff(E){
  return 500 * (1 - Math.exp(-Math.pow(E / 1.2, 2))) * Math.exp(-Math.pow(E / 35, 1.6));
}

function specComponents(E, p, t){
  var nh = t.nh_column_10_22 || 0.3;
  var absn = Math.exp(-nh * 2.0 * Math.pow(E, -2.6));
  var cyc = 1;
  if(specHasCyc(t)){
    var ec = 0.89 * p.bfield, w = 0.15 * ec;
    cyc = 1 - 0.55 * Math.exp(-0.5 * Math.pow((E - ec) / w, 2));
  }
  var disk = 40 * p.mdot * Math.pow(E, -0.667) * Math.exp(-E / p.tin);
  var pl = Math.pow(E, -p.gamma);
  var line = 0;
  if(t.fe_centroid_kev){
    var ew = (t.fe_ew_ev || 150) / 1000, s = 0.25;
    var cfe = 40 * p.mdot * Math.pow(p.fe, -0.667) * Math.exp(-p.fe / p.tin) + Math.pow(p.fe, -p.gamma);
    line = ew * cfe * Math.exp(-0.5 * Math.pow((E - p.fe) / s, 2)) / (2.5066 * s);
  }
  var m = absn * cyc;
  return { disk: disk * m, pl: pl * m, line: line * m, total: (disk + pl + line) * m };
}

function truthParams(t){
  return {
    tin: t.tin_kev || 0.5,
    mdot: t.eddington_fraction || 0.05,
    gamma: t.photon_index || 1.8,
    fe: t.fe_centroid_kev || 6.4,
    bfield: t.magnetic_field_gauss ? t.magnetic_field_gauss / 1e11 : 32
  };
}

var specCache = null;

function getSpectralObservation(){
  var t = state.target;
  var key = t.id + ':' + (state.realization || 0);
  if(specCache && specCache.key === key) return specCache;
  var truth = truthParams(t);
  var bins = [], total = 0, i;
  for(i = 0; i < 64; i++){
    var lo = SPEC_EDGES[i], hi = SPEC_EDGES[i + 1], E = Math.sqrt(lo * hi), dE = hi - lo;
    var resp = dE * specAeff(E);
    var m = specComponents(E, truth, t).total * resp;
    bins.push({ E: E, dE: dE, resp: resp, m: m });
    total += m;
  }
  var exposure = 4e5 / total;
  var rng = seededRng(t, 'spec');
  bins.forEach(function(b){
    b.resp *= exposure;
    b.c = rngPoisson(rng, b.m * exposure);
    b.var = Math.max(b.c, 1);
  });
  specCache = { key: key, bins: bins, exposure: exposure };
  return specCache;
}

function spectralChiSq(p){
  var obs = getSpectralObservation(), t = state.target, chi = 0, n = 0;
  obs.bins.forEach(function(b){
    if(b.c < 10) return;
    var m = specComponents(b.E, p, t).total * b.resp;
    chi += (b.c - m) * (b.c - m) / b.var;
    n++;
  });
  return { chi: chi, n: n };
}

function fitParamList(){
  var t = state.target;
  var list = [
    { key: 'tin', lo: 0.2, hi: 2.5, step: 0.1 },
    { key: 'mdot', lo: 0.005, hi: 1.0, step: 0.3, log: true },
    { key: 'gamma', lo: 0.5, hi: 3.0, step: 0.15 }
  ];
  if(t.fe_centroid_kev) list.push({ key: 'fe', lo: 6.4, hi: 6.97, step: 0.05 });
  if(specHasCyc(t)) list.push({ key: 'bfield', lo: 1, hi: 50, step: 3 });
  return list;
}

function runSpectralFit(){
  var list = fitParamList();
  var base = Object.assign({}, state.params);
  function toParams(x){
    var p = Object.assign({}, base);
    list.forEach(function(d, i){
      var v = d.log ? Math.pow(10, x[i]) : x[i];
      p[d.key] = Math.max(d.lo, Math.min(d.hi, v));
    });
    return p;
  }
  function f(x){
    var pen = 0;
    list.forEach(function(d, i){
      var v = d.log ? Math.pow(10, x[i]) : x[i];
      if(v < d.lo) pen += (d.lo - v) * 1e4;
      if(v > d.hi) pen += (v - d.hi) * 1e4;
    });
    return spectralChiSq(toParams(x)).chi + pen;
  }
  var x0 = list.map(function(d){ return d.log ? Math.log10(state.params[d.key]) : state.params[d.key]; });
  var res = nelderMead(f, x0, list.map(function(d){ return d.step; }), 800);
  res = nelderMead(f, res.x, list.map(function(d){ return d.step * 0.2; }), 400);
  var best = toParams(res.x);
  var errors = {};
  list.forEach(function(d, i){
    var hstep = d.step * 0.05;
    var xp = res.x.slice(), xm = res.x.slice();
    xp[i] += hstep; xm[i] -= hstep;
    var curv = (f(xp) - 2 * res.fx + f(xm)) / (hstep * hstep);
    var sx = curv > 0 ? Math.sqrt(2 / curv) : NaN;
    errors[d.key] = d.log ? best[d.key] * Math.LN10 * sx : sx;
  });
  Object.keys(best).forEach(function(k){ state.params[k] = best[k]; });
  state.fitErrors = errors;
  state.fitLog = 'Nelder-Mead converged in ' + res.iter + ' iterations over ' + list.length + ' free parameters.';
}

function updateFitStatistic(){
  var r = spectralChiSq(state.params);
  var dof = Math.max(1, r.n - fitParamList().length);
  var red = r.chi / dof;
  var p = chi2Survival(r.chi, dof);
  var statChi = document.getElementById('stat-chisq');
  if(statChi) statChi.textContent = red.toFixed(3);
  var dofEl = document.getElementById('stat-dof');
  if(dofEl) dofEl.textContent = dof + ' degrees of freedom, p = ' + (p < 0.001 ? p.toExponential(1) : p.toFixed(3));
  var verdictEl = document.getElementById('fit-verdict');
  if(verdictEl){
    var ok = p >= 0.05;
    verdictEl.textContent = ok ? 'Acceptable fit' : 'Poor fit';
    verdictEl.className = 'verdict ' + (ok ? 'verdict--verified' : 'verdict--failed');
  }
  var logEl = document.getElementById('fit-log');
  if(logEl) logEl.textContent = state.fitLog || 'Parameters set by hand. Run the fit to minimise chi-square.';
}

function renderSpectrumChart(){
  refreshParamLabels();
  var t = state.target, obs = getSpectralObservation(), p = state.params;
  var dataPts = [], modelPts = [], diskPts = [], plPts = [], resPts = [];
  var ymin = Infinity, ymax = 0;
  obs.bins.forEach(function(b){
    var e2 = b.E * b.E;
    var comp = specComponents(b.E, p, t);
    modelPts.push([b.E, comp.total * e2]);
    diskPts.push([b.E, comp.disk * e2]);
    plPts.push([b.E, comp.pl * e2]);
    if(b.c > 0){
      var flux = b.c / b.resp * e2, err = Math.sqrt(b.c) / b.resp * e2;
      dataPts.push([b.E, flux, err]);
      ymin = Math.min(ymin, flux); ymax = Math.max(ymax, flux);
      if(b.c >= 10){
        var m = comp.total * b.resp;
        resPts.push([b.E, Math.max(-4.5, Math.min(4.5, (b.c - m) / Math.sqrt(b.var))), 1]);
      }
    }
  });
  var lo = Math.pow(10, Math.floor(Math.log10(ymin * 0.8)));
  var hi = Math.pow(10, Math.ceil(Math.log10(ymax * 1.5)));
  svgChart('spectrum-chart-svg', {
    w: 760, h: 340,
    x: { min: 0.5, max: 60, log: true, label: 'Energy (keV)', ticks: [0.5, 1, 2, 5, 10, 20, 50] },
    y: { min: lo, max: hi, log: true, label: 'E<tspan dy="-4" font-size="7">2</tspan><tspan dy="4"> F(E)  (keV</tspan><tspan dy="-4" font-size="7">2</tspan><tspan dy="4"> ph cm</tspan><tspan dy="-4" font-size="7">-2</tspan><tspan dy="4"> s</tspan><tspan dy="-4" font-size="7">-1</tspan><tspan dy="4"> keV</tspan><tspan dy="-4" font-size="7">-1</tspan><tspan dy="4">)</tspan>' },
    layers: [
      { type: 'line', pts: diskPts, color: 'var(--color-secondary)', dash: '5,3', width: 1.3 },
      { type: 'line', pts: plPts, color: 'var(--color-muted)', dash: '5,3', width: 1.3 },
      { type: 'points', pts: dataPts, color: 'var(--color-secondary)', r: 1.7 },
      { type: 'line', pts: modelPts, color: 'var(--color-text)', width: 1.8 }
    ]
  });
  var resSvg = document.getElementById('residuals-chart-svg');
  if(resSvg){
    var w = 760, h = 90, L = 58, R = 16, T = 8, B = 16, pw = w - L - R, ph = h - T - B;
    var lx = function(E){ return L + (Math.log10(E) - Math.log10(0.5)) / (Math.log10(60) - Math.log10(0.5)) * pw; };
    var ly = function(v){ return T + ph / 2 - v / 4.5 * (ph / 2); };
    var out = '';
    [-3, 0, 3].forEach(function(v){
      out += '<line x1="' + L + '" y1="' + ly(v) + '" x2="' + (L + pw) + '" y2="' + ly(v) + '" stroke="' + (v === 0 ? 'var(--color-text)' : 'var(--color-border)') + '" stroke-width="' + (v === 0 ? 1 : 0.75) + '"/>';
      out += '<text x="' + (L - 6) + '" y="' + (ly(v) + 3) + '" font-size="9" fill="var(--color-muted)" text-anchor="end">' + (v > 0 ? '+' : '') + v + '</text>';
    });
    resPts.forEach(function(r){
      var x = lx(r[0]).toFixed(1);
      out += '<line x1="' + x + '" y1="' + ly(r[1] - 1).toFixed(1) + '" x2="' + x + '" y2="' + ly(r[1] + 1).toFixed(1) + '" stroke="var(--color-secondary)" stroke-width="0.8"/>';
      out += '<circle cx="' + x + '" cy="' + ly(r[1]).toFixed(1) + '" r="1.7" fill="var(--color-secondary)"/>';
    });
    out += '<text x="14" y="' + (T + ph / 2) + '" font-size="10" fill="var(--color-secondary)" text-anchor="middle" transform="rotate(-90 14 ' + (T + ph / 2) + ')">&#967;</text>';
    resSvg.innerHTML = out;
  }
  updateFitStatistic();
}

function timingInjection(t){
  var B = t.magnetic_field_gauss || 0;
  var qpo = { grs: 3.51, maxi: 0.5, sco: 6.0 }[t.id] || null;
  var isBH = t.category === 'black_hole';
  return {
    porb: t.orbital_period_days || null,
    spin: t.spin_period_s && B >= 1e11 ? t.spin_period_s : null,
    qpo: qpo,
    breakHz: isBH ? 0.3 : 0.05,
    rms: qpo ? 0.2 : (isBH ? 0.22 : 0.07),
    pf: { crab: 0.9, her: 0.35, vela: 0.25, cen: 0.3 }[t.id] || 0.3,
    rate: { crab: 10000, sco: 10000 }[t.id] || 2000,
    eclipse: /eclips/i.test(t.type)
  };
}

function pulseShape(t, ph){
  if(/rotation-powered/i.test(t.type)){
    var d1 = ph - Math.round(ph), d2 = ph - 0.4 - Math.round(ph - 0.4);
    return Math.exp(-0.5 * d1 * d1 / 0.0004) + 0.6 * Math.exp(-0.5 * d2 * d2 / 0.0009) - 0.065;
  }
  return Math.sin(2 * Math.PI * ph) + 0.4 * Math.sin(4 * Math.PI * ph + 0.8);
}

function makeXrayLightCurve(t, inj, rng){
  var fTarget = inj.spin ? 1 / inj.spin : (inj.qpo || 2);
  var dt = Math.pow(2, -Math.ceil(Math.log2((inj.spin ? 32 : 8) * fTarget)));
  dt = Math.max(1 / 1024, Math.min(64, dt));
  var segLen = 2048, nSeg = 16, N = segLen * nSeg;
  var re = new Float64Array(N), im = new Float64Array(N);
  var df = 1 / (N * dt);
  var fb = Math.min(inj.breakHz, 0.25 / dt);
  var aq = 1.5 * fb * Math.PI / 2, wq = inj.qpo ? inj.qpo / 8 : 1;
  for(var j = 1; j <= N / 2; j++){
    var f = j * df;
    var P = 1 / (1 + Math.pow(f / fb, 2));
    if(inj.qpo) P += aq * (wq / (2 * Math.PI)) / (Math.pow(f - inj.qpo, 2) + Math.pow(wq / 2, 2));
    var amp = Math.sqrt(P / 2);
    re[j] = amp * rngGauss(rng);
    im[j] = j === N / 2 ? 0 : amp * rngGauss(rng);
    if(j < N / 2){ re[N - j] = re[j]; im[N - j] = -im[j]; }
  }
  for(var k = 0; k < N; k++) im[k] = -im[k];
  fftInPlace(re, im);
  var mean = 0, sq = 0;
  for(k = 0; k < N; k++) mean += re[k];
  mean /= N;
  for(k = 0; k < N; k++){ re[k] -= mean; sq += re[k] * re[k]; }
  var scale = inj.rms / Math.sqrt(sq / N);
  var rate = inj.rate;
  var counts = new Float64Array(N);
  for(k = 0; k < N; k++){
    var pulse = inj.spin ? 1 + inj.pf * 0.5 * pulseShape(t, (k * dt) / inj.spin) : 1;
    counts[k] = rngPoisson(rng, rate * dt * Math.max(0, 1 + re[k] * scale) * Math.max(0, pulse));
  }
  return { dt: dt, counts: counts, segLen: segLen, nSeg: nSeg };
}

function averagedLeahy(lc){
  var m = lc.segLen, half = m / 2;
  var P = new Float64Array(half);
  var re = new Float64Array(m), im = new Float64Array(m);
  for(var s = 0; s < lc.nSeg; s++){
    var nph = 0;
    for(var k = 0; k < m; k++){ re[k] = lc.counts[s * m + k]; im[k] = 0; nph += re[k]; }
    fftInPlace(re, im);
    for(var j = 1; j <= half; j++) P[j - 1] += 2 * (re[j] * re[j] + im[j] * im[j]) / Math.max(nph, 1);
  }
  var df = 1 / (m * lc.dt);
  var freq = new Float64Array(half);
  for(var q = 0; q < half; q++){ P[q] /= lc.nSeg; freq[q] = (q + 1) * df; }
  return { freq: freq, power: P, nSeg: lc.nSeg, df: df };
}

function detectPeaks(pds){
  var found = [];
  function med(a){ a.sort(function(x, y){ return x - y; }); return a[Math.floor(a.length / 2)]; }
  [1, 4, 16].forEach(function(W){
    var n = Math.floor(pds.power.length / W), P = new Float64Array(n), F = new Float64Array(n);
    for(var i = 0; i < n; i++){
      var s = 0, f = 0;
      for(var k = 0; k < W; k++){ s += pds.power[i * W + k]; f += pds.freq[i * W + k]; }
      P[i] = s / W; F[i] = f / W;
    }
    for(i = 12; i < n - 12; i++){
      var left = [], right = [];
      for(var k2 = 4; k2 <= 24; k2++){ left.push(P[i - k2]); right.push(P[i + k2]); }
      var sm = (P[i - 1] + P[i] + P[i + 1]) / 3;
      var cont = Math.sqrt(med(left) * med(right)) * 1.03;
      var sig = (sm - cont) / (cont / Math.sqrt(3 * W * pds.nSeg));
      if(sig > 6 && P[i] >= P[i - 1] && P[i] >= P[i + 1]){
        found.push({ i: Math.min(pds.power.length - 1, i * W + Math.floor(W / 2)), f: F[i], sigma: sig, W: W });
      }
    }
  });
  found.sort(function(a, b){ return b.sigma - a.sigma; });
  var peaks = [];
  found.forEach(function(pk){
    var near = peaks.some(function(q){ return Math.abs(q.f - pk.f) < 2 * Math.max(q.W, pk.W) * pds.df; });
    if(!near) peaks.push(pk);
  });
  return peaks;
}

function powerNear(pds, f){
  var j = Math.round(f / pds.df) - 1;
  if(j < 1 || j >= pds.power.length - 1) return null;
  return Math.max(pds.power[j - 1], pds.power[j], pds.power[j + 1]);
}

function excessSigma(pds, f){
  var j = Math.round(f / pds.df) - 1, n = pds.power.length;
  if(j < 12 || j >= n - 12) return 0;
  var w = [];
  for(var k = 4; k <= 24; k++){ w.push(pds.power[j - k]); w.push(pds.power[j + k]); }
  w.sort(function(x, y){ return x - y; });
  var cont = w[Math.floor(w.length / 2)];
  return (powerNear(pds, f) - cont) / (cont / Math.sqrt(pds.nSeg));
}

function fundamentalOf(peaks, pds){
  if(!peaks.length) return null;
  var best = null, bestScore = -Infinity;
  peaks.forEach(function(pk){
    [1, 2, 3].forEach(function(div){
      var f0 = pk.f / div;
      if(div > 1 && excessSigma(pds, f0) < 3) return;
      var score = 0;
      for(var n = 1; n <= 8; n++){
        var pw = powerNear(pds, n * f0);
        if(pw !== null) score += pw - 2;
      }
      if(score > bestScore){
        bestScore = score;
        var match = peaks.filter(function(q){ return Math.abs(q.f - f0) < 2.5 * q.W * pds.df; })[0];
        best = match || { f: f0, sigma: excessSigma(pds, f0), i: Math.round(f0 / pds.df) - 1, W: 1 };
      }
    });
  });
  return best;
}

function refineFrequency(lc, f0, step){
  var best = f0, bestChi = -1, nb = 32, n = lc.counts.length, tot = 0, i;
  for(i = 0; i < n; i++) tot += lc.counts[i];
  var mean = tot / n;
  for(var k = -40; k <= 40; k++){
    var f = f0 + k * step / 20;
    var sum = new Float64Array(nb), cnt = new Float64Array(nb);
    for(i = 0; i < n; i++){
      var ph = i * lc.dt * f; ph -= Math.floor(ph);
      var b = Math.min(nb - 1, (ph * nb) | 0);
      sum[b] += lc.counts[i]; cnt[b]++;
    }
    var chi = 0;
    for(var q = 0; q < nb; q++){ if(cnt[q]){ var e = mean * cnt[q]; chi += (sum[q] - e) * (sum[q] - e) / e; } }
    if(chi > bestChi){ bestChi = chi; best = f; }
  }
  return { f: best, chi: bestChi };
}

function makeMonitoringLightCurve(t, inj, rng){
  var P = inj.porb;
  var Tb = P ? Math.max(1.5, Math.min(400, 25 * P)) : 60;
  var gaps = [0, 1, 2].map(function(){ return rng() * Tb; });
  var times = [];
  while(times.length < 520){
    var x = rng() * Tb;
    var inGap = gaps.some(function(g){ return x > g && x < g + 0.08 * Tb; });
    if(!inGap) times.push(x);
  }
  times.sort(function(a, b){ return a - b; });
  var tau = 0.04 * Tb, sdrw = 0.06, phi0 = rng() * 6.283;
  var y = [], e = [], xr = sdrw * rngGauss(rng);
  for(var i = 0; i < times.length; i++){
    if(i > 0){
      var a = Math.exp(-(times[i] - times[i - 1]) / tau);
      xr = xr * a + sdrw * Math.sqrt(1 - a * a) * rngGauss(rng);
    }
    var sig = 0, mult = 1;
    if(P){
      var ph = times[i] / P;
      sig = 0.12 * Math.sin(2 * Math.PI * ph + phi0) + 0.04 * Math.cos(4 * Math.PI * ph + phi0);
      if(inj.eclipse){
        var ep = ph + phi0 / 6.283 - 0.75;
        ep -= Math.round(ep);
        if(Math.abs(ep) < 0.07) mult = 0.18;
      }
    }
    y.push((1 + sig + xr) * mult + 0.02 * rngGauss(rng));
    e.push(0.02);
  }
  return { t: times, y: y, e: e, Tb: Tb, tau: tau };
}

function lombScargle(tt, yy, fmin, fmax, nf){
  var n = tt.length, mean = 0, v = 0, i;
  for(i = 0; i < n; i++) mean += yy[i];
  mean /= n;
  for(i = 0; i < n; i++) v += (yy[i] - mean) * (yy[i] - mean);
  v /= (n - 1);
  var freq = new Float64Array(nf), pow = new Float64Array(nf);
  for(var k = 0; k < nf; k++){
    var f = fmin + (fmax - fmin) * k / (nf - 1), w = 2 * Math.PI * f;
    var s2 = 0, c2 = 0;
    for(i = 0; i < n; i++){ s2 += Math.sin(2 * w * tt[i]); c2 += Math.cos(2 * w * tt[i]); }
    var tau = Math.atan2(s2, c2) / (2 * w);
    var yc = 0, ys = 0, cc = 0, ss = 0;
    for(i = 0; i < n; i++){
      var arg = w * (tt[i] - tau), c = Math.cos(arg), s = Math.sin(arg), d = yy[i] - mean;
      yc += d * c; ys += d * s; cc += c * c; ss += s * s;
    }
    freq[k] = f;
    pow[k] = (yc * yc / cc + ys * ys / ss) / (2 * v);
  }
  return { freq: freq, power: pow };
}

function drwLogLike(tt, yy, ee, tau, s2, jit){
  var xhat = 0, om = s2, ll = 0;
  for(var i = 0; i < tt.length; i++){
    var V = om + ee[i] * ee[i] + jit * jit, r = yy[i] - xhat;
    ll += -0.5 * (Math.log(2 * Math.PI * V) + r * r / V);
    if(i < tt.length - 1){
      var a = Math.exp(-(tt[i + 1] - tt[i]) / tau), K = om / V;
      xhat = a * (xhat + K * r);
      om = s2 * (1 - a * a) + a * a * om * (1 - K);
    }
  }
  return ll;
}

function fitDrw(tt, yy, ee, Tb, scale){
  scale = scale || 1;
  var mean = yy.reduce(function(s, v){ return s + v; }, 0) / yy.length;
  var y0 = yy.map(function(v){ return v - mean; });
  var best = { ll: -Infinity, tau: NaN, s: NaN, jit: 0 };
  [0, 0.01, 0.02, 0.04, 0.08].forEach(function(j0){
    var jit = j0 * scale;
    for(var i = 0; i < 48; i++){
      var tau = Tb / 500 * Math.pow(1000, i / 47);
      for(var j = 0; j < 32; j++){
        var s = scale * 0.005 * Math.pow(60, j / 31);
        var ll = drwLogLike(tt, y0, ee, tau, s * s, jit);
        if(ll > best.ll) best = { ll: ll, tau: tau, s: s, jit: jit };
      }
    }
  });
  return best;
}

function foldSeries(tt, vals, period, nb){
  var sum = new Float64Array(nb), sq = new Float64Array(nb), cnt = new Float64Array(nb);
  for(var i = 0; i < tt.length; i++){
    var ph = tt[i] / period; ph -= Math.floor(ph);
    var b = Math.min(nb - 1, Math.floor(ph * nb));
    sum[b] += vals[i]; sq[b] += vals[i] * vals[i]; cnt[b]++;
  }
  var out = [];
  for(var k = 0; k < nb; k++){
    var m = cnt[k] ? sum[k] / cnt[k] : NaN;
    var sd = cnt[k] > 1 ? Math.sqrt(Math.max(0, sq[k] / cnt[k] - m * m) / cnt[k]) : 0;
    out.push([(k + 0.5) / nb, m, sd]);
  }
  return out;
}

function hidCounts(p, t, lo, hi){
  var s = 0, n = 40;
  for(var i = 0; i < n; i++){
    var a = lo * Math.pow(hi / lo, i / n), b = lo * Math.pow(hi / lo, (i + 1) / n), E = Math.sqrt(a * b);
    s += specComponents(E, p, t).total * specAeff(E) * (b - a);
  }
  return s;
}

function hidPoint(p, t){
  var scale = Math.max(p.mdot, 0.003) / 0.1;
  var soft = hidCounts(p, t, 2, 6), hard = hidCounts(p, t, 6, 20);
  return [(soft + hard) * scale, hard / soft];
}

var timingCache = null;

function computeTiming(){
  var t = state.target;
  var key = t.id + ':' + (state.realization || 0);
  if(timingCache && timingCache.key === key) return timingCache;
  var inj = timingInjection(t);
  var rngX = seededRng(t, 'xray'), rngM = seededRng(t, 'monitor');
  var lc = makeXrayLightCurve(t, inj, rngX);
  var pds = averagedLeahy(lc);
  var peaks = detectPeaks(pds);
  var fund = fundamentalOf(peaks, pds);
  if(fund && inj.spin){
    var ref = refineFrequency(lc, fund.f, pds.df * (fund.W || 1));
    fund = Object.assign({}, fund, { f: ref.f, refined: true, efChi: ref.chi });
  }
  var mon = makeMonitoringLightCurve(t, inj, rngM);
  var fmin = 5 / mon.Tb, fmax = mon.t.length / (2 * mon.Tb);
  var nf = Math.round((fmax - fmin) * mon.Tb * 5);
  var ls = lombScargle(mon.t, mon.y, fmin, fmax, nf);
  var bi = 0;
  for(var i = 1; i < ls.power.length; i++) if(ls.power[i] > ls.power[bi]) bi = i;
  var M = (fmax - fmin) * mon.Tb;
  var zThr = -Math.log(1 - Math.pow(1 - 0.001, 1 / M));
  var zPk = ls.power[bi];
  var fap = 1 - Math.pow(1 - Math.exp(-zPk), M);
  var lsSig = zPk > zThr;
  var pLs = 1 / ls.freq[bi];
  var resid = mon.y;
  if(lsSig && inj.porb){
    var prof = foldSeries(mon.t, mon.y, pLs, 32);
    resid = mon.y.map(function(v, k){
      var ph = mon.t[k] / pLs; ph -= Math.floor(ph);
      return v - prof[Math.min(31, Math.floor(ph * 32))][1];
    });
  }
  var drw = fitDrw(mon.t, resid, mon.e, mon.Tb);
  var foldX = null, foldPeriod = null;
  if(inj.spin){
    foldPeriod = fund ? 1 / fund.f : inj.spin;
    var tx = [], vx = [];
    for(var k = 0; k < lc.counts.length; k++){ tx.push(k * lc.dt); vx.push(lc.counts[k] / lc.dt); }
    foldX = foldSeries(tx, vx, foldPeriod, 32);
  }
  timingCache = {
    key: key, inj: inj, lc: lc, pds: pds, peaks: peaks, fund: fund,
    mon: mon, ls: ls, lsBest: bi, lsPeriod: pLs, lsSig: lsSig, fap: fap, zThr: zThr,
    drw: drw, foldX: foldX, foldPeriod: foldPeriod
  };
  return timingCache;
}

function fmtPeriod(days){
  if(days >= 1) return days.toFixed(3) + ' d';
  if(days * 24 >= 1) return (days * 24).toFixed(3) + ' h';
  return (days * 86400).toFixed(1) + ' s';
}

function fmtSeconds(s){
  if(s >= 10) return s.toFixed(3) + ' s';
  if(s >= 0.1) return s.toFixed(5) + ' s';
  return (s * 1000).toFixed(4) + ' ms';
}

function setResultCell(id, value, note, pass, markText){
  var v = document.getElementById(id + '-value');
  var n = document.getElementById(id + '-note');
  var m = document.getElementById(id + '-mark');
  if(v) v.textContent = value;
  if(n) n.textContent = note;
  if(m){
    m.textContent = markText || (pass === null ? 'No injection' : (pass ? 'Recovered' : 'Not recovered'));
    m.className = 'marker ' + (pass === null ? 'marker--neutral' : (pass ? 'marker--pass' : 'marker--fail'));
  }
}

function renderTimingCharts(){
  if(state.view !== 'timing-view') return;
  renderTimingSourceUi();
  if(state.timingSource === 'live'){
    renderLiveTiming();
    renderHid(state.target);
    return;
  }
  var T = computeTiming(), t = state.target, inj = T.inj;

  var badge = document.getElementById('timing-resolution-badge');
  if(badge) badge.textContent = fmtSeconds(T.lc.dt) + ' bins, ' + T.mon.t.length + ' monitoring epochs';

  var orbPass = inj.porb ? (T.lsSig && Math.abs(1 / T.lsPeriod - 1 / inj.porb) < 1 / T.mon.Tb) : null;
  var fapTxt = 'False-alarm probability ' + (T.fap < 1e-6 ? '< 1e-6' : T.fap.toFixed(4)) + '. Pass if within one frequency resolution element.';
  if(inj.porb){
    setResultCell('res-orb', T.lsSig ? fmtPeriod(T.lsPeriod) : 'No significant period', 'Injected ' + fmtPeriod(inj.porb) + '. ' + fapTxt, orbPass);
  }else{
    setResultCell('res-orb', 'No orbit', 'Isolated source. ' + (T.lsSig ? 'The strongest peak, ' + fmtPeriod(T.lsPeriod) + ', is red noise: the false-alarm level assumes white noise.' : 'No peak passes the 0.1% false-alarm level.'), null);
  }

  var fInj = inj.spin ? 1 / inj.spin : inj.qpo;
  var fourierPass = null, fourierVal = 'No signal above 6 sigma', fourierNote = '';
  if(T.fund){
    fourierVal = T.fund.f.toFixed(T.fund.f < 0.1 ? 6 : 4) + ' Hz';
    fourierNote = (T.fund.sigma > 100 ? 'More than 100' : T.fund.sigma.toFixed(1)) + ' sigma over the local continuum' + (T.fund.refined ? ', refined by epoch folding' : ', resolution ' + (T.pds.df * T.fund.W).toPrecision(2) + ' Hz') + '. ';
  }
  if(fInj){
    var tol = inj.spin ? T.pds.df : Math.max(0.05 * fInj, 2.5 * T.pds.df * (T.fund ? T.fund.W : 1));
    fourierPass = !!T.fund && Math.abs(T.fund.f - fInj) < tol;
    fourierNote += 'Injected ' + (inj.spin ? 'spin ' : 'QPO ') + fInj.toFixed(fInj < 0.1 ? 5 : 3) + ' Hz.';
  }else{
    fourierNote += 'No coherent signal injected.';
    if(T.fund) fourierPass = false;
  }
  setResultCell('res-fourier', fourierVal, fourierNote, fourierPass);

  var drwPass = T.drw.tau / T.mon.tau < 2 && T.mon.tau / T.drw.tau < 2;
  setResultCell('res-drw', fmtPeriod(T.drw.tau), 'Injected ' + fmtPeriod(T.mon.tau) + '. Pass if within a factor of two.', drwPass);

  var headline = document.getElementById('timing-headline-value');
  var headMeta = document.getElementById('timing-headline-meta');
  var verdict = document.getElementById('timing-verdict');
  var primaryPass, primaryVal, primaryMeta;
  if(inj.spin){
    primaryPass = fourierPass;
    primaryVal = T.fund ? fmtSeconds(1 / T.fund.f) : '--';
    primaryMeta = 'spin period from the power spectrum, refined by epoch folding; injected ' + fmtSeconds(inj.spin);
  }else if(inj.porb){
    primaryPass = orbPass;
    primaryVal = T.lsSig ? fmtPeriod(T.lsPeriod) : '--';
    primaryMeta = 'orbital period from the Lomb-Scargle periodogram, injected ' + fmtPeriod(inj.porb);
  }else{
    primaryPass = null;
    primaryVal = '--';
    primaryMeta = 'no periodic signal injected';
  }
  if(headline) headline.textContent = primaryVal;
  if(headMeta) headMeta.textContent = primaryMeta;
  if(verdict){
    verdict.textContent = primaryPass === null ? 'Nothing to recover' : (primaryPass ? 'Period recovered' : 'Period not recovered');
    verdict.className = 'verdict ' + (primaryPass === null ? '' : (primaryPass ? 'verdict--verified' : 'verdict--failed'));
  }

  var mon = T.mon;
  var lcPts = mon.t.map(function(x, k){ return [x, mon.y[k], mon.e[k]]; });
  var ylo = Math.min.apply(null, mon.y), yhi = Math.max.apply(null, mon.y);
  svgChart('lc-chart-svg', {
    w: 1080, h: 220,
    x: { min: 0, max: mon.Tb, label: 'Time (days)' },
    y: { min: ylo - 0.05, max: yhi + 0.05, label: 'Relative flux' },
    layers: [{ type: 'points', pts: lcPts, color: 'var(--color-secondary)', r: 1.4 }]
  });

  var lsPts = [];
  for(var i = 0; i < T.ls.freq.length; i++) lsPts.push([1 / T.ls.freq[i], T.ls.power[i]]);
  var lsMax = Math.max(T.ls.power[T.lsBest], T.zThr) * 1.15;
  var lsLayers = [
    { type: 'line', pts: lsPts, width: 1.1 },
    { type: 'hline', y: T.zThr, label: 'FAP 0.1%' }
  ];
  if(T.lsSig) lsLayers.push({ type: 'marker', x: T.lsPeriod, y: T.ls.power[T.lsBest], label: fmtPeriod(T.lsPeriod) });
  if(inj.porb) lsLayers.push({ type: 'vline', x: inj.porb, label: 'injected', color: 'var(--color-muted)' });
  svgChart('lomb-chart-svg', {
    w: 540, h: 260,
    x: { min: 1 / T.ls.freq[T.ls.freq.length - 1], max: 1 / T.ls.freq[0], log: true, label: 'Period (days)' },
    y: { min: 0, max: lsMax, label: 'Normalised power' },
    layers: lsLayers
  });

  var pds = T.pds, binned = [], f0 = pds.freq[0], acc = 0, cnt = 0, edge = f0 * 1.06;
  for(i = 0; i < pds.freq.length; i++){
    acc += pds.power[i]; cnt++;
    if(pds.freq[i] >= edge || i === pds.freq.length - 1){
      binned.push([Math.sqrt(f0 * pds.freq[i]), acc / cnt, 2 / Math.sqrt(cnt * pds.nSeg)]);
      f0 = pds.freq[i + 1] || pds.freq[i]; edge = f0 * 1.06; acc = 0; cnt = 0;
    }
  }
  var pmax = 0;
  binned.forEach(function(b){ pmax = Math.max(pmax, b[1]); });
  T.peaks.forEach(function(pk){ pmax = Math.max(pmax, pds.power[pk.i]); });
  var pdsLayers = [
    { type: 'hline', y: 2, label: 'Poisson level', color: 'var(--color-muted)' },
    { type: 'points', pts: binned, color: 'var(--color-secondary)', r: 1.5 }
  ];
  if(T.fund) pdsLayers.push({ type: 'marker', x: T.fund.f, y: Math.max(pds.power[T.fund.i], 1), label: T.fund.f.toFixed(3) + ' Hz' });
  svgChart('pds-chart-svg', {
    w: 540, h: 260,
    x: { min: pds.freq[0], max: pds.freq[pds.freq.length - 1], log: true, label: 'Frequency (Hz)' },
    y: { min: 1, max: Math.max(10, pmax * 1.6), log: true, label: 'Leahy power' },
    layers: pdsLayers
  });

  var fold, foldLabel, foldTitle;
  if(T.foldX){
    fold = T.foldX;
    foldLabel = 'Count rate (counts/s)';
    foldTitle = 'Spin phase';
  }else if(T.lsSig && inj.porb){
    fold = foldSeries(mon.t, mon.y, T.lsPeriod, 24);
    foldLabel = 'Relative flux';
    foldTitle = 'Orbital phase';
  }
  var foldEl = document.getElementById('folded-caption');
  if(fold){
    var two = fold.concat(fold.map(function(p){ return [p[0] + 1, p[1], p[2]]; })).filter(function(p){ return !isNaN(p[1]); });
    var fmin = Infinity, fmaxv = -Infinity;
    two.forEach(function(p){ fmin = Math.min(fmin, p[1] - p[2]); fmaxv = Math.max(fmaxv, p[1] + p[2]); });
    var pad = (fmaxv - fmin) * 0.12 || 0.1;
    svgChart('folded-chart-svg', {
      w: 540, h: 260,
      x: { min: 0, max: 2, label: foldTitle, ticks: [0, 0.5, 1, 1.5, 2] },
      y: { min: fmin - pad, max: fmaxv + pad, label: foldLabel },
      layers: [
        { type: 'line', pts: two.map(function(p){ return [p[0], p[1]]; }), color: 'var(--color-muted)', width: 1 },
        { type: 'points', pts: two, color: 'var(--color-text)', r: 1.8 }
      ]
    });
    if(foldEl) foldEl.innerHTML = '<strong>Figure 8.</strong> Light curve folded on the recovered ' + (T.foldX ? 'spin period of ' + fmtSeconds(T.foldPeriod) : 'orbital period of ' + fmtPeriod(T.lsPeriod)) + ', shown over two cycles with standard errors.';
  }else{
    svgChart('folded-chart-svg', { w: 540, h: 260, x: { min: 0, max: 2, label: 'Phase', ticks: [0, 0.5, 1, 1.5, 2] }, y: { min: 0, max: 1, label: 'Relative flux' }, layers: [], empty: 'No significant period to fold on' });
    if(foldEl) foldEl.innerHTML = '<strong>Figure 8.</strong> Nothing to fold: no period passed the 0.1% false-alarm level.';
  }

  renderHid(t);
}

function renderHid(t){
  var i, track = [], pathParams = [];
  if(t.category === 'black_hole'){
    var n = 48;
    for(i = 0; i <= n; i++){
      var s = i / n, p;
      if(s < 0.35){ var u = s / 0.35; p = { mdot: 0.01 * Math.pow(30, u), gamma: 1.6, tin: 0.35 }; }
      else if(s < 0.5){ var u2 = (s - 0.35) / 0.15; p = { mdot: 0.3, gamma: 1.6 + 0.8 * u2, tin: 0.35 + 0.65 * u2 }; }
      else if(s < 0.85){ var u3 = (s - 0.5) / 0.35; p = { mdot: 0.3 * Math.pow(0.08, u3), gamma: 2.4, tin: 1.0 - 0.45 * u3 }; }
      else { var u4 = (s - 0.85) / 0.15; p = { mdot: 0.024, gamma: 2.4 - 0.75 * u4, tin: 0.55 - 0.2 * u4 }; }
      p.fe = state.params.fe; p.bfield = state.params.bfield;
      pathParams.push(p);
    }
  }else{
    for(i = 0; i <= 40; i++){
      var v = i / 40;
      pathParams.push({ mdot: 0.04 * Math.pow(25, v), gamma: 1.7 + 0.6 * v, tin: 0.6 + 0.8 * v, fe: state.params.fe, bfield: state.params.bfield });
    }
  }
  pathParams.forEach(function(p){ track.push(hidPoint(p, t)); });
  var now = hidPoint(state.params, t);
  var xs = track.map(function(p){ return p[0]; }).concat([now[0]]);
  var ys = track.map(function(p){ return p[1]; }).concat([now[1]]);
  svgChart('hid-chart-svg', {
    w: 540, h: 260,
    x: { min: Math.min.apply(null, xs) * 0.7, max: Math.max.apply(null, xs) * 1.4, log: true, label: 'Intensity, 2 to 20 keV (counts/s)' },
    y: { min: Math.min.apply(null, ys) * 0.8, max: Math.max.apply(null, ys) * 1.25, log: true, label: 'Hardness, 6-20 / 2-6 keV' },
    layers: [
      { type: 'arrowpath', pts: track },
      { type: 'marker', x: now[0], y: now[1], label: 'current fit' }
    ]
  });
}

var G_CGS = 6.674e-8, MSUN_G = 1.989e33, RSUN_CM = 6.957e10;

function binaryKinematics(t, incDeg){
  var M1 = t.mass_compact_msun, M2 = t.mass_companion_msun, P = t.orbital_period_days;
  if(!M2 || !P) return null;
  var Ps = P * 86400, Mt = (M1 + M2) * MSUN_G;
  var a = Math.cbrt(G_CGS * Mt * Ps * Ps / (4 * Math.PI * Math.PI));
  var si = Math.sin(incDeg * Math.PI / 180);
  var K1 = 2 * Math.PI * a * M2 / (M1 + M2) * si / Ps / 1e5;
  var K2 = 2 * Math.PI * a * M1 / (M1 + M2) * si / Ps / 1e5;
  var q = M1 / M2, q23 = Math.pow(q, 2 / 3);
  var rl1 = a * 0.49 * q23 / (0.6 * q23 + Math.log(1 + Math.cbrt(q)));
  var rout = 0.6 * rl1;
  var vout = Math.sqrt(G_CGS * M1 * MSUN_G / rout) * si / 1e5;
  var fM = Ps * Math.pow(K2 * 1e5, 3) / (2 * Math.PI * G_CGS) / MSUN_G;
  return { a: a, K1: K1, K2: K2, rout: rout, vout: vout, fM: fM, si: si };
}

function lineProfile(kin, phase, vgrid){
  var n = vgrid.length, disk = new Float64Array(n), donor = new Float64Array(n), spot = new Float64Array(n);
  var v1 = -kin.K1 * Math.sin(2 * Math.PI * phase);
  var v2 = 0.75 * kin.K2 * Math.sin(2 * Math.PI * phase);
  var vis = 0.5 * (1 - Math.cos(2 * Math.PI * (phase - 0.5)));
  var vhs = 0.9 * kin.vout * Math.sin(2 * Math.PI * (phase + 0.15)) + v1;
  var dv = vgrid[1] - vgrid[0];
  for(var ir = 0; ir < 60; ir++){
    var x = 0.15 + 0.85 * ir / 59;
    var vk = kin.vout / Math.sqrt(x);
    var wgt = Math.pow(x, -1.5) * x;
    for(var ia = 0; ia < 240; ia++){
      var v = vk * Math.sin(2 * Math.PI * (ia + 0.5) / 240) + v1;
      var j = Math.round((v - vgrid[0]) / dv);
      if(j >= 0 && j < n) disk[j] += wgt;
    }
  }
  var dmax = 0, sm = new Float64Array(n);
  for(var k = 0; k < n; k++){
    var s = 0, c = 0;
    for(var m = -5; m <= 5; m++){ if(k + m >= 0 && k + m < n){ var g = Math.exp(-m * m / 6); s += disk[k + m] * g; c += g; } }
    sm[k] = s / c; dmax = Math.max(dmax, sm[k]);
  }
  var total = new Float64Array(n);
  for(k = 0; k < n; k++){
    sm[k] = sm[k] / dmax;
    donor[k] = 0.45 * vis * Math.exp(-0.5 * Math.pow((vgrid[k] - v2) / 60, 2));
    spot[k] = 0.3 * Math.exp(-0.5 * Math.pow((vgrid[k] - vhs) / 90, 2));
    total[k] = sm[k] + donor[k] + spot[k];
  }
  return { disk: sm, donor: donor, spot: spot, total: total, v1: v1, v2: v2, vhs: vhs };
}

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(h){
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function renderOpticalLines(){
  var t = state.target;
  var inc = state.optical.inc, phase = state.optical.phase;
  var kin = binaryKinematics(t, inc);
  var helium = /helium/i.test((t.companion_type || '') + ' ' + (t.accretion_mode || ''));
  var lineName = helium ? 'He II 4686' : 'H&alpha; 6563';
  var nameEl = document.getElementById('optical-line-name');
  if(nameEl) nameEl.innerHTML = lineName;
  var incVal = document.getElementById('val-incl');
  if(incVal) incVal.textContent = inc.toFixed(0) + ' deg';
  var phVal = document.getElementById('val-phase');
  if(phVal) phVal.textContent = phase.toFixed(2);
  var body = document.getElementById('optical-body');
  var empty = document.getElementById('optical-empty');
  if(!kin){
    if(body) body.hidden = true;
    if(empty) empty.hidden = false;
    return;
  }
  if(body) body.hidden = false;
  if(empty) empty.hidden = true;

  var vmax = Math.max(2.6 * kin.vout, kin.K2 + 400, 600);
  vmax = Math.ceil(vmax / 250) * 250;
  var nv = 180, vgrid = [];
  for(var i = 0; i < nv; i++) vgrid.push(-vmax + 2 * vmax * i / (nv - 1));

  var canvas = document.getElementById('trailed-canvas');
  if(canvas){
    var rows = 120;
    canvas.width = nv; canvas.height = rows;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(nv, rows);
    var bg = hexToRgb(cssVar('--color-bg')), fg = hexToRgb(cssVar('--color-text'));
    var all = [], gmax = 0;
    for(var r = 0; r < rows; r++){
      var prof = lineProfile(kin, 2 * (rows - 1 - r) / (rows - 1), vgrid).total;
      all.push(prof);
      for(var c = 0; c < nv; c++) gmax = Math.max(gmax, prof[c]);
    }
    for(r = 0; r < rows; r++){
      for(c = 0; c < nv; c++){
        var u = Math.pow(all[r][c] / gmax, 0.8), o = (r * nv + c) * 4;
        img.data[o] = bg[0] + (fg[0] - bg[0]) * u;
        img.data[o + 1] = bg[1] + (fg[1] - bg[1]) * u;
        img.data[o + 2] = bg[2] + (fg[2] - bg[2]) * u;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var mk = document.getElementById('trailed-phase-marker');
    if(mk) mk.style.top = (100 * (1 - phase / 2)) + '%';
    var axis = document.getElementById('trailed-axis');
    if(axis) axis.innerHTML = '<span>&minus;' + vmax + '</span><span>0</span><span>+' + vmax + ' km/s</span>';
  }

  var prof2 = lineProfile(kin, phase, vgrid);
  function series(arr){ return vgrid.map(function(v, k){ return [v, 1 + arr[k]]; }); }
  svgChart('profile-chart-svg', {
    w: 540, h: 260,
    x: { min: -vmax, max: vmax, label: 'Velocity (km/s)' },
    y: { min: 0.9, max: 2.6, label: 'Flux relative to continuum' },
    layers: [
      { type: 'line', pts: series(prof2.disk), color: 'var(--color-secondary)', dash: '5,3', width: 1.2 },
      { type: 'line', pts: series(prof2.donor), color: 'var(--color-muted)', dash: '2,3', width: 1.2 },
      { type: 'line', pts: series(prof2.total), color: 'var(--color-text)', width: 1.8 },
      { type: 'vline', x: prof2.v2, label: 'donor', color: 'var(--color-muted)' }
    ]
  });

  function setText(id, html){ var el = document.getElementById(id); if(el) el.innerHTML = html; }
  setText('opt-k2', kin.K2.toFixed(0) + ' km/s');
  setText('opt-k1', kin.K1.toFixed(0) + ' km/s');
  setText('opt-a', (kin.a / RSUN_CM).toFixed(1) + ' R&#9737;');
  setText('opt-vout', kin.vout.toFixed(0) + ' km/s');
  setText('opt-fm', kin.fM.toFixed(2) + ' M&#9737;');
}

var live = { sources: null, alerts: null, error: null, loading: false, lc: {}, lcError: {}, fetchedAt: null };
var LIVE_HELP = 'Live data needs the AstroPulse server. In the project folder run python server.py, then open http://127.0.0.1:8000.';

function liveFetch(path){
  return fetch(path, { cache: 'no-store' }).then(function(r){
    return r.json().then(function(d){
      if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      return d;
    }, function(){ throw new Error(LIVE_HELP); });
  }, function(){ throw new Error(LIVE_HELP); });
}

function liveSummary(id){
  if(!live.sources) return null;
  return live.sources.filter(function(s){ return s.id === id; })[0] || null;
}

function loadLive(){
  if(live.loading) return;
  live.loading = true;
  renderLive();
  Promise.all([
    liveFetch('api/live/sources'),
    liveFetch('api/live/alerts').catch(function(e){ return { error: e.message, items: [] }; })
  ]).then(function(res){
    live.sources = res[0].sources;
    live.alerts = res[1];
    live.error = null;
    live.fetchedAt = new Date();
    liveTicker.lastPulse = Date.now();
    updateSimulationPhysics();
  }).catch(function(e){
    live.error = location.protocol === 'file:' ? LIVE_HELP : e.message;
  }).then(function(){
    live.loading = false;
    renderLive();
    renderLiveLine();
    if(state.timingSource === 'live') renderTimingCharts();
  });
}

function loadLiveCurve(id){
  if(live.lc[id] || live.lcError[id] === 'loading') return;
  live.lcError[id] = 'loading';
  liveFetch('api/live/lightcurve/' + id + '?days=1095').then(function(d){
    live.lc[id] = d;
    delete live.lcError[id];
  }).catch(function(e){
    live.lcError[id] = e.message;
  }).then(function(){
    if(state.timingSource === 'live' && state.target.id === id) renderTimingCharts();
  });
}

function sparkline(points, w, h, span){
  if(!points || points.length < 2) return '<span class="meta">No recent points</span>';
  w = w || 180; h = h || 30;
  var xs = points.map(function(p){ return p[0]; }), ys = points.map(function(p){ return p[1]; });
  var x1 = Math.max.apply(null, xs), x0 = span ? x1 - span : Math.min.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  if(y1 - y0 < 1e-9) y1 = y0 + 1;
  function X(v){ return ((v - x0) / (x1 - x0 || 1) * (w - 4) + 1).toFixed(1); }
  function Y(v){ return (h - 3 - (v - y0) / (y1 - y0) * (h - 6)).toFixed(1); }
  var runs = [[]];
  points.forEach(function(p, k){
    if(p[0] < x0) return;
    if(runs[runs.length - 1].length && p[0] - runs[runs.length - 1][runs[runs.length - 1].length - 1][0] > 20) runs.push([]);
    runs[runs.length - 1].push(p);
  });
  runs = runs.filter(function(r){ return r.length; });
  var out = '<line x1="1" y1="' + (h - 0.5) + '" x2="' + (w - 1) + '" y2="' + (h - 0.5) + '" stroke="var(--color-border)" stroke-width="1"/>';
  for(var i = 1; i < runs.length; i++){
    var a = runs[i - 1][runs[i - 1].length - 1], b = runs[i][0];
    out += '<line x1="' + X(a[0]) + '" y1="' + Y(a[1]) + '" x2="' + X(b[0]) + '" y2="' + Y(b[1]) + '" stroke="var(--color-muted)" stroke-width="1" stroke-dasharray="1,3" opacity="0.7"/>';
  }
  runs.forEach(function(r){
    if(r.length === 1) out += '<circle cx="' + X(r[0][0]) + '" cy="' + Y(r[0][1]) + '" r="1" fill="var(--color-secondary)"/>';
    else out += '<polyline fill="none" stroke="var(--color-secondary)" stroke-width="1.1" stroke-linejoin="round" points="' + r.map(function(p){ return X(p[0]) + ',' + Y(p[1]); }).join(' ') + '"/>';
  });
  var last = points[points.length - 1];
  out += '<circle cx="' + X(last[0]) + '" cy="' + Y(last[1]) + '" r="2" fill="var(--color-text)"/>';
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function fmtFlux(v, e){
  if(v === null || v === undefined) return '--';
  return v.toFixed(Math.abs(v) < 100 ? 1 : 0) + (e !== undefined ? ' &plusmn; ' + e.toFixed(e < 10 ? 1 : 0) : '');
}

function renderLive(){
  var status = document.getElementById('live-feed-status');
  var errEl = document.getElementById('live-error');
  var rowsEl = document.getElementById('live-rows');
  var updEl = document.getElementById('live-updated');
  var alertsEl = document.getElementById('live-alerts');
  if(!rowsEl) return;
  if(status) status.textContent = live.loading && !live.sources ? 'Fetching' : (live.error ? 'Offline' : (live.sources ? 'Connected' : 'Not loaded'));
  if(errEl){
    errEl.hidden = !live.error;
    errEl.textContent = live.error || '';
  }
  if(updEl) updEl.textContent = 'Altitudes from Paranal, updated every second';
  if(!live.sources){
    rowsEl.innerHTML = '<tr><td colspan="7" class="meta">' + (live.loading ? 'Fetching Swift/BAT light curves. The first request can take half a minute; later ones come from the cache.' : 'No live data loaded.') + '</td></tr>';
  }else{
    rowsEl.innerHTML = DATA.targets.map(function(t){
      var s = liveSummary(t.id) || { available: false, reason: 'No response for this source.' };
      var name = '<button class="live-source" data-id="' + t.id + '">' + escapeHtml(t.name) + '</button>';
      if(!s.available){
        return '<tr class="is-off"><th scope="row">' + name + '</th><td colspan="5" class="meta">' + escapeHtml(s.reason) + '</td><td class="num" data-alt="' + t.id + '"></td></tr>';
      }
      var cls = s.trend === 'Brightening' ? 'marker--caution' : (s.trend === 'Fading' ? 'marker--neutral' : 'marker--neutral');
      var z = s.z !== null && s.z !== undefined ? ' <span class="meta num">' + (s.z > 0 ? '+' : '') + s.z.toFixed(1) + ' sigma</span>' : '';
      return '<tr><th scope="row">' + name + '<span class="meta">' + s.latest_date + (s.stale ? ', cached' : '') + '</span></th>' +
        '<td>' + sparkline(s.spark, 180, 30, 365) + '</td>' +
        '<td class="num">' + fmtFlux(s.latest_mcrab, s.latest_err) + '</td>' +
        '<td class="num">' + fmtFlux(s.week_mcrab, s.week_err) + '</td>' +
        '<td class="num">' + fmtFlux(s.year_mcrab) + '</td>' +
        '<td><span class="marker ' + cls + '">' + s.trend + '</span>' + z + '</td>' +
        '<td class="num" data-alt="' + t.id + '"></td></tr>';
    }).join('');
  }
  if(alertsEl){
    var a = live.alerts;
    if(!a){
      alertsEl.innerHTML = '<li class="meta">' + (live.loading ? 'Fetching reports.' : 'No reports loaded.') + '</li>';
    }else if(a.error){
      alertsEl.innerHTML = '<li class="meta">Reports unavailable: ' + escapeHtml(a.error) + '</li>';
    }else{
      var names = {};
      DATA.targets.forEach(function(t){ names[t.id] = t.name; });
      var any = a.items.some(function(it){ return it.sources.length; });
      alertsEl.innerHTML = (any ? '' : '<li class="meta live-alerts__note">None of the latest ' + a.items.length + ' reports mention a catalogued source.</li>') + a.items.map(function(it){
        var when = it.date ? it.date.replace('T', ' ').slice(0, 16) + ' UTC' : '';
        var tags = it.sources.map(function(id){ return '<span class="marker marker--caution">' + escapeHtml(names[id] || id) + '</span>'; }).join(' ');
        var safe = /^https:\/\/www\.astronomerstelegram\.org\//.test(it.link) ? it.link : '#';
        return '<li><span class="meta num">' + escapeHtml(when) + '</span><a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.title) + '</a>' + tags + '</li>';
      }).join('');
    }
  }
}

function glyphActivity(t){
  var f = liveFactor(t), s = liveSummary(t.id);
  var act = f === null ? 1 : f;
  var B = t.magnetic_field_gauss || 0;
  var out = { spin: 3.2, glow: 0.6, why: '' };
  if(t.category === 'black_hole'){
    out.spin = Math.max(1.6, Math.min(9, 4.5 / act));
    out.glow = Math.max(0.35, Math.min(1, 0.35 + 0.3 * act));
    out.why = f === null ? 'Hot spot orbits at a resting pace; no live flux.' : 'Hot spot speed and glow follow the live flux, x' + act.toFixed(2) + ' of last year.';
  }else if(/rotation-powered/i.test(t.type)){
    out.spin = 1.2;
    out.glow = 0.9;
    out.why = 'Beam sweeps once per 1.2 s, slowed from the real 33.5 ms spin.';
  }else if(t.spin_period_s && B >= 1e11){
    out.spin = Math.max(0.8, Math.min(6, t.spin_period_s));
    out.glow = Math.max(0.4, Math.min(1, 0.4 + 0.25 * act));
    out.why = t.spin_period_s <= 6 ? 'Pulses at its real spin period, ' + t.spin_period_s + ' s.' : 'Pulses every 6 s; the real spin is ' + t.spin_period_s + ' s.';
  }else{
    out.spin = 3.2;
    out.glow = Math.max(0.4, Math.min(1, 0.4 + 0.25 * act));
    out.why = 'No pulsations; the glow follows the live flux.';
  }
  if(s && s.available && s.trend === 'Brightening'){ out.glow = 1; out.spin *= 0.7; }
  return out;
}

function updateSourceMeta(){
  DATA.targets.forEach(function(t){
    var g = document.querySelector('.tp-glyph[data-glyph="' + t.id + '"]');
    if(g){
      var a = glyphActivity(t);
      g.style.setProperty('--spin', a.spin.toFixed(2) + 's');
      g.style.setProperty('--glow', a.glow.toFixed(2));
      g.parentNode.title = t.name + ': ' + a.why;
    }
    var el = document.querySelector('.tp-live[data-live="' + t.id + '"]');
    if(!el) return;
    var sm = liveSummary(t.id);
    if(sm && sm.available){
      var pts = (sm.spark || []).filter(function(q){ return q[0] > sm.latest_mjd - 120; });
      el.innerHTML = sparkline(pts, 40, 14) + '<span class="tp-flux num tp-flux--' + sm.trend.toLowerCase().replace(/[^a-z]/g, '') + '" title="' + sm.trend + ', 7-day mean, 15-50 keV">' + sm.week_mcrab.toFixed(0) + '</span>';
      el.title = 'Swift/BAT, last 120 days; ' + sm.week_mcrab.toFixed(0) + ' mCrab over the last 7 days, ' + sm.trend.toLowerCase();
    }else{
      el.innerHTML = sm ? '<span class="tp-flux tp-flux--none">no feed</span>' : '';
      el.title = sm ? sm.reason : '';
    }
  });
}

function hammer(l, b){
  var L = ((l + 180) % 360 + 360) % 360 - 180;
  var lr = L * Math.PI / 180, br = b * Math.PI / 180;
  var d = Math.sqrt(1 + Math.cos(br) * Math.cos(lr / 2));
  return [-2 * Math.SQRT2 * Math.cos(br) * Math.sin(lr / 2) / d, Math.SQRT2 * Math.sin(br) / d];
}

function renderSkyMap(){
  var svg = document.getElementById('sky-map');
  if(!svg) return;
  var W = 184, H = 100, sx = (W / 2 - 4) / (2 * Math.SQRT2), sy = (H / 2 - 4) / Math.SQRT2;
  function X(v){ return (W / 2 + v * sx).toFixed(1); }
  function Y(v){ return (H / 2 - v * sy).toFixed(1); }
  var out = '<ellipse cx="' + W / 2 + '" cy="' + H / 2 + '" rx="' + (W / 2 - 4) + '" ry="' + (H / 2 - 4) + '" fill="none" stroke="var(--color-border-strong)" stroke-width="0.8"/>';
  [-90, 90].forEach(function(lon){
    var d = '';
    for(var b = -90; b <= 90; b += 10){ var q = hammer(lon, b); d += (d ? ' ' : '') + X(q[0]) + ',' + Y(q[1]); }
    out += '<polyline points="' + d + '" fill="none" stroke="var(--color-border)" stroke-width="0.6"/>';
  });
  out += '<line x1="4" y1="' + H / 2 + '" x2="' + (W - 4) + '" y2="' + H / 2 + '" stroke="var(--color-border-strong)" stroke-width="0.6" stroke-dasharray="2,2"/>';
  var gc = hammer(0, 0);
  out += '<circle cx="' + X(gc[0]) + '" cy="' + Y(gc[1]) + '" r="1.6" fill="var(--color-muted)"/>';
  DATA.targets.forEach(function(t){
    var q = hammer(t.glon, t.glat), on = t.id === state.target.id;
    out += '<g class="sky-dot' + (on ? ' is-on' : '') + '" data-id="' + t.id + '" tabindex="-1"><title>' + t.name + ', l = ' + t.glon.toFixed(1) + ', b = ' + t.glat.toFixed(1) + '</title>' +
      '<circle cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="7" fill="transparent"/>' +
      '<circle cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="' + (on ? 3 : 2) + '" fill="' + (on ? 'var(--color-text)' : 'var(--color-secondary)') + '"/>' +
      (on ? '<circle cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="5.5" fill="none" stroke="var(--color-text)" stroke-width="0.8"/>' : '') + '</g>';
  });
  svg.innerHTML = out;
  var cap = document.getElementById('sky-map-caption');
  if(cap) cap.innerHTML = '<span>' + state.target.name + '</span><span class="num">l ' + state.target.glon.toFixed(1) + ', b ' + state.target.glat.toFixed(1) + '</span>';
}

function applyPanels(){
  var app = document.getElementById('app-container');
  if(!app) return;
  app.classList.toggle('list-collapsed', !!state.panels.list);
  app.classList.toggle('inspector-collapsed', !!state.panels.inspector);
  [['btn-collapse-list', 'list', 'sources'], ['btn-collapse-inspector', 'inspector', 'details']].forEach(function(d){
    var b = document.getElementById(d[0]);
    if(!b) return;
    var collapsed = !!state.panels[d[1]];
    b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    b.setAttribute('aria-label', (collapsed ? 'Show ' : 'Hide ') + d[2]);
    b.title = (collapsed ? 'Show ' : 'Hide ') + d[2] + (d[1] === 'list' ? ' ([)' : ' (])');
  });
  try{ localStorage.setItem('astropulse-panels', JSON.stringify(state.panels)); }catch(e){}
  requestAnimationFrame(onWindowResize);
}

function togglePanel(which){
  state.panels[which] = !state.panels[which];
  applyPanels();
}

function renderLiveLine(){
  updateSourceMeta();
  if(state.view === 'live-view') renderFocusStatic();
  var el = document.getElementById('live-line');
  if(!el) return;
  var s = liveSummary(state.target.id);
  if(!s){ el.hidden = true; return; }
  el.hidden = false;
  if(!s.available){
    el.innerHTML = '<span class="eyebrow">Live</span> ' + escapeHtml(s.reason);
    return;
  }
  var lf = liveFactor(state.target);
  el.innerHTML = '<span class="eyebrow">Live, Swift/BAT 15-50 keV</span> <span class="num">' + fmtFlux(s.week_mcrab, s.week_err) + ' mCrab</span> over the 7 days to ' + s.latest_date + ', ' + s.trend.toLowerCase() + '.' + (lf !== null && state.sim.followLive ? ' The disk brightness here follows it, <span class="num">x' + Math.sqrt(lf).toFixed(2) + '</span>.' : '');
}

function setCaption(id, html){
  var el = document.getElementById(id);
  if(!el) return;
  if(el.dataset.synthetic === undefined) el.dataset.synthetic = el.innerHTML;
  el.innerHTML = html === null ? el.dataset.synthetic : html;
}

function renderTimingSourceUi(){
  var isLive = state.timingSource === 'live';
  document.querySelectorAll('#timing-source > button').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-source') === state.timingSource);
    b.setAttribute('aria-pressed', b.getAttribute('data-source') === state.timingSource ? 'true' : 'false');
  });
  var reseed = document.getElementById('btn-timing-reseed');
  if(reseed) reseed.hidden = isLive;
  setCaption('timing-lead', isLive ? 'The daily Swift/BAT light curve of the selected source over the last three years, run through the same periodogram, folding and Gaussian-process fit. There is no injected answer here, so results are compared with the catalogue.' : null);
  setCaption('lc-caption', isLive ? '<strong>Figure 5.</strong> Swift/BAT daily light curve, 15-50 keV, in mCrab, with flagged days removed. Live data from the BAT transient monitor.' : null);
  setCaption('ls-caption', isLive ? '<strong>Figure 6.</strong> Lomb-Scargle periodogram of Figure 5, from periods of 2 days (the daily Nyquist limit) up to a fifth of the baseline. The dashed line is the 0.1% false-alarm level for white noise.' : null);
  setCaption('pds-caption', isLive ? '<strong>Figure 7.</strong> Not available from daily averages: a power spectrum of spins and QPOs needs X-ray timing at seconds or better.' : null);
}

function computeLiveTiming(lc){
  var t0 = lc.mjd[0];
  var tt = lc.mjd.map(function(m){ return m - t0; }), y = lc.rate, e = lc.err;
  var n = tt.length, Tb = tt[n - 1];
  var fmin = 5 / Tb, fmax = 0.5;
  var nf = Math.min(6000, Math.round((fmax - fmin) * Tb * 5));
  var ls = lombScargle(tt, y, fmin, fmax, nf);
  var bi = 0;
  for(var i = 1; i < ls.power.length; i++) if(ls.power[i] > ls.power[bi]) bi = i;
  var M = (fmax - fmin) * Tb;
  var zThr = -Math.log(1 - Math.pow(1 - 0.001, 1 / M));
  var fap = 1 - Math.pow(1 - Math.exp(-ls.power[bi]), M);
  var mean = y.reduce(function(s, v){ return s + v; }, 0) / n;
  var sd = Math.sqrt(y.reduce(function(s, v){ return s + (v - mean) * (v - mean); }, 0) / (n - 1)) || 1;
  var drw = fitDrw(tt, y.map(function(v){ return (v - mean) / sd; }), e.map(function(v){ return v / sd; }), Tb, 10);
  var P = 1 / ls.freq[bi];
  var sig = ls.power[bi] > zThr;
  return { t0: t0, tt: tt, y: y, e: e, Tb: Tb, ls: ls, best: bi, P: P, sig: sig, fap: fap, zThr: zThr, drw: drw, fold: sig ? foldSeries(tt, y, P, 24) : null };
}

function renderLiveTiming(){
  var t = state.target;
  var head = document.getElementById('timing-headline-value');
  var meta = document.getElementById('timing-headline-meta');
  var verdict = document.getElementById('timing-verdict');
  var badge = document.getElementById('timing-resolution-badge');
  function emptyAll(msg){
    ['lc-chart-svg', 'lomb-chart-svg', 'folded-chart-svg'].forEach(function(id){
      svgChart(id, { w: id === 'lc-chart-svg' ? 1080 : 540, h: id === 'lc-chart-svg' ? 220 : 260, x: { min: 0, max: 1, label: '' , ticks: [] }, y: { min: 0, max: 1, label: '', ticks: [] }, layers: [], empty: msg });
    });
    ['res-orb', 'res-fourier', 'res-drw'].forEach(function(id){ setResultCell(id, '--', msg, null, 'Unavailable'); });
  }
  svgChart('pds-chart-svg', { w: 540, h: 260, x: { min: 0.001, max: 100, log: true, label: 'Frequency (Hz)' }, y: { min: 1, max: 100, log: true, label: 'Leahy power' }, layers: [], empty: 'Needs X-ray timing at seconds or better' });
  if(verdict){ verdict.textContent = 'Live data'; verdict.className = 'verdict'; }
  var s = liveSummary(t.id);
  if(s && !s.available){
    if(head) head.textContent = '--';
    if(meta) meta.textContent = s.reason;
    if(badge) badge.textContent = 'No live feed';
    emptyAll('No live feed for this source');
    return;
  }
  var err = live.lcError[t.id];
  var lc = live.lc[t.id];
  if(!lc){
    if(!err) loadLiveCurve(t.id);
    var msg = err && err !== 'loading' ? err : 'Fetching the Swift/BAT light curve';
    if(head) head.textContent = '--';
    if(meta) meta.textContent = msg;
    if(badge) badge.textContent = 'Swift/BAT daily';
    if(err && err !== 'loading' && verdict){ verdict.textContent = 'Live data unavailable'; verdict.className = 'verdict verdict--failed'; }
    emptyAll(err && err !== 'loading' ? 'Live data unavailable' : 'Loading');
    return;
  }
  if(!lc.mjd || lc.mjd.length < 30){
    emptyAll('Too few good days in the last three years');
    return;
  }
  var L = lc._analysis || (lc._analysis = computeLiveTiming(lc));
  var lastIdx = lc.mjd.length - 1;
  if(badge) badge.textContent = 'Swift/BAT daily, ' + lc.mjd.length + ' good days';
  if(head) head.textContent = fmtFlux(lc.rate[lastIdx]).replace(/&plusmn;.*/, '') + ' mCrab';
  if(meta) meta.textContent = 'latest daily flux, 15-50 keV, MJD ' + Math.round(lc.mjd[lastIdx]) + '. Feed generated ' + (lc.generated || 'unknown') + (lc.stale ? '; served from cache because the upstream feed did not answer' : '') + '.';

  var porb = t.orbital_period_days;
  var orbMark, orbPass = null, orbNote = 'False-alarm probability ' + (L.fap < 1e-6 ? '< 1e-6' : L.fap.toFixed(4)) + '. ';
  if(porb && porb >= 2){
    var match = L.sig && Math.abs(1 / L.P - 1 / porb) < 1 / L.Tb;
    orbPass = match ? true : null;
    orbMark = match ? 'Matches catalogue' : 'Other period';
    orbNote += 'Catalogue orbit ' + fmtPeriod(porb) + '.' + (match ? '' : ' The strongest signal is something else, such as a superorbital cycle or red noise.');
  }else if(porb){
    orbMark = 'Below Nyquist';
    orbNote += 'The catalogue orbit, ' + fmtPeriod(porb) + ', is shorter than daily sampling can resolve.' + (L.sig ? ' The detected signal is longer-term variability, such as a superorbital cycle.' : '');
  }else{
    orbMark = 'No orbit';
    orbNote += 'Isolated source; any peak is intrinsic variability.';
  }
  setResultCell('res-orb', L.sig ? fmtPeriod(L.P) : 'No significant period', orbNote, orbPass, orbMark);
  setResultCell('res-fourier', 'Out of band', 'Spins and QPOs need X-ray timing at seconds or better; daily averages reach periods of two days and longer.', null, 'Out of band');
  setResultCell('res-drw', fmtPeriod(L.drw.tau), 'Damped-random-walk timescale of the daily light curve, after normalising to its scatter.', null, 'Fitted');

  var pts = L.tt.map(function(x, k){ return [x + L.t0, L.y[k], L.e[k]]; });
  var ylo = Math.min.apply(null, L.y), yhi = Math.max.apply(null, L.y), pad = (yhi - ylo) * 0.08 || 1;
  svgChart('lc-chart-svg', {
    w: 1080, h: 220,
    x: { min: L.t0, max: L.t0 + L.Tb, label: 'Modified Julian Date' },
    y: { min: ylo - pad, max: yhi + pad, label: 'Flux (mCrab)' },
    layers: [{ type: 'hline', y: 0, color: 'var(--color-muted)', dash: '2,3' }, { type: 'points', pts: pts, color: 'var(--color-secondary)', r: 1.3 }]
  });
  var lsPts = [];
  for(var i = 0; i < L.ls.freq.length; i++) lsPts.push([1 / L.ls.freq[i], L.ls.power[i]]);
  var layers = [{ type: 'line', pts: lsPts, width: 1.1 }, { type: 'hline', y: L.zThr, label: 'FAP 0.1%' }];
  if(L.sig) layers.push({ type: 'marker', x: L.P, y: L.ls.power[L.best], label: fmtPeriod(L.P) });
  if(porb && porb >= 2 && porb < L.Tb / 5) layers.push({ type: 'vline', x: porb, label: 'catalogue orbit', color: 'var(--color-muted)' });
  svgChart('lomb-chart-svg', {
    w: 540, h: 260,
    x: { min: 2, max: L.Tb / 5, log: true, label: 'Period (days)' },
    y: { min: 0, max: Math.max(L.ls.power[L.best], L.zThr) * 1.15, label: 'Normalised power' },
    layers: layers
  });
  var foldEl = document.getElementById('folded-caption');
  if(L.fold){
    var two = L.fold.concat(L.fold.map(function(p){ return [p[0] + 1, p[1], p[2]]; })).filter(function(p){ return !isNaN(p[1]); });
    var fmin = Infinity, fmaxv = -Infinity;
    two.forEach(function(p){ fmin = Math.min(fmin, p[1] - p[2]); fmaxv = Math.max(fmaxv, p[1] + p[2]); });
    var fpad = (fmaxv - fmin) * 0.12 || 1;
    svgChart('folded-chart-svg', {
      w: 540, h: 260,
      x: { min: 0, max: 2, label: 'Phase', ticks: [0, 0.5, 1, 1.5, 2] },
      y: { min: fmin - fpad, max: fmaxv + fpad, label: 'Flux (mCrab)' },
      layers: [{ type: 'line', pts: two.map(function(p){ return [p[0], p[1]]; }), color: 'var(--color-muted)', width: 1 }, { type: 'points', pts: two, color: 'var(--color-text)', r: 1.8 }]
    });
    if(foldEl) foldEl.innerHTML = '<strong>Figure 8.</strong> Swift/BAT light curve folded on its strongest period, ' + fmtPeriod(L.P) + ', over two cycles with standard errors.';
  }else{
    svgChart('folded-chart-svg', { w: 540, h: 260, x: { min: 0, max: 2, label: 'Phase', ticks: [0, 0.5, 1, 1.5, 2] }, y: { min: 0, max: 1, label: 'Flux (mCrab)' }, layers: [], empty: 'No significant period to fold on' });
    if(foldEl) foldEl.innerHTML = '<strong>Figure 8.</strong> Nothing to fold: no period passed the 0.1% false-alarm level.';
  }
}

var PARANAL = { name: 'Paranal', lat: -24.6272, lon: -70.4045 };
var liveTicker = { focusKey: null, skyKey: null, sky: null, replay: null, lastPulse: 0, pulseCount: 0 };

function raDeg(s){
  var m = /(\d+)h\s*(\d+)m\s*([\d.]+)s/.exec(s || '');
  return m ? 15 * (+m[1] + m[2] / 60 + m[3] / 3600) : null;
}

function decDeg(s){
  var m = /([+-]?)(\d+)deg\s*(\d+)m\s*([\d.]+)s/.exec(s || '');
  if(!m) return null;
  var v = +m[2] + m[3] / 60 + m[4] / 3600;
  return m[1] === '-' ? -v : v;
}

function jdOf(ms){ return ms / 86400000 + 2440587.5; }

function altitudeDeg(ra, dec, ms, site){
  var d = jdOf(ms) - 2451545.0;
  var gmst = (280.46061837 + 360.98564736629 * d) % 360;
  var H = (gmst + site.lon - ra) * Math.PI / 180;
  var la = site.lat * Math.PI / 180, de = dec * Math.PI / 180;
  return Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(H)) * 180 / Math.PI;
}

function sunRaDec(ms){
  var n = jdOf(ms) - 2451545.0;
  var L = (280.46 + 0.9856474 * n) * Math.PI / 180;
  var g = (357.528 + 0.9856003 * n) * Math.PI / 180;
  var lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  var eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
  return { ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * 180 / Math.PI, dec: Math.asin(Math.sin(eps) * Math.sin(lam)) * 180 / Math.PI };
}

function fmtDms(v){
  var sgn = v < 0 ? '-' : '';
  v = Math.abs(v);
  var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.floor((mf - m) * 60);
  return sgn + d + '&deg; ' + (m < 10 ? '0' : '') + m + '&#8242; ' + (s < 10 ? '0' : '') + s + '&#8243;';
}

function fmtUtc(ms){
  var d = new Date(ms);
  return (d.getUTCHours() < 10 ? '0' : '') + d.getUTCHours() + ':' + (d.getUTCMinutes() < 10 ? '0' : '') + d.getUTCMinutes();
}

function fmtAge(ms){
  var s = Math.max(0, Math.floor(ms / 1000));
  var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  function p(v){ return (v < 10 ? '0' : '') + v; }
  return (d ? d + ' d ' : '') + p(h) + ' h ' + p(m) + ' m ' + p(x) + ' s';
}

function skyTrack(t, now){
  var ra = raDeg(t.ra), dec = decDeg(t.dec);
  if(ra === null || dec === null) return null;
  var start = now - 6 * 3600000, pts = [], night = [], wins = [], inWin = null, best = { alt: -90, ms: now };
  for(var k = 0; k <= 144; k++){
    var ms = start + k * 600000;
    var alt = altitudeDeg(ra, dec, ms, PARANAL);
    var sun = sunRaDec(ms);
    var sAlt = altitudeDeg(sun.ra, sun.dec, ms, PARANAL);
    var hr = (ms - now) / 3600000;
    pts.push([hr, alt]);
    night.push([hr, sAlt < -18]);
    var ok = alt > 30 && sAlt < -18;
    if(ms >= now){
      if(ok && inWin === null) inWin = ms;
      if(!ok && inWin !== null){ wins.push([inWin, ms]); inWin = null; }
      if(alt > best.alt) best = { alt: alt, ms: ms };
    }
  }
  if(inWin !== null) wins.push([inWin, start + 144 * 600000]);
  return { ra: ra, dec: dec, pts: pts, night: night, wins: wins, best: best };
}

function liveFactor(t){
  var s = liveSummary(t.id);
  if(!s || !s.available || s.year_mcrab === null || s.year_mcrab === undefined) return null;
  var ratio = Math.max(0.3, Math.min(3, (s.week_mcrab + 30) / (Math.max(s.year_mcrab, -20) + 30)));
  var weight = s.z === null || s.z === undefined ? 0.5 : Math.min(1, Math.abs(s.z) / 3);
  return Math.pow(ratio, weight);
}

function runningMean(lc){
  if(lc._mean) return lc._mean;
  var out = [];
  for(var i = 0; i < lc.mjd.length; i++){
    var sw = 0, s = 0;
    for(var j = i; j >= 0 && lc.mjd[i] - lc.mjd[j] < 3.5; j--){ var w = 1 / (lc.err[j] * lc.err[j]); sw += w; s += lc.rate[j] * w; }
    for(j = i + 1; j < lc.mjd.length && lc.mjd[j] - lc.mjd[i] < 3.5; j++){ var w2 = 1 / (lc.err[j] * lc.err[j]); sw += w2; s += lc.rate[j] * w2; }
    out.push(s / sw);
  }
  lc._mean = out;
  return out;
}

function nowMjd(){ return Date.now() / 86400000 + 40587; }

function renderFocusChart(cursor){
  var t = state.target, lc = live.lc[t.id];
  var svg = document.getElementById('lf-chart');
  if(!svg) return;
  var s = liveSummary(t.id);
  if(s && !s.available){
    svgChart('lf-chart', { w: 720, h: 210, x: { min: -365, max: 5, label: 'Days before now' }, y: { min: 0, max: 1, label: 'mCrab', ticks: [] }, layers: [], empty: s.reason });
    return;
  }
  if(!lc){
    if(!live.lcError[t.id]) loadLiveCurve(t.id);
    svgChart('lf-chart', { w: 720, h: 210, x: { min: -365, max: 5, label: 'Days before now' }, y: { min: 0, max: 1, label: 'mCrab', ticks: [] }, layers: [], empty: live.lcError[t.id] && live.lcError[t.id] !== 'loading' ? live.lcError[t.id] : 'Loading the Swift/BAT light curve' });
    return;
  }
  var nm = nowMjd(), mean = runningMean(lc), pts = [], line = [], ys = [];
  for(var i = 0; i < lc.mjd.length; i++){
    var x = lc.mjd[i] - nm;
    if(x < -365) continue;
    ys.push(lc.rate[i]);
    if(cursor !== undefined && cursor !== null && x > cursor) continue;
    pts.push([x, lc.rate[i], lc.err[i]]);
    if(line.length && x - line[line.length - 1][0] > 15) line.push(null);
    line.push([x, mean[i]]);
  }
  if(!ys.length){
    svgChart('lf-chart', { w: 720, h: 210, x: { min: -365, max: 5, label: 'Days before now' }, y: { min: 0, max: 1, label: 'mCrab', ticks: [] }, layers: [], empty: 'No good BAT days in the last year' });
    return;
  }
  var sorted = ys.slice().sort(function(a, b){ return a - b; });
  var lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
  var pad = (hi - lo) * 0.15 || 5;
  var layers = [
    { type: 'hline', y: 0, color: 'var(--color-border-strong)', dash: '2,3' },
    { type: 'points', pts: pts, color: 'var(--color-muted)', r: 1.3 },
    { type: 'line', pts: line, color: 'var(--color-text)', width: 1.6 },
    { type: 'vline', x: 0, label: 'now', color: 'var(--color-caution)' }
  ];
  if(cursor !== undefined && cursor !== null){
    layers.push({ type: 'vline', x: cursor, label: mjdDate(nm + cursor), color: 'var(--color-text)', dash: '1,0' });
  }else if(line.length && line[line.length - 1]){
    layers.push({ type: 'marker', x: line[line.length - 1][0], y: line[line.length - 1][1], label: line[line.length - 1][1].toFixed(0) + ' mCrab' });
  }
  svgChart('lf-chart', {
    w: 720, h: 210,
    x: { min: -365, max: 5, label: 'Days before now', ticks: [-360, -300, -240, -180, -120, -60, 0] },
    y: { min: Math.min(lo - pad, -pad * 0.2), max: hi + pad, label: 'mCrab' },
    layers: layers
  });
}

function mjdDate(m){
  return new Date((m - 40587) * 86400000).toISOString().slice(0, 10);
}

function renderFocusStatic(){
  var t = state.target, s = liveSummary(t.id);
  function set(id, html){ var el = document.getElementById(id); if(el) el.innerHTML = html; }
  set('lf-class', escapeHtml(t.type));
  set('lf-name', escapeHtml(t.name));
  var trend = document.getElementById('lf-trend');
  if(s && s.available){
    set('lf-flux', s.week_mcrab.toFixed(Math.abs(s.week_mcrab) < 100 ? 1 : 0));
    set('lf-flux-note', '&plusmn; ' + s.week_err.toFixed(1) + ' mCrab, 15-50 keV, mean of the last 7 days' + (s.year_mcrab !== null ? '; previous year ' + s.year_mcrab.toFixed(0) : ''));
    if(trend){ trend.textContent = s.trend; trend.className = 'marker ' + (s.trend === 'Brightening' ? 'marker--caution' : 'marker--neutral'); }
  }else{
    set('lf-flux', '--');
    set('lf-flux-note', s ? escapeHtml(s.reason) : (live.error ? 'Live data offline' : 'Waiting for the live feed'));
    if(trend){ trend.textContent = ''; trend.className = 'marker'; }
  }
  var f = liveFactor(t);
  var sim = document.getElementById('lf-sim');
  if(sim){
    if(f === null){
      sim.textContent = 'No live flux for this source, so the 3D model keeps its catalogue brightness.';
    }else if(!state.sim.followLive){
      sim.textContent = 'Following live flux is off in Scene options, so the 3D model keeps its catalogue brightness.';
    }else{
      sim.innerHTML = 'The 3D disk is scaled by <span class="num">x' + Math.sqrt(f).toFixed(2) + '</span> in brightness: this week\'s ' + s.week_mcrab.toFixed(0) + ' mCrab against last year\'s ' + s.year_mcrab.toFixed(0) + '. It updates by itself when Swift publishes new data.';
    }
  }
  renderFocusChart(liveTicker.replay ? liveTicker.replay.cursor : null);
}

function renderSkyChart(tr, now){
  if(!tr) return;
  var bands = [], cur = null;
  tr.night.forEach(function(n, k){
    if(n[1] && cur === null) cur = n[0];
    if((!n[1] || k === tr.night.length - 1) && cur !== null){ bands.push([cur, n[0]]); cur = null; }
  });
  var shift = (now - liveTicker.sky.now) / 3600000;
  svgChart('lf-sky', {
    w: 360, h: 170,
    x: { min: -6, max: 18, label: 'Hours from now (UTC ' + fmtUtc(now) + ')', ticks: [-6, 0, 6, 12, 18] },
    y: { min: -30, max: 90, label: 'Altitude', ticks: [0, 30, 60, 90] },
    layers: bands.map(function(b){ return { type: 'band', x0: b[0] - shift, x1: b[1] - shift }; }).concat([
      { type: 'hline', y: 30, color: 'var(--color-muted)', dash: '3,3' },
      { type: 'line', pts: tr.pts.map(function(p){ return [p[0] - shift, p[1]]; }), color: 'var(--color-text)', width: 1.5 },
      { type: 'vline', x: 0, label: 'now', color: 'var(--color-caution)' }
    ])
  });
}

function liveTick(){
  var now = Date.now(), t = state.target;
  var clock = document.getElementById('live-clock');
  if(clock) clock.textContent = new Date(now).toISOString().slice(11, 19) + ' UTC';
  var ageEl = document.getElementById('live-checked');
  if(ageEl) ageEl.textContent = liveTicker.lastPulse ? 'checked ' + Math.max(0, Math.round((now - liveTicker.lastPulse) / 1000)) + ' s ago' : '';
  var s = liveSummary(t.id);
  var lfAge = document.getElementById('lf-age');
  if(lfAge) lfAge.textContent = s && s.available ? 'Newest Swift/BAT day ' + s.latest_date + ', ' + fmtAge(now - (s.latest_mjd + 1 - 40587) * 86400000) + ' ago. Swift publishes about once a day; this page checks every second.' : '';
  if(!liveTicker.sky || liveTicker.sky.id !== t.id || now - liveTicker.sky.now > 60000){
    liveTicker.sky = { id: t.id, now: now, track: skyTrack(t, now) };
  }
  var tr = liveTicker.sky.track;
  if(tr){
    var alt = altitudeDeg(tr.ra, tr.dec, now, PARANAL);
    var alt2 = altitudeDeg(tr.ra, tr.dec, now + 60000, PARANAL);
    var sun = sunRaDec(now), sAlt = altitudeDeg(sun.ra, sun.dec, now, PARANAL);
    var altEl = document.getElementById('lf-alt');
    if(altEl) altEl.innerHTML = fmtDms(alt);
    var note = document.getElementById('lf-alt-note');
    if(note){
      note.textContent = (alt < 0 ? 'Below the horizon' : (alt2 > alt ? 'Rising' : 'Setting')) + ', ' + (sAlt < -18 ? 'astronomical night' : (sAlt < 0 ? 'twilight' : 'daytime')) + ' at Paranal. Highest in the next day at ' + fmtUtc(tr.best.ms) + ' UTC, ' + tr.best.alt.toFixed(0) + ' deg.';
    }
    var win = document.getElementById('lf-window');
    if(win){
      win.textContent = tr.wins.length ? 'Observable above 30 deg in a dark sky ' + tr.wins.map(function(w){ return fmtUtc(w[0]) + ' to ' + fmtUtc(w[1]); }).join(' and ') + ' UTC.' : 'Not observable from Paranal in a dark sky in the next 18 hours.';
    }
    renderSkyChart(tr, now);
  }
  document.querySelectorAll('[data-alt]').forEach(function(cell){
    var tt = DATA.targets.filter(function(x){ return x.id === cell.getAttribute('data-alt'); })[0];
    var ra = raDeg(tt.ra), dec = decDeg(tt.dec);
    if(ra === null) return;
    var a = altitudeDeg(ra, dec, now, PARANAL), b = altitudeDeg(ra, dec, now + 60000, PARANAL);
    cell.innerHTML = (a < 0 ? '<span class="meta">down</span>' : a.toFixed(1) + '&deg; ' + (b > a ? '&#8593;' : '&#8595;'));
  });
}

function beatBrand(){
  var m = document.getElementById('brand-mark');
  if(!m || prefersCalm()) return;
  m.classList.remove('is-beat');
  void m.offsetWidth;
  m.classList.add('is-beat');
}

function syncBrandMark(){
  var m = document.getElementById('brand-mark');
  if(!m) return;
  var running = !state.sim.paused && state.sim.speed > 0;
  m.classList.toggle('is-frozen', !running);
  m.style.setProperty('--spin', (6 / Math.max(0.2, state.sim.speed / 10)).toFixed(2) + 's');
  m.title = running ? 'The ring turns while the simulation runs and glows each time live data checks in' : 'Simulation frozen';
}

function pollPulse(){
  liveFetch('api/live/pulse').then(function(d){
    liveTicker.lastPulse = Date.now();
    beatBrand();
    liveTicker.pulseCount++;
    var dot = document.getElementById('live-pulse');
    if(dot){ dot.classList.remove('is-beat'); void dot.offsetWidth; dot.classList.add('is-beat'); }
    var stamp = JSON.stringify(Object.keys(d.sources).map(function(k){ return [k, d.sources[k].fetched, d.sources[k].latest_mjd]; }));
    if(live.stamp && stamp !== live.stamp){
      live.lc = {};
      live.lcError = {};
      loadLive();
    }
    live.stamp = stamp;
  }, function(){});
}

function startLiveClock(){
  var n = 0;
  setInterval(function(){
    n++;
    syncBrandMark();
    if(document.hidden) return;
    var onLive = state.view === 'live-view';
    var onTimingLive = state.view === 'timing-view' && state.timingSource === 'live';
    if(onLive || (onTimingLive && n % 5 === 0) || n % 60 === 0) pollPulse();
    if(onLive) liveTick();
  }, 1000);
}

function toggleReplay(){
  var btn = document.getElementById('btn-lf-replay');
  if(liveTicker.replay){
    cancelAnimationFrame(liveTicker.replay.raf);
    liveTicker.replay = null;
    if(btn) btn.textContent = 'Replay the last year';
    renderFocusStatic();
    return;
  }
  if(!live.lc[state.target.id]) return;
  var dur = prefersCalm() ? 1 : 14000, t0 = performance.now(), lc = live.lc[state.target.id], mean = runningMean(lc), nm = nowMjd();
  liveTicker.replay = { cursor: -365 };
  if(btn) btn.textContent = 'Stop replay';
  function frame(){
    if(!liveTicker.replay) return;
    var u = Math.min(1, (performance.now() - t0) / dur);
    liveTicker.replay.cursor = -365 + 365 * u;
    var idx = -1;
    for(var i = 0; i < lc.mjd.length; i++){ if(lc.mjd[i] - nm <= liveTicker.replay.cursor) idx = i; }
    var fl = document.getElementById('lf-flux');
    if(fl) fl.textContent = idx >= 0 && lc.mjd[idx] - nm > -380 ? mean[idx].toFixed(Math.abs(mean[idx]) < 100 ? 1 : 0) : '--';
    var nt = document.getElementById('lf-flux-note');
    if(nt) nt.textContent = 'Replay: 7-day mean on ' + mjdDate(nm + liveTicker.replay.cursor);
    renderFocusChart(liveTicker.replay.cursor);
    if(u < 1) liveTicker.replay.raf = requestAnimationFrame(function(){ setTimeout(frame, 60); });
    else { liveTicker.replay = null; if(btn) btn.textContent = 'Replay the last year'; setTimeout(renderFocusStatic, 1500); }
  }
  frame();
}

function renderPipelinesContent(){
  var box = document.getElementById('reflex-nodes-box');
  if(!box) return;
  box.innerHTML = '';

  var nodes = [
    { num: 1, title: 'Raw ingest', desc: 'Read archival FITS files and verify headers' },
    { num: 2, title: 'Master bias', desc: 'Trim overscan, subtract dark current' },
    { num: 3, title: 'Flat field', desc: 'Correct pixel sensitivity and illumination' },
    { num: 4, title: 'Dispersion', desc: 'Wavelength solution from ThAr and FeAr arcs' },
    { num: 5, title: 'Flux response', desc: 'Response from a spectrophotometric standard' },
    { num: 6, title: '1D extraction', desc: 'Optimal variance-weighted aperture extraction' }
  ];

  nodes.forEach(function(n, idx){
    var nodeEl = document.createElement('div');
    nodeEl.className = 'reflex-node';
    nodeEl.setAttribute('data-node-idx', idx);
    nodeEl.setAttribute('role', 'button');
    nodeEl.setAttribute('data-state', 'wait');
    nodeEl.setAttribute('tabindex', '0');
    nodeEl.innerHTML = '<div class="r-node-header"><span class="r-node-num">' + n.num + '</span><span class="r-node-title">' + n.title + '</span></div><div class="r-node-desc">' + n.desc + '</div>';
    nodeEl.addEventListener('click', function(){
      playClickSound();
      var log = document.getElementById('reflex-status-text');
      if(log) log.textContent = 'Step ' + n.num + ', ' + n.title + ': calibration checked, parameters valid.';
    });
    box.appendChild(nodeEl);
  });

  drawReflexWires();
  renderPyrafChart();
}

function drawReflexWires(){
  var svg = document.getElementById('reflex-wires-svg');
  var container = document.getElementById('reflex-nodes-box');
  if(!svg || !container) return;
  svg.innerHTML = '';

  var nodes = container.querySelectorAll('.reflex-node');
  if(nodes.length < 2) return;

  var rects = [];
  nodes.forEach(function(n){
    rects.push(n.getBoundingClientRect());
  });

  var cRect = container.getBoundingClientRect();
  var linesHtml = '';

  for(var i = 0; i < rects.length - 1; i++){
    var x1 = rects[i].right - cRect.left;
    var y1 = rects[i].top + rects[i].height / 2 - cRect.top;
    var x2 = rects[i + 1].left - cRect.left;
    var y2 = rects[i + 1].top + rects[i + 1].height / 2 - cRect.top;
    var midX = (x1 + x2) / 2;

    linesHtml += '<path d="M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" stroke="var(--color-border-strong)" stroke-width="1.5"/>';
  }

  svg.innerHTML = linesHtml;
}

function executeReflexPipeline(){
  var nodes = document.querySelectorAll('.reflex-node');
  var statusText = document.getElementById('reflex-status-text');
  var btn = document.getElementById('btn-execute-reflex');
  if(btn) btn.disabled = true;

  var step = 0;
  var interval = setInterval(function(){
    nodes.forEach(function(n, idx){
      n.classList.toggle('node-executing', idx === step);
      n.setAttribute('data-state', idx < step ? 'done' : (idx === step ? 'active' : 'wait'));
    });

    if(step < nodes.length){
      playPipelineChime(step);
      if(statusText) statusText.textContent = 'Running step ' + (step + 1) + ' of ' + nodes.length + ': ' + nodes[step].querySelector('.r-node-title').textContent + '.';
      step++;
    }else{
      clearInterval(interval);
      nodes.forEach(function(n){ n.classList.remove('node-executing'); n.setAttribute('data-state', 'done'); });
      playSuccessSound();
      if(statusText) statusText.innerHTML = '<strong class="status-ok">Workflow finished.</strong> Calibrated science spectrum and response matrix are ready.';
      if(btn) btn.disabled = false;
    }
  }, 450);
}

function renderPyrafChart(){
  var svg = document.getElementById('pyraf-chart-svg');
  if(!svg) return;
  svg.innerHTML = '';
  var w = 680, h = 260, padL = 50, padR = 20, padT = 16, padB = 34;
  var pW = w - padL - padR;
  var pH = h - padT - padB;

  var pts = [];
  for(var i = 0; i <= 60; i++){
    var lam = 4200 + (7000 - 4200) * (i / 60);
    var continuum = 1.0;
    var he2 = -0.45 * Math.exp(-Math.pow(lam - 4686, 2) / 120);
    var hAlpha = -0.75 * Math.exp(-Math.pow(lam - 6563, 2) / 180);
    var noise = Math.sin(i * 3.4) * 0.04;
    var val = continuum + he2 + hAlpha + noise;

    var x = padL + (i / 60) * pW;
    var y = (h - padB) - (val / 1.5) * pH;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }

  svg.innerHTML += '<line x1="' + padL + '" y1="' + (h - padB - (1.0 / 1.5) * pH) + '" x2="' + (w - padR) + '" y2="' + (h - padB - (1.0 / 1.5) * pH) + '" stroke="var(--color-border)" stroke-dasharray="4,3"/>';
  svg.innerHTML += '<polyline fill="none" stroke="var(--color-text)" stroke-width="1.6" points="' + pts.join(' ') + '"/>';

  var axes = '<line x1="' + padL + '" y1="' + (h - padB) + '" x2="' + (w - padR) + '" y2="' + (h - padB) + '" stroke="var(--color-text)"/>';
  axes += '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (h - padB) + '" stroke="var(--color-text)"/>';
  axes += '<text x="' + (w / 2) + '" y="' + (h - 8) + '" font-size="9" fill="var(--color-secondary)" text-anchor="middle" font-family="var(--font-sans)">Wavelength (\u00C5ngstr\u00F6ms)</text>';
  axes += '<text x="' + 16 + '" y="' + (h / 2) + '" font-size="9" fill="var(--color-secondary)" text-anchor="middle" transform="rotate(-90 16 ' + (h / 2) + ')" font-family="var(--font-sans)">Continuum Ratio</text>';
  svg.innerHTML += axes;
}

function handleXspecCommand(cmd){
  var out = document.getElementById('xspec-output');
  if(!out) return;

  var line = document.createElement('div');
  line.innerHTML = '<span class="term-prompt">XSPEC12&gt;</span> ';
  line.appendChild(document.createTextNode(cmd));
  out.appendChild(line);

  var c = cmd.trim().toLowerCase();
  var resp = document.createElement('div');
  resp.className = 'term-reply';

  if(c === 'fit'){
    playTone(600, 'sine', 0.1, 0.08);
    resp.innerHTML = 'Executing Levenberg-Marquardt Chi-Square Optimization...<br>' +
      'Iter 1: Chi-Squared = 128.45 (dof 84)<br>' +
      'Iter 2: Chi-Squared = 94.20 (dof 84)<br>' +
      'Iter 3: Chi-Squared = 87.52 (dof 84)<br>' +
      '<strong class="term-ok">Converged: reduced chi-square = 1.042 (dof = 84)</strong>';
  }else if(c.indexOf('model') === 0){
    playTone(500, 'sine', 0.08, 0.06);
    resp.innerHTML = 'Model wabs[1]*(diskbb[2] + powerlaw[3] + diskline[4]) defined successfully.<br>Parameters initialized from spectral catalog.';
  }else if(c.indexOf('data') === 0){
    playTone(450, 'sine', 0.08, 0.06);
    resp.innerHTML = 'Loaded pha spectral dataset for target ' + state.target.name + ' (Channel 1-1024). Response matrix and background assigned.';
  }else if(c === 'show error' || c.indexOf('error') === 0){
    playTone(650, 'sine', 0.08, 0.06);
    resp.innerHTML = 'Confidence intervals (90% / 1.645 sigma):<br>' +
      'Par 1 (Tin): ' + state.params.tin + ' (-0.02, +0.02) keV<br>' +
      'Par 2 (Gamma): ' + state.params.gamma + ' (-0.03, +0.04)<br>' +
      'Par 3 (Fe E): ' + state.params.fe + ' (-0.03, +0.03) keV';
  }else if(c === 'clear'){
    out.innerHTML = '';
    return;
  }else{
    resp.innerHTML = 'Command acknowledged. Available commands: data 1:1, model, fit, show error, show param, clear.';
  }

  out.appendChild(resp);
  out.scrollTop = out.scrollHeight;
}

function openMediaModal(tabKey){
  var t = state.target;
  var om = t.observatory_media || {};

  var elBadge = document.getElementById('modal-target-badge');
  if(elBadge) elBadge.textContent = 'Observatory archive, record ' + t.id;

  var elTitle = document.getElementById('modal-target-title');
  if(elTitle) elTitle.textContent = t.name + ': ' + (om.image_title || 'observatory image');

  var elFullImg = document.getElementById('modal-full-image');
  if(elFullImg && om.image){
    elFullImg.src = om.image;
    elFullImg.alt = t.name + ' Observation';
  }

  var elImgFac = document.getElementById('modal-img-facility');
  if(elImgFac) elImgFac.textContent = om.image_facility || 'Space Telescope Facility';

  var elImgBand = document.getElementById('modal-img-band');
  if(elImgBand) elImgBand.textContent = om.image_band || 'High Energy Continuum';

  var elImgRes = document.getElementById('modal-img-resolution');
  if(elImgRes) elImgRes.textContent = om.image_resolution || 'High-Resolution Master';

  var elImgDesc = document.getElementById('modal-img-desc');
  if(elImgDesc) elImgDesc.textContent = om.image_desc || t.description;

  var btnDown = document.getElementById('btn-download-image');
  if(btnDown && om.image) btnDown.href = om.image;

  var vidPlayer = document.getElementById('modal-main-video');
  if(vidPlayer && om.video){
    vidPlayer.src = om.video;
  }

  var elVidFac = document.getElementById('modal-vid-facility');
  if(elVidFac) elVidFac.textContent = om.video_facility || 'NASA Supercomputer Lab';

  var elVidDesc = document.getElementById('modal-vid-desc');
  if(elVidDesc) elVidDesc.textContent = om.video_desc || 'Time-series high definition astrophysical simulation.';

  switchMediaTab(tabKey || 'tab-image');

  var modal = document.getElementById('media-lightbox-modal');
  if(modal) modal.classList.remove('hidden');

  playClickSound();
}

function closeMediaModal(){
  var modal = document.getElementById('media-lightbox-modal');
  if(modal) modal.classList.add('hidden');

  var vidPlayer = document.getElementById('modal-main-video');
  if(vidPlayer){
    try{ vidPlayer.pause(); }catch(e){}
  }

  playClickSound();
}

function switchMediaTab(tabKey){
  var tabPills = document.querySelectorAll('.media-tab-pill');
  tabPills.forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-tab') === tabKey);
  });

  var paneImg = document.getElementById('pane-modal-image');
  var paneVid = document.getElementById('pane-modal-video');
  var vidPlayer = document.getElementById('modal-main-video');

  if(tabKey === 'tab-video'){
    if(paneImg) paneImg.classList.add('hidden');
    if(paneVid) paneVid.classList.remove('hidden');
    if(vidPlayer){
      try{
        var playPromise = vidPlayer.play();
        if(playPromise !== undefined){
          playPromise.catch(function(){});
        }
      }catch(e){}
    }
  }else{
    if(paneVid) paneVid.classList.add('hidden');
    if(paneImg) paneImg.classList.remove('hidden');
    if(vidPlayer){
      try{ vidPlayer.pause(); }catch(e){}
    }
  }
}

function shortClass(type){
  var rules = [[/ultracompact/i, 'UCXB'], [/microquasar/i, 'MQ'], [/rotation-powered/i, 'PSR'], [/high-mass|hmxb/i, 'HMXB'], [/low-mass|lmxb/i, 'LMXB'], [/accreting x-ray pulsar/i, 'XRP'], [/transient/i, 'XRT']];
  for(var i = 0; i < rules.length; i++){ if(rules[i][0].test(type)) return rules[i][1]; }
  return 'XRB';
}

function syncPressedStates(){
  document.querySelectorAll('.segmented > button').forEach(function(b){
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
  });
}

function initEventBindings(){
  document.addEventListener('click', function(){ setTimeout(syncPressedStates, 0); });
  setTimeout(syncPressedStates, 0);
  var pillsContainer = document.getElementById('target-pills-container');
  if(pillsContainer){
    pillsContainer.innerHTML = '';
    [['black_hole', 'Black holes'], ['neutron_star', 'Neutron stars']].forEach(function(group){
      var members = DATA.targets.filter(function(t){ return t.category === group[0]; });
      if(!members.length) return;
      var head = document.createElement('p');
      head.className = 'source-group';
      head.innerHTML = '<span></span><span class="num"></span>';
      head.firstChild.textContent = group[1];
      head.lastChild.textContent = members.length;
      pillsContainer.appendChild(head);
      members.forEach(function(t){
        var btn = document.createElement('button');
        btn.className = 'target-pill' + (t.id === state.targetId ? ' active' : '');
        btn.setAttribute('data-id', t.id);
        btn.title = t.name + ', ' + t.type;
        var gl = document.createElement('span');
        gl.className = 'tp-glyph tp-glyph--' + (t.category === 'black_hole' ? 'bh' : (/rotation-powered/i.test(t.type) ? 'psr' : 'ns'));
        gl.setAttribute('aria-hidden', 'true');
        gl.setAttribute('data-glyph', t.id);
        var body = document.createElement('span');
        body.className = 'tp-body';
        var nm = document.createElement('span');
        nm.className = 'tp-name';
        nm.textContent = t.name;
        var sub = document.createElement('span');
        sub.className = 'tp-sub';
        sub.innerHTML = '<abbr class="tp-type">' + shortClass(t.type) + '</abbr> &middot; <span class="num">' + (t.distance_kpc ? t.distance_kpc.toFixed(1) + ' kpc' : '') + '</span>';
        body.appendChild(nm);
        body.appendChild(sub);
        var lv = document.createElement('span');
        lv.className = 'tp-live';
        lv.setAttribute('data-live', t.id);
        btn.appendChild(gl);
        btn.appendChild(body);
        btn.appendChild(lv);
        btn.addEventListener('click', function(){
          selectTarget(t.id);
        });
        pillsContainer.appendChild(btn);
      });
    });

  }

  var btnPrev = document.getElementById('btn-target-prev');
  var btnNext = document.getElementById('btn-target-next');
  if(btnPrev && pillsContainer){
    btnPrev.addEventListener('click', function(){
      pillsContainer.scrollBy({ left: -140, behavior: 'smooth' });
      playClickSound();
    });
  }
  if(btnNext && pillsContainer){
    btnNext.addEventListener('click', function(){
      pillsContainer.scrollBy({ left: 140, behavior: 'smooth' });
      playClickSound();
    });
  }

  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var canvasWrapper = document.getElementById('three-canvas-wrapper');
  if(canvasWrapper){
    canvasWrapper.addEventListener('pointermove', function(e){
      if(state.camMode !== 'galactic' || !camera || !galaxyRefs) return;
      var rect = canvasWrapper.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(targetMarkers, false);
      var id = hits.length ? (hits[0].object.userData.targetId || (hits[0].object.userData.sgra ? 'sgra' : null)) : null;
      canvasWrapper.style.cursor = id ? 'pointer' : '';
      if(id !== galaxyRefs.hovered){
        galaxyRefs.hovered = id;
        updateGalacticTargetHighlight();
      }
    });
    canvasWrapper.addEventListener('click', function(e){
      if(state.camMode !== 'galactic' || !camera) return;
      var rect = canvasWrapper.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var intersects = raycaster.intersectObjects(targetMarkers, true);
      if(intersects.length > 0 && intersects[0].object.userData.sgra){
        flyToSgrA();
        return;
      }
      if(intersects.length > 0){
        var hit = intersects[0].object;
        while(hit && (!hit.userData || !hit.userData.targetId)){
          hit = hit.parent;
        }
        if(hit && hit.userData && hit.userData.targetId){
          selectTarget(hit.userData.targetId);
        }
      }
    });
  }

  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var v = btn.getAttribute('data-view');
      switchView(v);
    });
  });

  document.querySelectorAll('.cam-pill').forEach(function(p){
    p.addEventListener('click', function(){
      var mode = p.getAttribute('data-cam');
      setCameraMode(mode);
      playClickSound();
    });
  });

  document.querySelectorAll('.model-pill').forEach(function(pill){
    pill.addEventListener('click', function(){
      var mode = pill.getAttribute('data-model');
      if(!mode) return;
      state.modelMode = mode;
      document.querySelectorAll('.model-pill').forEach(function(p){
        p.classList.toggle('active', p === pill);
      });
      var drawerSurface = document.getElementById('drawer-real-surface-controls');
      if(drawerSurface){
        drawerSurface.classList.toggle('hidden', mode !== 'real-surface');
      }
      buildSystemScene(state.target);
      playClickSound();
    });
  });

  document.querySelectorAll('.cmap-pill').forEach(function(pill){
    pill.addEventListener('click', function(){
      var cmap = pill.getAttribute('data-cmap');
      if(!cmap) return;
      state.fluxColormap = cmap;
      document.querySelectorAll('.cmap-pill').forEach(function(p){
        p.classList.toggle('active', p === pill);
      });
      if(state.modelMode === 'real-surface'){
        buildSystemScene(state.target);
      }
      playClickSound();
    });
  });

  var debouncedSurfaceUpdate = null;
  function scheduleSurfaceUpdate(){
    if(debouncedSurfaceUpdate) clearTimeout(debouncedSurfaceUpdate);
    debouncedSurfaceUpdate = setTimeout(function(){
      if(state.modelMode === 'real-surface'){
        buildSystemScene(state.target);
      }
    }, 60);
  }

  var rngFluxGain = document.getElementById('rng-flux-gain');
  if(rngFluxGain){
    rngFluxGain.addEventListener('input', function(){
      state.fluxGain = parseFloat(rngFluxGain.value) || 12.0;
      var valEl = document.getElementById('val-flux-gain');
      if(valEl) valEl.textContent = state.fluxGain.toFixed(0) + 'x';
      if(state.modelMode === 'real-surface'){
        scheduleSurfaceUpdate();
      }
    });
  }

  var btnAudio = document.getElementById('btn-audio-toggle');
  if(btnAudio){
    btnAudio.addEventListener('click', function(){
      state.audioEnabled = !state.audioEnabled;
      btnAudio.setAttribute('aria-pressed', state.audioEnabled ? 'true' : 'false');
      btnAudio.textContent = state.audioEnabled ? 'Sound' : 'Sound off';
      if(state.audioEnabled) playClickSound();
    });
  }

  var btnCamReset = document.getElementById('btn-camera-reset');
  if(btnCamReset){
    btnCamReset.addEventListener('click', function(){
      setCameraMode(state.camMode);
      playClickSound();
    });
  }

  var btnFreeze = document.getElementById('btn-toggle-sim-freeze');
  if(btnFreeze){
    btnFreeze.addEventListener('click', function(){
      state.sim.paused = !state.sim.paused;
      btnFreeze.classList.toggle('frozen', state.sim.paused);
      var lblFreeze = document.getElementById('lbl-sim-freeze');
      if(lblFreeze){
        lblFreeze.textContent = state.sim.paused ? 'Resume' : 'Freeze';
      }
      playClickSound();
    });
  }

  var btnOpenSpec = document.getElementById('btn-open-spectral-lab');
  if(btnOpenSpec){
    btnOpenSpec.addEventListener('click', function(){
      switchView('spectral-view');
    });
  }

  var chkJets = document.getElementById('chk-sim-jets');
  if(chkJets){
    chkJets.addEventListener('change', function(){
      state.sim.jets = chkJets.checked;
      updateSimulationPhysics();
    });
  }

  var chkStream = document.getElementById('chk-sim-stream');
  if(chkStream){
    chkStream.addEventListener('change', function(){
      state.sim.stream = chkStream.checked;
      updateSimulationPhysics();
    });
  }

  var chkDoppler = document.getElementById('chk-sim-doppler');
  if(chkDoppler){
    chkDoppler.addEventListener('change', function(){
      state.sim.doppler = chkDoppler.checked;
      updateSimulationPhysics();
    });
  }

  var chkLive = document.getElementById('chk-sim-live');
  if(chkLive){
    chkLive.addEventListener('change', function(){
      state.sim.followLive = chkLive.checked;
      updateSimulationPhysics();
      renderLiveLine();
    });
  }
  [['btn-lf-replay', toggleReplay], ['btn-lf-open', function(){ switchView('sandbox-view'); }], ['btn-lf-timing', function(){ state.timingSource = 'live'; switchView('timing-view'); }]].forEach(function(d){
    var b = document.getElementById(d[0]);
    if(b) b.addEventListener('click', d[1]);
  });

  var chkMag = document.getElementById('chk-sim-magfield');
  if(chkMag){
    chkMag.addEventListener('change', function(){
      state.sim.magfield = chkMag.checked;
      updateSimulationPhysics();
    });
  }

  var rngSpeed = document.getElementById('rng-sim-speed');
  if(rngSpeed){
    rngSpeed.addEventListener('input', function(){
      state.sim.speed = parseFloat(rngSpeed.value);
      var sv = document.getElementById('val-sim-speed');
      if(sv) sv.textContent = (state.sim.speed / 10).toFixed(1) + 'x';
    });
  }

  var debouncedDiskUpdate = null;
  function scheduleDiskUpdate(){
    if(debouncedDiskUpdate) clearTimeout(debouncedDiskUpdate);
    debouncedDiskUpdate = setTimeout(function(){
      updateSimulationPhysics();
    }, 120);
  }

  document.querySelectorAll('.res-pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      var r = parseInt(btn.getAttribute('data-res'), 10) || 2048;
      state.sim.resolution = r;
      document.querySelectorAll('.res-pill').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      applyRenderQuality();
      updateSimulationPhysics();
      playClickSound();
    });
  });

  var rngTin = document.getElementById('rng-tin');
  if(rngTin){
    rngTin.addEventListener('input', function(){
      state.params.tin = parseFloat(rngTin.value);
      state.fitErrors = null; state.fitLog = null;
      var valEl = document.getElementById('val-tin');
      if(valEl) valEl.textContent = state.params.tin.toFixed(2) + ' keV';
      updatePhysicsDerivedMetrics();
      renderSpectrumChart();
      scheduleDiskUpdate();
    });
  }

  var rngMdot = document.getElementById('rng-mdot');
  if(rngMdot){
    rngMdot.addEventListener('input', function(){
      state.params.mdot = parseFloat(rngMdot.value);
      state.fitErrors = null; state.fitLog = null;
      var valEl = document.getElementById('val-mdot');
      if(valEl) valEl.textContent = state.params.mdot.toFixed(3) + ' L_Edd';
      updatePhysicsDerivedMetrics();
      renderSpectrumChart();
      scheduleDiskUpdate();
    });
  }

  var rngGamma = document.getElementById('rng-gamma');
  if(rngGamma){
    rngGamma.addEventListener('input', function(){
      state.params.gamma = parseFloat(rngGamma.value);
      state.fitErrors = null; state.fitLog = null;
      var valEl = document.getElementById('val-gamma');
      if(valEl) valEl.textContent = state.params.gamma.toFixed(2);
      updatePhysicsDerivedMetrics();
      renderSpectrumChart();
    });
  }

  var rngFe = document.getElementById('rng-fe');
  if(rngFe){
    rngFe.addEventListener('input', function(){
      state.params.fe = parseFloat(rngFe.value);
      state.fitErrors = null; state.fitLog = null;
      var valEl = document.getElementById('val-fe');
      if(valEl) valEl.textContent = state.params.fe.toFixed(2) + ' keV';
      updatePhysicsDerivedMetrics();
      renderSpectrumChart();
    });
  }

  var rngB = document.getElementById('rng-bfield');
  if(rngB){
    rngB.addEventListener('input', function(){
      state.params.bfield = parseFloat(rngB.value);
      state.fitErrors = null; state.fitLog = null;
      updatePhysicsDerivedMetrics();
      renderSpectrumChart();
      scheduleDiskUpdate();
    });
  }

  var btnApply3d = document.getElementById('btn-apply-to-3d');
  if(btnApply3d){
    btnApply3d.addEventListener('click', function(){
      updateSimulationPhysics();
      playSuccessSound();
      switchView('sandbox-view');
    });
  }

  var btnFitQuick = document.getElementById('btn-fit-xspec-quick');
  if(btnFitQuick){
    btnFitQuick.addEventListener('click', function(){
      runSpectralFit();
      updateTargetHud();
      renderSpectrumChart();
      renderTimingCharts();
      updateSimulationPhysics();
      playSuccessSound();
    });
  }

  document.querySelectorAll('#timing-source > button').forEach(function(b){
    b.addEventListener('click', function(){
      state.timingSource = b.getAttribute('data-source');
      if(state.timingSource === 'live' && !live.sources && !live.loading) loadLive();
      renderTimingCharts();
      playClickSound();
    });
  });
  ['list', 'inspector'].forEach(function(which){
    var b = document.getElementById(which === 'list' ? 'btn-collapse-list' : 'btn-collapse-inspector');
    if(b) b.addEventListener('click', function(){ togglePanel(which); });
  });
  var skyMap = document.getElementById('sky-map');
  if(skyMap){
    skyMap.addEventListener('click', function(e){
      var g = e.target.closest ? e.target.closest('.sky-dot') : null;
      if(g) selectTarget(g.getAttribute('data-id'));
    });
  }
  applyPanels();
  updateSourceMeta();

  var liveRows = document.getElementById('live-rows');
  if(liveRows){
    liveRows.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.live-source') : null;
      if(!b) return;
      selectTarget(b.getAttribute('data-id'));
      var top = document.getElementById('live-focus');
      if(top) top.scrollIntoView({ block: 'start', behavior: prefersCalm() ? 'auto' : 'smooth' });
    });
  }
  var btnSpecSeed = document.getElementById('btn-spec-reseed');
  var btnTimingSeed = document.getElementById('btn-timing-reseed');
  [btnSpecSeed, btnTimingSeed].forEach(function(btn){
    if(!btn) return;
    btn.addEventListener('click', function(){
      state.realization = (state.realization || 0) + 1;
      state.fitErrors = null; state.fitLog = null;
      renderAllCharts();
      playClickSound();
    });
  });

  var rngIncl = document.getElementById('rng-incl');
  if(rngIncl){
    rngIncl.addEventListener('input', function(){
      state.optical.inc = parseFloat(rngIncl.value);
      renderOpticalLines();
    });
  }
  var rngPhase = document.getElementById('rng-phase');
  if(rngPhase){
    rngPhase.addEventListener('input', function(){
      state.optical.phase = parseFloat(rngPhase.value);
      renderOpticalLines();
    });
  }

  document.querySelectorAll('.pipe-subtab').forEach(function(tab){
    tab.addEventListener('click', function(){
      var subId = tab.getAttribute('data-subtab');
      document.querySelectorAll('.pipe-subtab').forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('.subtab-pane').forEach(function(p){
        p.classList.toggle('hidden', p.id !== subId);
      });
      playClickSound();
      if(subId === 'subtab-reflex'){
        drawReflexWires();
      }else if(subId === 'subtab-pyraf'){
        renderPyrafChart();
      }
    });
  });

  var btnExecReflex = document.getElementById('btn-execute-reflex');
  if(btnExecReflex){
    btnExecReflex.addEventListener('click', executeReflexPipeline);
  }

  var xInput = document.getElementById('xspec-input');
  var xBtn = document.getElementById('btn-xspec-submit');
  function submitXspec(){
    if(!xInput) return;
    var val = xInput.value.trim();
    if(val){
      handleXspecCommand(val);
      xInput.value = '';
    }
  }
  if(xBtn) xBtn.addEventListener('click', submitXspec);
  if(xInput){
    xInput.addEventListener('keydown', function(e){
      if(e.key === 'Enter') submitXspec();
    });
  }

  var btnSplot = document.getElementById('btn-pyraf-splot');
  if(btnSplot){
    btnSplot.addEventListener('click', function(){
      playSuccessSound();
      var ap = document.getElementById('pyraf-aperture');
      if(ap) ap.textContent = '3.5 arcsec (Optimal)';
    });
  }

  var btnRetSandbox = document.getElementById('btn-return-to-sandbox');
  if(btnRetSandbox){
    btnRetSandbox.addEventListener('click', function(){
      switchView('sandbox-view');
    });
  }

  var btnThumbWrap = document.getElementById('hud-media-thumb-wrap');
  if(btnThumbWrap){
    btnThumbWrap.addEventListener('click', function(){
      openMediaModal('tab-image');
    });
  }

  var btnViewImg = document.getElementById('btn-view-real-image');
  if(btnViewImg){
    btnViewImg.addEventListener('click', function(e){
      e.stopPropagation();
      openMediaModal('tab-image');
    });
  }

  var btnPlayVid = document.getElementById('btn-play-real-video');
  if(btnPlayVid){
    btnPlayVid.addEventListener('click', function(e){
      e.stopPropagation();
      openMediaModal('tab-video');
    });
  }

  var btnCloseMedia = document.getElementById('btn-close-media-modal');
  if(btnCloseMedia){
    btnCloseMedia.addEventListener('click', closeMediaModal);
  }

  var mediaBackdrop = document.getElementById('media-lightbox-modal');
  if(mediaBackdrop){
    mediaBackdrop.addEventListener('click', function(e){
      if(e.target === mediaBackdrop){
        closeMediaModal();
      }
    });
  }

  document.querySelectorAll('.media-tab-pill').forEach(function(pill){
    pill.addEventListener('click', function(){
      var tabKey = pill.getAttribute('data-tab');
      switchMediaTab(tabKey);
      playClickSound();
    });
  });

  var btnVidPlayPause = document.getElementById('btn-vid-playpause');
  if(btnVidPlayPause){
    btnVidPlayPause.addEventListener('click', function(){
      var vid = document.getElementById('modal-main-video');
      if(vid){
        if(vid.paused){
          vid.play();
          btnVidPlayPause.classList.add('active');
        }else{
          vid.pause();
          btnVidPlayPause.classList.remove('active');
        }
      }
    });
  }

  var btnVidRestart = document.getElementById('btn-vid-restart');
  if(btnVidRestart){
    btnVidRestart.addEventListener('click', function(){
      var vid = document.getElementById('modal-main-video');
      if(vid){
        vid.currentTime = 0;
        vid.play();
      }
    });
  }

  window.addEventListener('keydown', function(e){
    if(e.target.tagName === 'INPUT') return;
    if((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button'){
      e.preventDefault();
      e.target.click();
      return;
    }
    if(e.key === 'Escape') closeMediaModal();
    var tag = e.target && e.target.tagName;
    if(tag !== 'INPUT' && tag !== 'TEXTAREA'){
      if(e.key === '[') togglePanel('list');
      if(e.key === ']') togglePanel('inspector');
    }
    if(e.key === '1') switchView('sandbox-view');
    if(e.key === '2') switchView('spectral-view');
    if(e.key === '3') switchView('pipelines-view');
    if(e.key === '4') switchView('timing-view');
    if(e.key === '5') switchView('live-view');
    if(e.key === '6') switchView('dashboard-view');
  });
}

function renderAllCharts(){
  renderSpectrumChart();
  renderTimingCharts();
  renderOpticalLines();
  renderPyrafChart();
}

function setSceneStatus(stateName, text){
  var st = document.getElementById('scene-status');
  if(!st) return;
  st.setAttribute('data-state', stateName);
  var t = st.querySelector('.status__text');
  if(t) t.textContent = text;
}

function applyTheme(light){
  if(light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  var btn = document.getElementById('btn-theme');
  if(btn){
    btn.textContent = light ? 'Dark theme' : 'Light theme';
    btn.setAttribute('aria-pressed', light ? 'true' : 'false');
  }
}

function initTheme(){
  applyTheme(document.documentElement.dataset.theme === 'light');
  var btn = document.getElementById('btn-theme');
  if(!btn) return;
  btn.addEventListener('click', function(){
    var light = document.documentElement.dataset.theme !== 'light';
    applyTheme(light);
    renderOpticalLines();
    try{ if(light) localStorage.setItem('astropulse-theme', 'light'); else localStorage.removeItem('astropulse-theme'); }catch(e){}
  });
}

function playIntro(){
  var intro = document.getElementById('intro');
  if(!intro || prefersCalm()) return;
  try{ if(sessionStorage.getItem('astropulse-intro')) return; sessionStorage.setItem('astropulse-intro', '1'); }catch(e){ return; }
  intro.hidden = false;
  var remain = Math.max(500, 1800 - performance.now());
  setTimeout(function(){ intro.classList.add('is-leaving'); }, remain);
  setTimeout(function(){ intro.hidden = true; intro.classList.remove('is-leaving'); document.documentElement.classList.remove('intro-pending'); }, remain + 500);
}

function boot(){
  playIntro();
  loadLive();
  startLiveClock();
  liveFetch('api/health').then(function(){
    setInterval(function(){ fetch('api/health', { cache: 'no-store' }).catch(function(){}); }, 30 * 1000);
  }, function(){});
  initTheme();
  try{
    initThreeEngine();
    setSceneStatus(renderer ? 'ready' : 'error', renderer ? 'Scene ready' : 'No WebGL');
  }catch(err){
    setSceneStatus('error', 'No WebGL');
  }
  initRealObservatory();
  initNasaSimulation();
  initEventBindings();
  selectTarget('cyg');
  updateNavSlider();

  handleXspecCommand('data 1:1 nustar_cygx1_src.pha');
  handleXspecCommand('model wabs*(diskbb + powerlaw + diskline)');

  try{
    var qParams = new URLSearchParams(window.location.search);
    var qTarget = qParams.get('target');
    if(qTarget){
      selectTarget(qTarget);
    }
    var qModel = qParams.get('model');
    if(qModel){
      var qPill = document.querySelector('.model-pill[data-model="' + qModel + '"]');
      if(qPill) qPill.click();
    }
  }catch(e){}
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
}else{
  boot();
}

})();
