import type { Vec3, WorldToVoxel } from "../../core/geometry";
import type { LayerDisplay, VoxelGrid } from "../types";
import { type ColorLut, lutTable } from "../volume";

/**
 * WebGL2 renderer shared by all views: one offscreen canvas renders a view at screen resolution and the
 * view's 2D canvas copies it (so overlays, labels and screenshots keep working). Volumes live on the GPU
 * as R32F 3D textures (cached per data array); sampling, windowing, color tables and layer blending run
 * in the fragment shader with the same rules as the CPU path (samplePlane + compositeLayers).
 */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Trilinear sample with the CPU path's clamping; returns false outside the volume (± half voxel). */
const SAMPLE = `
uniform highp sampler3D uVol;
uniform ivec3 uDims;
uniform bool uNearest;
bool sampleVol(vec3 p, out float val) {
  vec3 n = vec3(uDims);
  if (any(lessThan(p, vec3(-0.5))) || any(greaterThan(p, n - 0.5))) return false;
  vec3 c = clamp(p, vec3(0.0), n - 1.0);
  if (uNearest) {
    val = texelFetch(uVol, ivec3(floor(c + 0.5)), 0).r;
    return true;
  }
  ivec3 i0 = ivec3(floor(c));
  ivec3 i1 = min(i0 + 1, uDims - 1);
  vec3 f = c - vec3(i0);
  float c000 = texelFetch(uVol, ivec3(i0.x, i0.y, i0.z), 0).r;
  float c100 = texelFetch(uVol, ivec3(i1.x, i0.y, i0.z), 0).r;
  float c010 = texelFetch(uVol, ivec3(i0.x, i1.y, i0.z), 0).r;
  float c110 = texelFetch(uVol, ivec3(i1.x, i1.y, i0.z), 0).r;
  float c001 = texelFetch(uVol, ivec3(i0.x, i0.y, i1.z), 0).r;
  float c101 = texelFetch(uVol, ivec3(i1.x, i0.y, i1.z), 0).r;
  float c011 = texelFetch(uVol, ivec3(i0.x, i1.y, i1.z), 0).r;
  float c111 = texelFetch(uVol, ivec3(i1.x, i1.y, i1.z), 0).r;
  float c00 = mix(c000, c100, f.x), c01 = mix(c010, c110, f.x);
  float c10 = mix(c001, c101, f.x), c11 = mix(c011, c111, f.x);
  val = mix(mix(c00, c01, f.y), mix(c10, c11, f.y), f.z);
  return true;
}`;

/** Window + LUT + blending rules shared by plane and MIP shaders. */
const SHADE = `
uniform sampler2D uLut;
uniform vec2 uWindow;
uniform float uOpacity;
uniform bool uBase;
out vec4 outColor;
void shade(float v, bool inside) {
  if (!inside || isnan(v) || (!uBase && v <= uWindow.x)) { outColor = vec4(0.0); return; }
  float t = clamp((v - uWindow.x) / max(uWindow.y - uWindow.x, 1e-12), 0.0, 1.0);
  vec3 rgb = texelFetch(uLut, ivec2(int(floor(t * 255.0 + 0.5)), 0), 0).rgb;
  outColor = vec4(rgb, uBase ? 1.0 : uOpacity);
}`;

const PLANE_FRAG = `#version 300 es
precision highp float;
precision highp int;
${SAMPLE}
${SHADE}
uniform vec3 uWorld0;   // world position of device pixel (0, 0) (top-left)
uniform vec3 uWorldDx;  // per device pixel to the right
uniform vec3 uWorldDy;  // per device pixel downwards
uniform float uHeight;
uniform mat3 uW2V;      // voxel = uW2V · (world − uW2VOrigin)
uniform vec3 uW2VOrigin;
void main() {
  float px = gl_FragCoord.x - 0.5;
  float py = uHeight - gl_FragCoord.y - 0.5;
  vec3 w = uWorld0 + px * uWorldDx + py * uWorldDy;
  float v;
  bool inside = sampleVol(uW2V * (w - uW2VOrigin), v);
  shade(v, inside);
}`;

