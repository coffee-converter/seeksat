// lib/map/footprint-layer.mjs - the focus footprint fill on the globe, drawn by
// a MapLibre custom WebGL2 layer as a true spherical cap. MapLibre's tiles stop
// at 85.05 degrees, so the GeoJSON fill leaves a bite near the poles; this
// layer does not. On the flat map (and once the globe starts to flatten at
// high zoom) the GeoJSON fill draws instead.

import { capMesh } from './cap-mesh.mjs';
import { FOOTPRINT_FILL_OPACITY } from './overlays.mjs';

export const FOOTPRINT_GLOBE_LAYER = 'ss-footprint-globe';

/**
 * MapLibre's 'globe' projection is a full globe up to this zoom, then morphs
 * into Mercator by zoom 12 (projection_factory.ts in maplibre-gl 6.15).
 */
export const GLOBE_FULL_ZOOM = 11;

/**
 * True when the cap layer draws the footprint fill, false when the GeoJSON
 * fill does: only on a full globe, and only while the layer's shaders work.
 * The cap mesh is only valid on the sphere, so the globe's morph toward
 * Mercator hands back to the GeoJSON fill. Satellite's view
 * (vertical-perspective) is a sphere at every zoom.
 */
export function drawsGlobeCap({ view, zoom, failed = false }) {
  if (failed) return false;
  return view === 'satview' || (view === 'globe' && zoom <= GLOBE_FULL_ZOOM);
}

/** The mesh is rebuilt when the centre moves further than this (degrees). */
const MOVE_DEG = 0.01;
const RADIUS_EPS_DEG = 1e-6;
const A_POS = 0;

const wrapLon = (d) => d - 360 * Math.round(d / 360);

/** '#rgb' or '#rrggbb' to [r, g, b] in 0..1; white for anything else. */
function parseHex(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color ?? '');
  if (!m) return [1, 1, 1];
  const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

const FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`;

/** The vertex shader for one projection variant; projectTile does the globe and far-side clipping. */
const vertexSource = (shaderData) => `#version 300 es
${shaderData.define}
${shaderData.vertexShaderPrelude}
in vec2 a_pos;
void main() {
  gl_Position = projectTile(a_pos);
}`;

/**
 * The custom layer. setFootprint({ center: [lon, lat], radiusDeg, color })
 * or null; it repaints the map only when that changes what is drawn.
 * onFail is called once if the shaders do not compile or link.
 */
export function createFootprintLayer({ onFail } = {}) {
  let map = null;
  // variantName -> { program, uniforms } or null after a failure.
  const programs = new Map();
  let vao = null;
  let vertexBuffer = null;
  let indexBuffer = null;
  let mesh = null;
  let meshAt = null;
  let uploaded = false;
  let colorKey = null;
  let failed = false;
  // Reused every frame: no per-frame allocation.
  const color = new Float32Array(4);
  const mainMatrix = new Float32Array(16);
  const fallbackMatrix = new Float32Array(16);

  const repaint = () => map?.triggerRepaint();

  function fail(message) {
    if (!failed) {
      failed = true;
      console.error(`Globe footprint layer: ${message}`);
      onFail?.();
    }
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    fail(`shader did not compile: ${log}`);
    return null;
  }

  function programFor(gl, shaderData) {
    const key = shaderData.variantName;
    if (programs.has(key)) return programs.get(key);
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource(shaderData));
    const fs = vs && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    let entry = null;
    if (vs && fs) {
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, A_POS, 'a_pos');
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const at = (name) => gl.getUniformLocation(program, name);
        entry = {
          program,
          uniforms: {
            matrix: at('u_projection_matrix'),
            tileMercatorCoords: at('u_projection_tile_mercator_coords'),
            clippingPlane: at('u_projection_clipping_plane'),
            transition: at('u_projection_transition'),
            fallbackMatrix: at('u_projection_fallback_matrix'),
            color: at('u_color'),
          },
        };
      } else {
        fail(`program did not link: ${gl.getProgramInfoLog(program)}`);
        gl.deleteProgram(program);
      }
    }
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    programs.set(key, entry);
    return entry;
  }

  function bindMesh(gl) {
    if (!vao) {
      vao = gl.createVertexArray();
      vertexBuffer = gl.createBuffer();
      indexBuffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(A_POS);
      gl.vertexAttribPointer(A_POS, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      uploaded = false;
    } else {
      gl.bindVertexArray(vao);
    }
    if (!uploaded) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
      uploaded = true;
    }
  }

  function free(gl) {
    if (gl) {
      for (const entry of programs.values()) if (entry) gl.deleteProgram(entry.program);
      if (vao) gl.deleteVertexArray(vao);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
    }
    programs.clear();
    vao = vertexBuffer = indexBuffer = null;
    uploaded = false;
  }

  return {
    id: FOOTPRINT_GLOBE_LAYER,
    type: 'custom',
    renderingMode: '2d',

    onAdd(m) {
      map = m;
    },

    onRemove(_m, gl) {
      free(gl);
      map = null;
    },

    setFootprint(f) {
      if (!f) {
        if (mesh) {
          mesh = meshAt = null;
          repaint();
        }
        return;
      }
      const [lon, lat] = f.center;
      let changed = false;
      if (f.color !== colorKey) {
        colorKey = f.color;
        const [r, g, b] = parseHex(f.color);
        const a = FOOTPRINT_FILL_OPACITY;
        color.set([r * a, g * a, b * a, a]);
        changed = true;
      }
      const moved = !meshAt
        || Math.abs(lat - meshAt.lat) > MOVE_DEG
        || Math.abs(wrapLon(lon - meshAt.lon)) > MOVE_DEG
        || Math.abs(f.radiusDeg - meshAt.radiusDeg) > RADIUS_EPS_DEG;
      if (moved) {
        mesh = capMesh([lon, lat], f.radiusDeg);
        meshAt = { lon, lat, radiusDeg: f.radiusDeg };
        uploaded = false;
        changed = true;
      }
      if (changed) repaint();
    },

    render(gl, args) {
      if (!mesh || failed) return;
      const data = args.defaultProjectionData;
      // A full globe only: the mesh is not valid on the way to Mercator.
      if (!(data.projectionTransition >= 1)) return;
      const entry = programFor(gl, args.shaderData);
      if (!entry) return;
      const u = entry.uniforms;
      gl.useProgram(entry.program);
      mainMatrix.set(data.mainMatrix);
      fallbackMatrix.set(data.fallbackMatrix);
      gl.uniformMatrix4fv(u.matrix, false, mainMatrix);
      gl.uniformMatrix4fv(u.fallbackMatrix, false, fallbackMatrix);
      const t = data.tileMercatorCoords;
      gl.uniform4f(u.tileMercatorCoords, t[0], t[1], t[2], t[3]);
      const c = data.clippingPlane;
      gl.uniform4f(u.clippingPlane, c[0], c[1], c[2], c[3]);
      gl.uniform1f(u.transition, data.projectionTransition);
      gl.uniform4fv(u.color, color);
      bindMesh(gl);
      // Set here rather than trusted from MapLibre: no culling, and
      // premultiplied alpha blending as MapLibre's own fills use.
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    },
  };
}
