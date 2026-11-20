/**
 * Baytline homepage scroll film: "dawn to night over a Gulf city".
 * Original, fully procedural Three.js scene: no models, textures or downloads.
 *
 * Driven by one number, progress (0..1), mapped from page scroll:
 *   0.00 dawn over dunes  ->  0.10-0.42 towers rise  ->  0.55 golden hour
 *   ->  0.62-0.86 night, windows light up  ->  1.00 camera settles high over the city
 */
import * as THREE from "three";

// ---------------------------------------------------------------- small utilities

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 2D value noise with smooth interpolation, for the dunes. */
function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;
  const v = (x: number, y: number) => vals[perm[(perm[x & 255]! + y) & 511]!]!;
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), u), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
  };
}

// ---------------------------------------------------------------- time of day

type Keyframe = { at: number; top: string; horizon: string; sun: string; sunPower: number; ambient: number; elevation: number; azimuth: number; fog: number };

/** Lighting keyframes along the film's progress. */
const SKY: Keyframe[] = [
  { at: 0.0, top: "#1b2442", horizon: "#e7a37c", sun: "#ffb48a", sunPower: 1.3, ambient: 0.35, elevation: 3, azimuth: 70, fog: 0.0024 },
  { at: 0.3, top: "#3b6a9c", horizon: "#d8c8a9", sun: "#fff1d4", sunPower: 2.6, ambient: 0.6, elevation: 38, azimuth: 30, fog: 0.0015 },
  { at: 0.52, top: "#2c4670", horizon: "#f0b15c", sun: "#ffbe6e", sunPower: 2.2, ambient: 0.45, elevation: 9, azimuth: -40, fog: 0.0019 },
  { at: 0.66, top: "#141b37", horizon: "#8c4a62", sun: "#ff8a5c", sunPower: 0.7, ambient: 0.25, elevation: -2, azimuth: -60, fog: 0.0021 },
  { at: 0.86, top: "#05080f", horizon: "#18223a", sun: "#7d93c4", sunPower: 0.28, ambient: 0.14, elevation: 32, azimuth: 120, fog: 0.0015 },
  { at: 1.0, top: "#04070d", horizon: "#141d31", sun: "#7d93c4", sunPower: 0.26, ambient: 0.13, elevation: 34, azimuth: 125, fog: 0.0014 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function skyAt(p: number) {
  let i = 0;
  while (i < SKY.length - 2 && p > SKY[i + 1]!.at) i++;
  const a = SKY[i]!, b = SKY[i + 1]!;
  const t = smooth(a.at, b.at, p);
  const mix = (x: string, y: string) => new THREE.Color().copy(tmpA.set(x)).lerp(tmpB.set(y), t);
  return {
    top: mix(a.top, b.top),
    horizon: mix(a.horizon, b.horizon),
    sun: mix(a.sun, b.sun),
    sunPower: lerp(a.sunPower, b.sunPower, t),
    ambient: lerp(a.ambient, b.ambient, t),
    elevation: lerp(a.elevation, b.elevation, t),
    azimuth: lerp(a.azimuth, b.azimuth, t),
    fog: lerp(a.fog, b.fog, t),
  };
}

// ---------------------------------------------------------------- shaders

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 col, float dist) {
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
      uniform float uStars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.35 + pow(s, 3.0) * 0.08);
        if (uStars > 0.0 && h > 0.05) {
          vec3 g = floor(d * 260.0);
          float r = hash(g);
          float star = step(0.9965, r) * smoothstep(0.05, 0.35, h);
          col += vec3(0.9, 0.92, 1.0) * star * uStars * (0.6 + 0.4 * hash(g + 3.1));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

/** Towers: own lighting, procedural windows that light up at night, rise animation. */
const buildingMaterial = (shared: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute vec3 aSize;
      attribute float aSeed;
      attribute float aType;
      attribute float aDelay;
      attribute float aLift;
      uniform float uRise;
      varying vec3 vLocal;
      varying vec3 vObjNormal;
      varying vec3 vWorldNormal;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vType;
      varying float vRise;
      varying vec3 vSize;
      void main() {
        float rise = smoothstep(aDelay, aDelay + 0.32, uRise);
        vec3 p = position;
        p.y *= max(rise, 0.0001);
        vec3 local = p * aSize;
        local.y += aLift * rise;           // roof elements ride on the rising building below
        vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
        vLocal = vec3(p.x * aSize.x, p.y * aSize.y, p.z * aSize.z);
        vObjNormal = normal;
        vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vWorld = world.xyz;
        vSeed = aSeed; vType = aType; vRise = rise; vSize = aSize;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uHorizon;
      uniform float uSunPower, uAmbient, uLit, uTime;
      ${FOG_GLSL}
      varying vec3 vLocal, vObjNormal, vWorldNormal, vWorld, vSize;
      varying float vSeed, vType, vRise;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vWorldNormal);
        bool roof = vObjNormal.y > 0.5;
        // Materials: 0 glass tower, 1 sandstone heritage block, 2 champagne spire tower, 3 barjeel (wind tower)
        vec3 base = vType < 0.5 ? vec3(0.07, 0.11, 0.14) : vType < 1.5 ? vec3(0.62, 0.52, 0.38) : vType < 2.5 ? vec3(0.42, 0.38, 0.31) : vec3(0.6, 0.5, 0.36);
        float diffuse = max(dot(n, normalize(uSunDir)), 0.0);
        vec3 col = base * (uAmbient * mix(uHorizon, uSkyTop, 0.5) * 1.6 + uSunColor * uSunPower * diffuse * 0.55);

        // Windows on side faces
        vec2 face = vec2(abs(vObjNormal.x) > 0.5 ? vLocal.z : vLocal.x, vLocal.y);
        vec2 cellSize = vType < 0.5 ? vec2(2.4, 3.3) : vType < 1.5 ? vec2(3.6, 3.6) : vec2(2.0, 3.2);
        vec2 g = face / cellSize;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        // Antialiased window mask: soft edges sized to the pixel footprint, fading to the average
        // coverage in the distance so far facades don't shimmer.
        vec2 fw = max(fwidth(g), vec2(1e-4));
        #define BOX(v, a, b, w) (smoothstep(a - w, a + w, v) * (1.0 - smoothstep(b - w, b + w, v)))
        float win = vType > 2.5 ? BOX(f.x, 0.35, 0.65, fw.x) * BOX(f.y, 0.2, 0.7, fw.y) // barjeel vents
          : vType < 0.5 ? BOX(f.x, 0.08, 0.92, fw.x) * BOX(f.y, 0.12, 0.88, fw.y)
          : BOX(f.x, 0.3, 0.7, fw.x) * BOX(f.y, 0.25, 0.75, fw.y);
        float avgWin = vType > 2.5 ? 0.15 : vType < 0.5 ? 0.64 : 0.2;
        float detail = 1.0 - smoothstep(0.18, 0.5, max(fw.x, fw.y));
        win = mix(avgWin, win, detail);
        if (roof) win = 0.0;

        // Glass reflects the sky; a fresnel term brightens grazing angles.
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
        if (vType < 0.5 && !roof) col = mix(col, mix(uHorizon, uSkyTop, 0.35) * 0.9, 0.35 + 0.5 * fres);

        // Window lighting. Each building lights up gradually, cell by cell.
        float r = hash(cell + vSeed * 31.7);
        float share = vType < 0.5 ? 0.62 : vType < 1.5 ? 0.45 : 0.7;
        float lit = mix(uLit * share * avgWin, step(r, uLit * share) * win, detail);
        float flicker = 0.92 + 0.08 * sin(uTime * 0.7 + r * 40.0);
        vec3 warm = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.9, 0.7), hash(cell * 1.7 + vSeed));
        col = mix(col, col * 0.55, win * (1.0 - uLit) * 0.5);  // dark panes in daylight
        col += warm * lit * 2.2 * flicker * (vType > 2.5 ? 0.0 : 1.0);

        // Street-level shopfronts glow at night; a gold crown marks the top of tall towers.
        float street = (1.0 - step(4.0, vLocal.y)) * (roof ? 0.0 : 1.0);
        col += vec3(1.0, 0.72, 0.38) * street * uLit * 0.9;
        float top = vSize.y * vRise;
        float crown = step(top - 1.6, vLocal.y) * step(60.0, vSize.y) * (roof ? 0.0 : 1.0);
        col = mix(col, vec3(0.79, 0.64, 0.29) * (0.6 + uLit * 1.2), crown * 0.85);

        // Soft contact shading near the ground.
        col *= roof ? 1.0 : 0.62 + 0.38 * smoothstep(0.0, 22.0, vLocal.y);

        col = applyFog(col, length(cameraPosition - vWorld));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

const waterMaterial = (shared: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uHorizon;
      uniform float uSunPower, uLit, uTime;
      ${FOG_GLSL}
      varying vec3 vWorld;
      void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        float ripple = sin(vWorld.x * 0.08 + uTime * 0.6) * 0.5 + sin(vWorld.z * 0.13 - uTime * 0.4) * 0.5;
        vec3 n = normalize(vec3(ripple * 0.04, 1.0, ripple * 0.03));
        float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
        vec3 col = mix(uSkyTop * 0.35, uHorizon, fres);
        vec3 r = reflect(-v, n);
        float glint = pow(max(dot(r, normalize(uSunDir)), 0.0), 220.0);
        col += uSunColor * glint * uSunPower * 1.6;
        col += vec3(1.0, 0.75, 0.42) * uLit * 0.06 * (0.6 + 0.4 * ripple);  // city lights on the water
        col = applyFog(col, length(cameraPosition - vWorld));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

// ---------------------------------------------------------------- the scene

export type SceneOptions = { lowPower?: boolean };

export class SkylineScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
  private shared: Record<string, THREE.IUniform>;
  private sky: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a6a4a, 0.5);
  private path: THREE.CatmullRomCurve3;
  private look: THREE.CatmullRomCurve3;
  private progress = 0;
  private shown = 0; // smoothed progress for gentle camera motion
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private raf = 0;
  private running = false;
  private clock = new THREE.Clock();
  private disposables: { dispose(): void }[] = [];

  constructor(private canvas: HTMLCanvasElement, opts: SceneOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.shared = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunPower: { value: 1 },
      uAmbient: { value: 0.4 },
      uSkyTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.002 },
      uRise: { value: 0 },
      uLit: { value: 0 },
      uTime: { value: 0 },
    };

    const skyMat = skyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
    this.scene.add(this.sky, this.sun, this.hemi);
    this.disposables.push(this.sky.geometry, skyMat);

    this.buildDunes();
    this.buildWater();
    this.buildCity(1); // same city on every device; lowPower only lowers pixel density and antialiasing

    // Camera path: low over the dunes, rising toward the city, around it at golden hour, high above it at night.
    this.path = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 7, 520),
        new THREE.Vector3(10, 22, 400),
        new THREE.Vector3(-50, 80, 300),
        new THREE.Vector3(-230, 150, 190),
        new THREE.Vector3(-200, 240, -40),
        new THREE.Vector3(-20, 360, 40),
      ],
      false,
      "centripetal",
    );
    this.look = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 28, 0),
        new THREE.Vector3(0, 40, 0),
        new THREE.Vector3(0, 60, 0),
        new THREE.Vector3(10, 55, -10),
        new THREE.Vector3(10, 40, -20),
        new THREE.Vector3(0, 0, -30),
      ],
      false,
      "centripetal",
    );
    this.applyProgress(0);
  }

  private buildDunes() {
    const noise = makeNoise(7);
    const size = 2400;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Long wind-shaped ridges plus finer ripples.
      let h = 0;
      h += Math.pow(1 - Math.abs(noise(x * 0.004 + 3, z * 0.0025) * 2 - 1), 2) * 26;
      h += noise(x * 0.012, z * 0.012) * 7;
      h += noise(x * 0.05, z * 0.05) * 0.8;
      // Flatten the city plate and fade dunes out toward the sea (north, negative z).
      const r = Math.hypot(x, z);
      h *= smooth(150, 260, r);
      h *= smooth(-300, -170, z);
      pos.setY(i, h - 0.5);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#c8a676"), roughness: 1, metalness: 0 });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
  }

  private buildWater() {
    const geo = new THREE.PlaneGeometry(4000, 1600);
    geo.rotateX(-Math.PI / 2);
    const mat = waterMaterial(this.shared);
    const water = new THREE.Mesh(geo, mat);
    water.position.set(0, 0.2, -1050);
    this.scene.add(water);
    this.disposables.push(geo, mat);
  }

  private buildCity(density: number) {
    const rnd = mulberry32(2026);
    type B = { x: number; z: number; w: number; d: number; h: number; type: number; rot: number; delay: number; lift: number };
    const blocks: B[] = [];
    const roofs: B[] = [];
    const block = 26;
    for (let gx = -6; gx <= 6; gx++) {
      for (let gz = -6; gz <= 4; gz++) {
        const cx = gx * block, cz = gz * block;
        const dist = Math.hypot(cx, cz * 1.1);
        if (dist > 170 || rnd() > density) continue;
        const centrality = 1 - Math.min(dist / 170, 1);
        const count = 1 + Math.floor(rnd() * (centrality > 0.55 ? 2 : 3));
        for (let k = 0; k < count; k++) {
          const ox = (rnd() - 0.5) * 12, oz = (rnd() - 0.5) * 12;
          const roll = rnd();
          // Tall glass towers cluster in the centre, heritage blocks with wind towers around the edge.
          const type = centrality > 0.5 ? (roll < 0.78 ? 0 : 2) : centrality > 0.25 ? (roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2) : 1;
          const w = type === 1 ? 10 + rnd() * 8 : 7 + rnd() * 7;
          const d = type === 1 ? 10 + rnd() * 8 : 7 + rnd() * 7;
          const h = type === 1 ? 7 + rnd() * 10 : type === 2 ? 70 + centrality * 150 * rnd() + 30 : 25 + Math.pow(centrality, 1.6) * 190 * (0.4 + rnd() * 0.6);
          const delay = Math.min(0.68, (1 - centrality) * 0.45 + rnd() * 0.2);
          const b = { x: cx + ox, z: cz + oz, w, d, h, type, rot: (rnd() - 0.5) * 0.25, delay, lift: 0 };
          blocks.push(b);
          if (type === 1) {
            // One or two barjeel wind towers on the roof.
            const n = rnd() < 0.5 ? 1 : 2;
            for (let j = 0; j < n; j++) roofs.push({ ...b, x: b.x + (rnd() - 0.5) * w * 0.5, z: b.z + (rnd() - 0.5) * d * 0.5, w: 2.6, d: 2.6, h: 5 + rnd() * 2, type: 3, lift: h });
          }
          if (type === 2) roofs.push({ ...b, w: 1.4, d: 1.4, h: 18 + rnd() * 24, type: 2, lift: h }); // spire
        }
      }
    }
    // One landmark tower at the centre, original design: stepped glass shaft with a long spire.
    blocks.push({ x: 4, z: -6, w: 16, d: 16, h: 250, type: 0, rot: 0.1, delay: 0.32, lift: 0 });
    roofs.push({ x: 4, z: -6, w: 9, d: 9, h: 40, type: 0, rot: 0.1, delay: 0.32, lift: 250 });
    roofs.push({ x: 4, z: -6, w: 1.6, d: 1.6, h: 60, type: 2, rot: 0.1, delay: 0.32, lift: 290 });

    const all = [...blocks, ...roofs];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const n = all.length;
    const size = new Float32Array(n * 3), seed = new Float32Array(n), type = new Float32Array(n), delay = new Float32Array(n), lift = new Float32Array(n);
    const mat = buildingMaterial(this.shared);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    all.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
      m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      size.set([b.w, b.h, b.d], i * 3);
      seed[i] = i * 0.618 + 1.3;
      type[i] = b.type;
      delay[i] = b.delay;
      lift[i] = b.lift;
    });
    geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute("aType", new THREE.InstancedBufferAttribute(type, 1));
    geo.setAttribute("aDelay", new THREE.InstancedBufferAttribute(delay, 1));
    geo.setAttribute("aLift", new THREE.InstancedBufferAttribute(lift, 1));
    mesh.frustumCulled = false; // vertex shader moves geometry; bounds would be wrong
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
  }

  /** Night level 0..1, used by the ambient sound to bring in the city hum. */
  get nightLevel() {
    return smooth(0.6, 0.86, this.shown);
  }

  setProgress(p: number) {
    this.progress = Math.min(Math.max(p, 0), 1);
  }

  /** -1..1 pointer position for gentle parallax. */
  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    // Keep the city in frame on tall phone screens.
    this.camera.fov = this.camera.aspect < 0.8 ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }

  private applyProgress(p: number) {
    const k = skyAt(p);
    const az = THREE.MathUtils.degToRad(k.azimuth), el = THREE.MathUtils.degToRad(k.elevation);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();

    const skyU = (this.sky.material as THREE.ShaderMaterial).uniforms;
    skyU.uTop!.value.copy(k.top);
    skyU.uHorizon!.value.copy(k.horizon);
    skyU.uSunDir!.value.copy(dir);
    skyU.uSunColor!.value.copy(k.sun);
    skyU.uStars!.value = smooth(0.68, 0.9, p);

    const u = this.shared;
    u.uSunDir!.value.copy(dir);
    u.uSunColor!.value.copy(k.sun);
    u.uSunPower!.value = k.sunPower;
    u.uAmbient!.value = k.ambient;
    u.uSkyTop!.value.copy(k.top);
    u.uHorizon!.value.copy(k.horizon);
    u.uFogColor!.value.copy(k.horizon).lerp(k.top, 0.25);
    u.uFogDensity!.value = k.fog;
    u.uRise!.value = smooth(0.08, 0.44, p) * 1.0;
    u.uLit!.value = smooth(0.6, 0.86, p);

    this.sun.position.copy(dir).multiplyScalar(500);
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunPower * 1.4;
    this.hemi.color.copy(k.top);
    this.hemi.groundColor.set("#6b4e31").multiplyScalar(0.5 + k.ambient);
    this.hemi.intensity = k.ambient * 2.2;

    const t = THREE.MathUtils.smootherstep(p, 0, 1);
    const pos = this.path.getPoint(t);
    const target = this.look.getPoint(t);
    // Parallax: a few metres of drift, never enough to fight the scroll.
    pos.x += this.pointerSmooth.x * 9;
    pos.y += this.pointerSmooth.y * 4;
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  private frame = () => {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.shared.uTime!.value += dt;
    // Ease toward the scroll position and pointer so motion stays smooth on any input device.
    this.shown += (this.progress - this.shown) * Math.min(1, dt * 6);
    this.pointerSmooth.lerp(this.pointer, Math.min(1, dt * 2.5));
    this.applyProgress(this.shown);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Render one frame at a fixed progress (used for the still poster). */
  renderStill(p: number) {
    this.shown = this.progress = p;
    this.applyProgress(p);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