/** Rotating MIP in index space (as Volume3D.rotatingMip): rays in the x–y plane, image rows = slices. */
const MIP_FRAG = `#version 300 es
precision highp float;
precision highp int;
${SAMPLE}
${SHADE}
uniform vec2 uImg0;     // image (u, v) of device pixel (0, 0)
uniform vec2 uImgD;     // image units per device pixel (x, y)
uniform float uHeight;
uniform vec2 uImgSize;  // MIP image width/height (pixels)
uniform float uTheta;
uniform bvec2 uFlip;    // flip horizontally / vertically
void main() {
  float px = gl_FragCoord.x - 0.5;
  float py = uHeight - gl_FragCoord.y - 0.5;
  float ui = uImg0.x + px * uImgD.x;
  float zi = uImg0.y + py * uImgD.y;
  if (ui < -0.5 || zi < -0.5 || ui > uImgSize.x - 0.5 || zi > uImgSize.y - 0.5) { outColor = vec4(0.0); return; }
  if (uFlip.x) ui = uImgSize.x - 1.0 - ui;
  if (uFlip.y) zi = uImgSize.y - 1.0 - zi;
  vec2 c = (vec2(uDims.xy) - 1.0) * 0.5;
  float radius = length(c) + 1.0;
  float w = uImgSize.x;
  float u = ((ui - (w - 1.0) * 0.5) / max(w - 1.0, 1.0)) * radius * 2.0;
  vec2 viewDir = vec2(sin(uTheta), cos(uTheta));
  vec2 uDir = vec2(cos(uTheta), -sin(uTheta));
  int steps = int(ceil(radius * 2.0));
  float mx = 0.0;
  for (int s = 0; s <= 4096; s++) {
    if (s > steps) break;
    float t = -radius + 2.0 * radius * float(s) / float(steps);
    vec2 xy = c + u * uDir + t * viewDir;
    if (xy.x < 0.0 || xy.y < 0.0 || xy.x > float(uDims.x) - 1.0 || xy.y > float(uDims.y) - 1.0) continue;
    float val;
    if (sampleVol(vec3(xy, zi), val) && val > mx) mx = val;
  }
  shade(mx, true);
}`;

interface Program {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

export interface GlLayer {
  volume: VoxelGrid;
  w2v: WorldToVoxel;
  display: LayerDisplay;
}

export interface PlaneTarget {
  /** Device pixels. */
  width: number;
  height: number;
  world0: Vec3;
  worldDx: Vec3;
  worldDy: Vec3;
}

export interface MipTarget {
  width: number;
  height: number;
  /** MIP image coordinates of device pixel (0, 0) and per device pixel. */
  img0: [number, number];
  imgD: [number, number];
  imgSize: [number, number];
  thetaRad: number;
  flip: [boolean, boolean];
}

/** Renderer string of the WebGL implementation, if exposed. */
export function rendererName(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
}

function isSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver|microsoft basic/i.test(rendererName(gl));
}

const MAX_TEXTURE_BYTES = 1536 * 1024 * 1024;

