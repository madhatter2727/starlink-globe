import * as THREE from 'three';

// All satellites in one draw call: a Points cloud with per-point color and size.
export function createSatPoints(n) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n).fill(1);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      pr: { value: Math.min(devicePixelRatio, 2) },
      scale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float size; attribute vec3 color;
      uniform float pr, scale;
      varying vec3 vC;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * scale * pr * 9.0 / -mv.z, 1.2 * pr, 24.0 * pr);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC * (0.55 + 0.9 * core), smoothstep(0.5, 0.25, d));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return { points, pos, col, size, geometry: g, material: m };
}
