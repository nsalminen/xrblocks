import * as THREE from 'three';

const SPHERE_RADIUS = 50;

/**
 * Full-surround volcanic landscape for "walk-in" mode.
 * Inverted sphere: smoky red/orange sky with ash plume + lightning,
 * distant volcano silhouette with glowing crater, rising ember columns
 * in 3D, lava bombs arcing past, glowing magma ground beneath.
 */
export class LavaImmersive extends THREE.Object3D {
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
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i); float b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x)
                                + (d - b) * u.x * u.y;
        }
        float noise3(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
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
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
          return v;
        }
        float fbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.07; a *= 0.5; }
          return v;
        }

        // Volcano silhouette mask in cylindrical (azimuth, altitude) coords.
        // Returns mask 0..1 for "inside cone", plus crater glow factor.
        vec2 volcanoAt(vec3 rd, float az0, float dist, float t) {
          float az = atan(rd.x, -rd.z);
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          // Center the volcano at az0.
          float dAz = az - az0;
          if (dAz > 3.14159) dAz -= 6.28318;
          if (dAz < -3.14159) dAz += 6.28318;
          // Distance scales the cone size.
          float coneW = 0.18 / dist;
          float coneTop = 0.22 / dist;
          // Cone profile: triangular.
          float dxNorm = abs(dAz) / coneW;
          float topAlt = coneTop * (1.0 - dxNorm);
          // Add jagged top noise.
          float jagged = (noise(vec2(dAz * 50.0, t * 0.05)) - 0.5) * 0.012;
          topAlt += jagged;
          float mask = step(alt, topAlt) * step(0.0, alt) * step(dxNorm, 1.0);
          // Crater glow: bright top center.
          float crater = exp(-dxNorm * 8.0)
                       * smoothstep(coneTop * 0.5, coneTop, alt) * mask;
          return vec2(mask, crater);
        }

        // Distant ash plume rising from volcano top: animated noise.
        vec3 ashPlume(vec3 rd, float az0, float dist, float t) {
          float az = atan(rd.x, -rd.z);
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          float dAz = az - az0;
          if (dAz > 3.14159) dAz -= 6.28318;
          if (dAz < -3.14159) dAz += 6.28318;
          float plumeW = 0.30 / dist;
          float plumeBase = 0.22 / dist;
          if (alt < plumeBase || abs(dAz) > plumeW) return vec3(0.0);
          float h = (alt - plumeBase) / 0.6;
          float widthFactor = mix(0.4, 1.4, smoothstep(0.0, 0.7, h));
          float dxNorm = abs(dAz) / (plumeW * widthFactor);
          if (dxNorm > 1.0) return vec3(0.0);
          float density = fbm(vec2(dAz * 30.0 - t * 0.15, h * 4.0 - t * 0.3));
          density *= (1.0 - dxNorm) * smoothstep(0.0, 0.2, h)
                   * smoothstep(1.0, 0.6, h);
          // Ash is dark grey with orange underlit.
          vec3 dark = vec3(0.10, 0.06, 0.08);
          vec3 lit = vec3(0.65, 0.30, 0.10);
          float underlight = smoothstep(0.4, 0.0, h);
          vec3 ash = mix(dark, lit, underlight);
          return ash * density * 0.9;
        }

        float raySphere(vec3 ro, vec3 rd, vec3 c, float rad) {
          vec3 oc = ro - c;
          float b = dot(oc, rd);
          float d = b * b - (dot(oc, oc) - rad * rad);
          if (d < 0.0) return -1.0;
          return -b - sqrt(d);
        }

        // Rising ember columns: small fast glowing particles around user.
        vec3 embers(vec3 ro, vec3 rd, float t) {
          vec3 col = vec3(0.0);
          for (int i = 0; i < 14; i++) {
            float fi = float(i);
            float seed = fi * 9.7;
            // Column base xz (close to user).
            vec2 base = vec2(sin(seed) * 4.0 + cos(seed * 1.7) * 2.5,
                             cos(seed * 0.9) * 4.0 + sin(seed * 1.3) * 2.5);
            // Ember height cycles upward fast.
            float eh = mod(t * 2.5 + seed * 5.0, 4.0);
            vec3 pos = vec3(base.x + sin(eh * 2.0 + seed) * 0.2,
                            -1.0 + eh,
                            base.y + cos(eh * 2.0 + seed) * 0.2);
            vec3 oc = pos - ro;
            float along = dot(oc, rd);
            if (along < 0.3 || along > 12.0) continue;
            vec3 proj = ro + rd * along;
            float d = length(pos - proj);
            float r = 0.06;
            float spark = smoothstep(r, 0.0, d);
            float pulse = 0.7 + 0.3 * sin(eh * 8.0 + seed);
            float fade = (1.0 - eh / 4.0) / (1.0 + along * 0.2);
            col += vec3(1.00, 0.55, 0.15) * spark * pulse * fade * 1.2;
          }
          return col;
        }

        // Lava bombs: large glowing spheres on parabolic trajectories.
        vec3 lavaBombs(vec3 ro, vec3 rd, float t) {
          vec3 col = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float seed = fi * 23.7;
            float cycle = mod(t * 0.4 + seed, 5.0);
            // Parabolic path from volcano direction toward user/horizon.
            float az0 = 2.5 + sin(seed) * 0.8;
            vec3 origin = vec3(sin(az0) * 25.0, 6.0, -cos(az0) * 25.0);
            vec3 dir = normalize(vec3(-sin(az0) * 0.6, 0.0, cos(az0) * 0.6)
                               + vec3(sin(seed * 3.7) * 0.3, 0.0,
                                      cos(seed * 3.7) * 0.3));
            vec3 pos = origin + dir * cycle * 6.0
                     + vec3(0.0, cycle * 4.0 - cycle * cycle * 1.2, 0.0);
            vec3 oc = pos - ro;
            float along = dot(oc, rd);
            if (along < 0.5 || along > 30.0) continue;
            vec3 proj = ro + rd * along;
            float d = length(pos - proj);
            float r = 0.18;
            float bomb = smoothstep(r, 0.0, d);
            float halo = smoothstep(r * 6.0, r, d) * 0.25;
            float fade = 1.0 / (1.0 + along * 0.08);
            col += vec3(1.00, 0.50, 0.10) * (bomb * 1.5 + halo) * fade;
            // Trailing smoke
            for (int j = 1; j <= 3; j++) {
              float fj = float(j);
              vec3 trailPos = pos - dir * fj * 0.4
                            - vec3(0.0, fj * 0.1, 0.0);
              vec3 oc2 = trailPos - ro;
              float a2 = dot(oc2, rd);
              if (a2 < 0.5 || a2 > 30.0) continue;
              vec3 pj = ro + rd * a2;
              float dj = length(trailPos - pj);
              float trail = smoothstep(r * 0.7, 0.0, dj) * 0.18 / fj;
              col += vec3(0.30, 0.18, 0.18) * trail;
            }
          }
          return col;
        }

        void main() {
          vec3 rd = normalize(uViewRotation * vWorldDir);
          vec3 ro = uCamLocal;
          float t = uTime;

          // ---- Smoky red sky gradient ----
          float skyT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 lowSky = vec3(0.95, 0.45, 0.15);
          vec3 midSky = vec3(0.55, 0.15, 0.10);
          vec3 highSky = vec3(0.18, 0.04, 0.12);
          vec3 col = mix(lowSky, midSky, smoothstep(0.45, 0.65, skyT));
          col = mix(col, highSky, smoothstep(0.65, 1.0, skyT));

          // Drifting ash clouds (3D noise based on direction).
          float ash = fbm3(rd * 2.5 + vec3(t * 0.05, 0.0, t * 0.04));
          ash *= smoothstep(0.0, 0.4, rd.y);
          col = mix(col, vec3(0.10, 0.05, 0.10), ash * 0.55);

          // Distant glowing sparks high in the sky.
          if (rd.y > 0.0) {
            // Octahedral mapping for seamless grid.
            vec3 a = abs(rd);
            float sum = a.x + a.y + a.z;
            vec2 oct = rd.xz / sum;
            if (rd.y < 0.0) {
              oct = (1.0 - abs(oct.yx)) * vec2(oct.x >= 0.0 ? 1.0 : -1.0,
                                                oct.y >= 0.0 ? 1.0 : -1.0);
            }
            vec2 uv = oct * 0.5 + 0.5;
            float sparks = 0.0;
            for (int k = 0; k < 1; k++) {
              vec2 g = floor(uv * 80.0);
              vec2 f = fract(uv * 80.0);
              float h = hash(g);
              if (h > 0.992) {
                vec2 jit = vec2(hash(g + 1.7), hash(g + 7.3)) * 0.6 + 0.2;
                sparks = smoothstep(0.05, 0.0, length(f - jit));
              }
            }
            col += vec3(1.0, 0.85, 0.55) * sparks * 0.6;
          }

          // ---- Distant volcano silhouettes (3 around the horizon) ----
          float dist1 = 1.4;
          vec2 v1 = volcanoAt(rd, 2.4, dist1, t);
          if (v1.x > 0.5) {
            // Volcano body: dark with subtle texture.
            float az = atan(rd.x, -rd.z);
            vec3 vbody = mix(vec3(0.05, 0.02, 0.04),
                             vec3(0.18, 0.08, 0.06),
                             fbm(vec2(az * 30.0, asin(rd.y) * 30.0)));
            // Add lava streaks down the slope.
            float streak = fbm(vec2(az * 80.0, -asin(rd.y) * 6.0 + t * 0.4));
            vec3 lava = vec3(1.00, 0.40, 0.05);
            float streakMask = smoothstep(0.7, 0.85, streak)
                             * smoothstep(0.0, 0.06, asin(rd.y));
            vbody = mix(vbody, lava, streakMask * 0.8);
            // Crater glow (bright orange at top).
            vbody = mix(vbody, vec3(1.0, 0.7, 0.2), v1.y * 1.4);
            col = vbody;
          }
          // Smaller volcano on opposite side.
          vec2 v2 = volcanoAt(rd, -1.8, 2.2, t);
          if (v2.x > 0.5) {
            float az = atan(rd.x, -rd.z);
            vec3 vbody = mix(vec3(0.04, 0.02, 0.03),
                             vec3(0.14, 0.06, 0.05),
                             fbm(vec2(az * 30.0, asin(rd.y) * 30.0)));
            vbody = mix(vbody, vec3(1.0, 0.65, 0.18), v2.y * 1.2);
            col = vbody;
          }

          // Ash plumes rising from the main volcano.
          col += ashPlume(rd, 2.4, dist1, t);

          // ---- Lava bombs (raymarched glowing spheres) ----
          col += lavaBombs(ro, rd, t);

          // ---- Embers ----
          col += embers(ro, rd, t);

          // ---- Lava ground beneath user (looking down) ----
          if (rd.y < -0.05) {
            float gt = -ro.y / rd.y;
            if (gt > 0.0 && gt < 60.0) {
              vec3 gp = ro + rd * gt;
              // Solidified crust with hot crack pattern.
              float crust = fbm(gp.xz * 0.4);
              float cracks = fbm(gp.xz * 1.5 + t * 0.05);
              float crackMask = smoothstep(0.55, 0.65, cracks)
                              - smoothstep(0.65, 0.75, cracks);
              vec3 ground = mix(vec3(0.04, 0.02, 0.02),
                                vec3(0.15, 0.08, 0.06), crust);
              vec3 crackCol = vec3(1.00, 0.45, 0.10)
                            * (0.7 + 0.3 * sin(t * 3.0 + dot(gp.xz, vec2(2.0))));
              ground = mix(ground, crackCol, crackMask * 1.2);
              float fog = smoothstep(0.0, 25.0, gt);
              col = mix(ground, col, fog * 0.7);
            }
          }

          // ---- Lightning flashes in ash plume ----
          {
            float beat = floor(t * 0.5);
            float flashSeed = hash(vec2(beat, 31.7));
            if (flashSeed > 0.7) {
              float local = fract(t * 0.5);
              float flash = exp(-local * 12.0) * smoothstep(0.0, 0.04, local);
              vec3 flashDir = normalize(vec3(sin(2.4) * 0.7, 0.5,
                                             -cos(2.4) * 0.7));
              float ang = max(dot(rd, flashDir), 0.0);
              col += vec3(0.95, 0.85, 1.00) * smoothstep(0.85, 1.0, ang)
                   * flash * 1.6;
            }
          }

          // Atmospheric glow tint (warm lift).
          col = mix(col, vec3(0.55, 0.20, 0.10), 0.08);

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