export class GlRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private plane: Program;
  private mip: Program;
  private textures = new Map<ArrayLike<number>, { tex: WebGLTexture; bytes: number; used: number }>();
  private luts = new Map<ColorLut, WebGLTexture>();
  private frame = 0;
  private max3d: number;
  lost = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.max3d = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
    const uniforms = ["uVol", "uDims", "uNearest", "uLut", "uWindow", "uOpacity", "uBase", "uHeight"];
    this.plane = this.program(PLANE_FRAG, [...uniforms, "uWorld0", "uWorldDx", "uWorldDy", "uW2V", "uW2VOrigin"]);
    this.mip = this.program(MIP_FRAG, [...uniforms, "uImg0", "uImgD", "uImgSize", "uTheta", "uFlip"]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.plane, this.mip]) {
      const loc = gl.getAttribLocation(p.prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  private static instance: GlRenderer | null | undefined;

  /** Shared renderer, or null when WebGL2 is unavailable (CPU fallback). */
  static get(): GlRenderer | null {
    if (GlRenderer.instance !== undefined) return GlRenderer.instance?.lost ? null : GlRenderer.instance;
    try {
      if (typeof document === "undefined") return (GlRenderer.instance = null);
      // ?renderer=cpu forces the CPU path (comparison, troubleshooting).
      if (typeof location !== "undefined" && /[?&]renderer=cpu\b/.test(location.search)) return (GlRenderer.instance = null);
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      // Software rasterizers (SwiftShader, llvmpipe, …: VMs, remote desktops) are slower than the CPU
      // path; use them only when forced with ?renderer=gpu.
      const forced = typeof location !== "undefined" && /[?&]renderer=gpu\b/.test(location.search);
      if (gl && !forced && isSoftwareRenderer(gl)) {
        GlRenderer.instance = null;
        return null;
      }
      GlRenderer.instance = gl ? new GlRenderer(canvas, gl) : null;
    } catch {
      GlRenderer.instance = null;
    }
    return GlRenderer.instance;
  }

  private program(frag: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(prog)}`);
    return { prog, loc: Object.fromEntries(uniforms.map((u) => [u, gl.getUniformLocation(prog, u)])) };
  }

  /** Whether all volumes fit the GPU limits (otherwise the CPU path is used). */
  canHost(volumes: VoxelGrid[]): boolean {
    if (this.lost) return false;
    let bytes = 0;
    for (const v of volumes) {
      if (v.nx > this.max3d || v.ny > this.max3d || v.nz > this.max3d) return false;
      bytes += v.nx * v.ny * v.nz * 4;
    }
    return bytes <= MAX_TEXTURE_BYTES;
  }

  private texture(v: VoxelGrid): WebGLTexture {
    const gl = this.gl;
    const hit = this.textures.get(v.data);
    if (hit) {
      hit.used = this.frame;
      return hit.tex;
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const n = v.nx * v.ny * v.nz;
    const data = v.data instanceof Float32Array && v.data.length === n ? v.data : Float32Array.from({ length: n }, (_, i) => v.data[i]);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, v.nx, v.ny, v.nz, 0, gl.RED, gl.FLOAT, data);
    this.textures.set(v.data, { tex, bytes: n * 4, used: this.frame });
    this.evict();
    return tex;
  }

  /** Frees textures not used recently while above the memory budget. */
  private evict() {
    let total = 0;
    for (const t of this.textures.values()) total += t.bytes;
    if (total <= MAX_TEXTURE_BYTES) return;
    const old = [...this.textures.entries()].filter(([, t]) => t.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key, t] of old) {
      if (total <= MAX_TEXTURE_BYTES) break;
      this.gl.deleteTexture(t.tex);
      this.textures.delete(key);
      total -= t.bytes;
    }
  }

  /** Drops textures of volumes that are no longer shown anywhere (call with all currently shown volumes). */
  retain(volumes: VoxelGrid[]) {
    const keep = new Set(volumes.map((v) => v.data));
    for (const [key, t] of this.textures)
      if (!keep.has(key)) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(key);
      }
  }

  private lut(lut: ColorLut): WebGLTexture {
    const gl = this.gl;
    let tex = this.luts.get(lut);
    if (tex) return tex;
    const rgb = lutTable(lut);
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[4 * i] = rgb[3 * i];
      rgba[4 * i + 1] = rgb[3 * i + 1];
      rgba[4 * i + 2] = rgb[3 * i + 2];
      rgba[4 * i + 3] = 255;
    }
    tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    this.luts.set(lut, tex);
    return tex;
  }

  private begin(width: number, height: number) {
    const gl = this.gl;
    this.frame++;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // Same as the CPU composite: rgb += (src − rgb)·α; keep the destination opaque.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  }

  private bindLayer(p: Program, l: GlLayer, base: boolean) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texture(l.volume));
    gl.uniform1i(p.loc.uVol, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lut(l.display.lut));
    gl.uniform1i(p.loc.uLut, 1);
    gl.uniform3i(p.loc.uDims, l.volume.nx, l.volume.ny, l.volume.nz);
    gl.uniform2f(p.loc.uWindow, l.display.window[0], l.display.window[1]);
    gl.uniform1f(p.loc.uOpacity, Math.min(1, Math.max(0, l.display.opacity)));
    gl.uniform1i(p.loc.uBase, base ? 1 : 0);
    gl.uniform1i(p.loc.uNearest, l.display.nearest ? 1 : 0);
  }

  /** Renders a plane view (layers bottom first, already filtered to visible ones). */
  renderPlane(layers: GlLayer[], t: PlaneTarget): HTMLCanvasElement {
    const gl = this.gl;
    this.begin(t.width, t.height);
    const p = this.plane;
    gl.useProgram(p.prog);
    gl.uniform3fv(p.loc.uWorld0, t.world0);
    gl.uniform3fv(p.loc.uWorldDx, t.worldDx);
    gl.uniform3fv(p.loc.uWorldDy, t.worldDy);
    gl.uniform1f(p.loc.uHeight, t.height);
    layers.forEach((l, i) => {
      if (i > 0 && l.display.opacity <= 0) return;
      this.bindLayer(p, l, i === 0);
      const m = l.w2v.m;
      // GLSL mat3 is column-major: pass the transpose of the row-major m.
      gl.uniformMatrix3fv(p.loc.uW2V, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
      gl.uniform3fv(p.loc.uW2VOrigin, l.w2v.origin);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    return this.canvas;
  }

  /** Renders the rotating MIP of one layer. */
  renderMip(layer: GlLayer, t: MipTarget): HTMLCanvasElement {
    const gl = this.gl;
    this.begin(t.width, t.height);
    const p = this.mip;
    gl.useProgram(p.prog);
    this.bindLayer(p, layer, true);
    gl.uniform1f(p.loc.uHeight, t.height);
    gl.uniform2f(p.loc.uImg0, t.img0[0], t.img0[1]);
    gl.uniform2f(p.loc.uImgD, t.imgD[0], t.imgD[1]);
    gl.uniform2f(p.loc.uImgSize, t.imgSize[0], t.imgSize[1]);
    gl.uniform1f(p.loc.uTheta, t.thetaRad);
    gl.uniform2i(p.loc.uFlip, t.flip[0] ? 1 : 0, t.flip[1] ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}
