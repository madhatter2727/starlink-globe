import * as THREE from 'three';

const loader = new THREE.TextureLoader();
function tex(url, srgb = true) {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createEarth(sunDir) {
  const group = new THREE.Group();

  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: tex('/textures/earth_day_4096.jpg') },
      nightMap: { value: tex('/textures/earth_night_4096.jpg') },
      dataMap: { value: tex('/textures/earth_bump_roughness_clouds_4096.jpg', false) },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap, nightMap, dataMap;
      uniform vec3 sunDir;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vPosW);
        float ndl = dot(N, sunDir);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        vec3 data = texture2D(dataMap, vUv).rgb;
        float clouds = smoothstep(0.15, 0.9, data.b);
        float ocean = 1.0 - smoothstep(0.2, 0.5, data.g);

        float dayMix = smoothstep(-0.08, 0.18, ndl);
        float light = clamp(ndl, 0.0, 1.0);
        vec3 dayCol = day * (0.08 + 1.05 * light);
        dayCol = mix(dayCol, vec3(1.0) * (0.06 + 1.0 * light), clouds * 0.85);
        // ocean glint
        vec3 H = normalize(sunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 60.0) * ocean * (1.0 - clouds) * light;
        dayCol += vec3(1.0, 0.92, 0.8) * spec * 0.6;

        vec3 nightCol = night * vec3(1.0, 0.82, 0.55) * 1.6 * (1.0 - clouds * 0.7);
        nightCol += day * 0.012;
        vec3 col = mix(nightCol, dayCol, dayMix);

        // atmospheric rim scattering
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float atmoLight = smoothstep(-0.25, 0.6, ndl);
        col += vec3(0.3, 0.55, 1.0) * fres * atmoLight * 0.9;
        // warm terminator band
        col += vec3(1.0, 0.5, 0.25) * fres * smoothstep(0.2, 0.0, abs(ndl)) * 0.12;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // Our textures are sRGB-decoded by three; output is converted by colorspace_fragment.
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), earthMat);
  group.add(earth);

  // Outer glow shell
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.06, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPosW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vec3 N = normalize(vNormalW);
          vec3 V = normalize(cameraPosition - vPosW);
          // Back-face shell: 0 at the shell edge, peaks at Earth's limb.
          float x = clamp(-dot(N, V) / 0.34, 0.0, 1.0);
          float i = pow(x, 3.0);
          float lit = smoothstep(-0.35, 0.45, dot(N, sunDir));
          vec3 c = vec3(0.3, 0.58, 1.0) * i * (0.12 + 1.1 * lit);
          gl_FragColor = vec4(c, i);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  group.add(atmo);

  return { group, earth };
}

export function createStars() {
  const n = 5000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(th) * 90, u * 90, r * Math.sin(th) * 90], i * 3);
    const b = Math.pow(Math.random(), 3) * 0.9 + 0.1;
    const tint = Math.random();
    col.set([b * (0.85 + 0.15 * tint), b * 0.9, b * (1.0 - 0.15 * tint) ], i * 3);
    size[i] = Math.random() < 0.02 ? 2.6 : 0.8 + Math.random() * 1.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { pr: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute float size; attribute vec3 color; varying vec3 vC; uniform float pr;
      void main() { vC = color; gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, smoothstep(0.5, 0.1, d)); }`,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Points(g, m);
}
