import * as THREE from 'three';

const SPHERE_RADIUS = 50;
const IMMERSIVE_SCALE = 4.0;

/**
 * Full-surround twilight forest for "walk-in" mode.
 * Inverted sphere: twilight sky overhead, ring of pine silhouettes
 * around the user, fireflies drifting in 3D, distant lightning + moon.
 */
export class ForestImmersive extends THREE.Object3D {
  constructor() {
    super();
    this._time = 0;
    this._buildSphere();
  }

  show(portalWorldMatrix) {
    this._entryMatrix = portalWorldMatrix.clone();
    this._entryMatrixInv = portalWorldMatrix.clone().invert();
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  update(dt, camera) {
    if (!this.visible) return;
    this._time += dt;

    const mat = this._sphere.material;
    mat.uniforms.uTime.value = this._time;

    if (camera) {
      const camWorld = camera.getWorldPosition(new THREE.Vector3());
      const camLocal = camWorld.clone().applyMatrix4(this._entryMatrixInv);
      mat.uniforms.uCamLocal.value.copy(camLocal);

      const portalQuat = new THREE.Quaternion().setFromRotationMatrix(
        this._entryMatrix
      );
      const portalQuatInv = portalQuat.clone().invert();
      const camQuat = camera.getWorldQuaternion(new THREE.Quaternion());
      const localQuat = portalQuatInv.multiply(camQuat);
      const rotMat4 = new THREE.Matrix4().makeRotationFromQuaternion(localQuat);
      mat.uniforms.uViewRotation.value.setFromMatrix4(rotMat4);
    }

    if (camera) {
      camera.getWorldPosition(this.position);
    }
  }

  _buildSphere() {
    const geom = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 32);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: {value: 0},
        uCamLocal: {value: new THREE.Vector3(0, 0, 1.6)},
        uViewRotation: {value: new THREE.Matrix3()},
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform vec3 uCamLocal;
        uniform mat3 uViewRotation;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float hash3(vec3 p) {
          p = fract(p * vec3(123.34, 456.21, 789.53));
          p += dot(p, p.yzx + 45.32);
          return fract(p.x * p.y * p.z);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x)
                                + (d - b) * u.x * u.y;
        }
        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash3(i), hash3(i + vec3(1,0,0)), u.x),
                mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), u.x), u.y),
            mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), u.x),
                mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), u.x), u.y),
            u.z);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }
        float fbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise3(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }

        float starsLayer(vec3 rd, float density, float threshold) {
          vec3 a = abs(rd);
          float sum = a.x + a.y + a.z;
          vec2 oct = rd.xz / sum;
          if (rd.y < 0.0) {
            oct = (1.0 - abs(oct.yx)) * vec2(oct.x >= 0.0 ? 1.0 : -1.0,
                                              oct.y >= 0.0 ? 1.0 : -1.0);
          }
          vec2 uv = oct * 0.5 + 0.5;
          vec2 g = floor(uv * density);
          vec2 f = fract(uv * density);
          float h = hash(g);
          if (h < threshold) return 0.0;
          vec2 jitter = vec2(hash(g + 1.7), hash(g + 7.3)) * 0.6 + 0.2;
          float d = length(f - jitter);
          return smoothstep(0.05, 0.0, d);
        }

        // Tree silhouette in cylindrical (azimuth, height) space.
        // Returns ~1 inside trunk/canopy.
        float treeAt(float az, float y, float seed, float dist) {
          // Trunk centered at azimuth 0, with width that tapers up.
          float trunkW = 0.012 * (1.0 - smoothstep(0.0, 0.85, y) * 0.55);
          float trunk = step(abs(az), trunkW)
                      * step(0.0, y) * step(y, 0.85);
          // Pine canopy: triangular, broadest at base.
          float canopyTop = 1.05 + hash(vec2(seed, 1.7)) * 0.20;
          float canopyBase = 0.35;
          float canopyH = canopyTop - canopyBase;
          float canopySlope = (canopyTop - y) / canopyH;
          float canopyW = 0.085 * canopySlope;
          float canopy = step(abs(az), canopyW)
                       * step(canopyBase, y) * step(y, canopyTop);
          // Add slight noise jitter to canopy edge.
          float edgeNoise = (hash(vec2(seed * 13.7, floor(y * 60.0))) - 0.5) * 0.012;
          canopy *= step(abs(az) + edgeNoise, canopyW);
          return clamp(trunk + canopy, 0.0, 1.0);
        }

        // Ring of trees around the user.
        // azimuth in [-PI, PI], altitude in radians (0 = horizon).
        // Returns combined silhouette mask (0..1), output greyscale tint.
        vec3 forestRing(vec3 rd) {
          float az = atan(rd.x, -rd.z);    // azimuth, 0 = forward
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          // Project to cylindrical (treeY around 0..1.2 maps to alt 0..~0.5).
          // Each tree occupies a slice of azimuth space.
          float density = 28.0;            // trees around full circle
          float slice = az * density / (2.0 * 3.14159265);
          float cellIdx = floor(slice);
          float local = fract(slice) - 0.5; // azimuth-within-slice in [-0.5, 0.5]
          float seed = cellIdx + 17.0;
          // Each tree gets a random horizontal jitter and depth (size).
          float jitter = (hash(vec2(seed, 3.1)) - 0.5) * 0.5;
          float distVar = 0.65 + hash(vec2(seed, 5.7)) * 0.7; // 0.65..1.35

          // Map altitude to "tree height coord" (0 at horizon, ~1 at top of canopy).
          // Closer trees rise higher in the FOV.
          float y = alt / (0.32 / distVar);
          float az2 = local * 0.18 * distVar;

          float m = treeAt(az2, y, seed, distVar);
          // Slight neighbour overlap for variety.
          float seedR = cellIdx + 18.0;
          float jitterR = (hash(vec2(seedR, 3.1)) - 0.5) * 0.5;
          float distR = 0.65 + hash(vec2(seedR, 5.7)) * 0.7;
          float yR = alt / (0.32 / distR);
          float az2R = (local - 1.0) * 0.18 * distR;
          float mR = treeAt(az2R, yR, seedR, distR);

          float mask = max(m, mR);
          // Color: very dark, slight green
          vec3 trunkCol = vec3(0.020, 0.025, 0.015);
          // Backlit edge: faint cool rim from sky behind.
          float rim = (1.0 - mask) * 0.0;
          return mix(vec3(0.0), trunkCol, mask) + vec3(0.0, rim * 0.04, rim * 0.06);
        }

        // Fireflies: cloud of point lights in a 3D volume around the user.
        vec3 fireflies(vec3 ro, vec3 rd, float t) {
          vec3 col = vec3(0.0);
          // Step along ray for a few segments to find close fireflies.
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float seed = fi * 17.7;
            // Position drifts slowly in 3D.
            vec3 pos = vec3(
              sin(t * 0.4 + seed) * 6.0 + cos(t * 0.13 + seed * 1.3) * 3.0,
              0.4 + sin(t * 0.7 + seed * 0.9) * 0.6 + 0.4,
              cos(t * 0.5 + seed * 1.1) * 6.0 + sin(t * 0.17 + seed) * 3.0);
            // Closest distance from ray to fly.
            vec3 oc = pos - ro;
            float along = dot(oc, rd);
            if (along < 0.2 || along > 12.0) continue;
            vec3 proj = ro + rd * along;
            float d = length(pos - proj);
            float pulse = 0.6 + 0.4 * sin(t * 4.0 + seed * 7.0);
            float intensity = smoothstep(0.08, 0.0, d) * pulse;
            // Distance falloff
            intensity *= 1.0 / (1.0 + along * 0.3);
            col += vec3(0.85, 1.00, 0.45) * intensity * 0.8;
          }
          return col;
        }

        float raySphere(vec3 ro, vec3 rd, vec3 c, float rad) {
          vec3 oc = ro - c;
          float b = dot(oc, rd);
          float d = b * b - (dot(oc, oc) - rad * rad);
          if (d < 0.0) return -1.0;
          return -b - sqrt(d);
        }

        void main() {
          vec3 rd = normalize(uViewRotation * vWorldDir);
          vec3 ro = uCamLocal;

          // ---- Twilight sky gradient ----
          float skyT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyTop = vec3(0.04, 0.03, 0.16);
          vec3 skyMid = vec3(0.10, 0.07, 0.28);
          vec3 skyLow = vec3(0.28, 0.16, 0.32);
          vec3 col = mix(skyLow, skyMid, smoothstep(0.45, 0.65, skyT));
          col = mix(col, skyTop, smoothstep(0.65, 1.0, skyT));

          // Crescent moon high in the sky.
          {
            vec3 moonDir = normalize(vec3(0.45, 0.75, -0.55));
            float ang = dot(rd, moonDir);
            float halo = smoothstep(0.985, 1.0, ang);
            float disc = smoothstep(0.997, 0.9985, ang);
            // Crescent: subtract offset disc.
            vec3 biteDir = normalize(moonDir + vec3(0.04, 0.02, 0.0));
            float bite = smoothstep(0.997, 0.9985, dot(rd, biteDir));
            col += vec3(0.85, 0.85, 1.00) * halo * 0.5;
            col += vec3(1.00, 1.00, 0.95) * max(disc - bite, 0.0) * 1.3;
          }

          // Faint stars (only above horizon).
          if (rd.y > 0.0) {
            float s1 = starsLayer(rd, 80.0, 0.985);
            float s2 = starsLayer(rd, 180.0, 0.992);
            col += vec3(0.85, 0.90, 1.00) * (s1 * 0.6 + s2 * 0.45)
                 * smoothstep(0.0, 0.4, rd.y);
          }

          // Distant lightning flashes on the horizon (occasional).
          {
            float beat = floor(uTime * 0.4);
            float flashSeed = hash(vec2(beat, 11.3));
            if (flashSeed > 0.78) {
              float local = fract(uTime * 0.4);
              float flash = exp(-local * 8.0) * smoothstep(0.0, 0.05, local);
              float dirSeed = hash(vec2(beat, 23.7));
              vec3 lightDir = normalize(vec3(
                  sin(dirSeed * 6.28) * 0.9, 0.05, -cos(dirSeed * 6.28) * 0.9));
              float ang = dot(rd, lightDir);
              float glow = smoothstep(0.6, 1.0, ang) * smoothstep(-0.05, 0.15, rd.y);
              col += vec3(0.55, 0.65, 1.00) * glow * flash * 0.8;
            }
          }

          // ---- Drifting mist (low fog) ----
          float mistY = smoothstep(0.15, -0.1, rd.y); // strongest near horizon and below
          float mist = fbm3(rd * 4.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
          col = mix(col, vec3(0.12, 0.10, 0.20), mistY * mist * 0.55);

          // ---- Ring of pine trees around the user ----
          // Trees occupy lower hemisphere (rd.y < ~0.5).
          if (rd.y < 0.6) {
            vec3 forest = forestRing(rd);
            // Only apply where forest is "in front" of sky band.
            float forestMask = max(max(forest.r, forest.g), forest.b);
            col = mix(col, forest, smoothstep(0.6, 0.5, rd.y));
          }

          // ---- Ground: very dark forest floor ----
          if (rd.y < 0.0) {
            // Raycast ray down to y=0 to find ground hit, then noise it.
            float t = -ro.y / rd.y;
            if (t > 0.0 && t < 200.0) {
              vec3 gp = ro + rd * t;
              float gn = fbm(gp.xz * 0.4);
              vec3 ground = mix(vec3(0.03, 0.04, 0.02),
                                vec3(0.08, 0.07, 0.04), gn);
              // Distance fade into mist
              float fog = smoothstep(0.0, 25.0, t);
              col = mix(ground, col, fog * 0.7);
            }
          }

          // Fireflies (additive, in 3D).
          col += fireflies(ro, rd, uTime);

          // Subtle noise to break up bands.
          col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;

          // Tone-map.
          col = col / (col + vec3(1.0));
          col = pow(col, vec3(0.85));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this._sphere = new THREE.Mesh(geom, mat);
    this._sphere.renderOrder = -100;
    this._sphere.frustumCulled = false;
    this._sphere.raycast = () => {};
    this.add(this._sphere);
    this.visible = false;
  }
}
