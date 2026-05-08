import * as THREE from 'three';

const SPHERE_RADIUS = 50;

/**
 * Full-surround neon city for "walk-in" mode.
 * Inverted sphere: smoggy purple sky with neon billboards, ring of
 * skyscraper silhouettes around the user with lit-window grids,
 * hover-cars streaking past as glowing line streaks, holographic billboard,
 * occasional rain streaks, wet street with neon reflections.
 */
export class CyberpunkImmersive extends THREE.Object3D {
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
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i); float b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x)
                                + (d - b) * u.x * u.y;
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
          return v;
        }

        // Building silhouette in cylindrical (azimuth, altitude) space.
        // Returns mask 0..1 plus window-light contribution (vec3).
        // azBase = building center azimuth; widthAz = half angular width.
        // heightAlt = top altitude; baseAlt = base altitude (usually 0).
        struct BuildingHit {
          float mask;
          vec3 windowCol;
          float windowMask;
          float topGlow;
        };

        BuildingHit buildingAt(vec3 rd, float azBase, float widthAz,
                                float heightAlt, float seed, float t) {
          BuildingHit h;
          h.mask = 0.0; h.windowCol = vec3(0.0);
          h.windowMask = 0.0; h.topGlow = 0.0;
          float az = atan(rd.x, -rd.z);
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          float dAz = az - azBase;
          if (dAz > 3.14159) dAz -= 6.28318;
          if (dAz < -3.14159) dAz += 6.28318;
          if (abs(dAz) > widthAz) return h;
          if (alt < 0.0 || alt > heightAlt) return h;
          h.mask = 1.0;
          // Local building UVs: (0..1 across, 0..1 up).
          float u = (dAz + widthAz) / (widthAz * 2.0);
          float v = alt / heightAlt;
          // Window grid.
          vec2 grid = vec2(8.0, 26.0);
          vec2 cell = vec2(u, v) * grid;
          vec2 fc = fract(cell);
          vec2 ic = floor(cell);
          float lit = step(0.55, hash(ic + seed));
          float win = step(0.18, fc.x) * step(fc.x, 0.82)
                    * step(0.20, fc.y) * step(fc.y, 0.85);
          float flickerOn = step(0.92, hash(ic + seed + 7.7));
          float flicker = mix(1.0,
              0.5 + 0.5 * sin(t * 6.0 + ic.x + ic.y),
              flickerOn);
          h.windowMask = lit * win * flicker;
          // Window color: warm yellow / cyan / magenta variations per building.
          float colorRoll = hash(vec2(seed, 33.7));
          vec3 wc;
          if (colorRoll < 0.5) {
            wc = vec3(1.00, 0.85, 0.50); // warm
          } else if (colorRoll < 0.75) {
            wc = vec3(0.20, 0.95, 1.00); // cyan
          } else {
            wc = vec3(1.00, 0.30, 0.80); // magenta
          }
          h.windowCol = wc;
          // Top antenna glow.
          float topZone = smoothstep(0.95, 1.0, v);
          h.topGlow = topZone * (0.5 + 0.5 * sin(t * 3.0 + seed * 7.0));
          return h;
        }

        // Pick the closest building among a few in the slot containing this
        // azimuth. We use 18 slots around the circle; each has its own params.
        BuildingHit cityRing(vec3 rd, float t) {
          BuildingHit hit;
          hit.mask = 0.0; hit.windowCol = vec3(0.0);
          hit.windowMask = 0.0; hit.topGlow = 0.0;
          float az = atan(rd.x, -rd.z);
          float density = 18.0;
          float slice = az * density / (2.0 * 3.14159265);
          float slotIdx = floor(slice);
          // Try this slot and its two neighbours so widths can overlap.
          for (int k = -1; k <= 1; k++) {
            float si = slotIdx + float(k);
            float seed = si + 19.0;
            float baseAz = (si + 0.5) * (2.0 * 3.14159265) / density;
            // Per-building param variation.
            float widthAz = 0.10 + hash(vec2(seed, 1.7)) * 0.06;
            float heightAlt = 0.18 + hash(vec2(seed, 2.7)) * 0.40;
            BuildingHit h = buildingAt(rd, baseAz, widthAz, heightAlt,
                                        seed, t);
            // The closer (taller) building visually overrides; we approximate
            // by picking the one that wrote the higher altitude top.
            if (h.mask > 0.5 && heightAlt > 0.0 && h.mask >= hit.mask) {
              if (hit.mask < 0.5 || heightAlt > 0.18) {
                hit = h;
              }
            }
          }
          return hit;
        }

        // Hover-car streaks: thin horizontal bright lines crossing the sky.
        vec3 hoverCars(vec3 rd, float t) {
          vec3 col = vec3(0.0);
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float seed = fi * 13.7;
            float lane = mix(0.05, 0.30, hash(vec2(seed, 1.3)));
            float spd = mix(0.4, 0.9, hash(vec2(seed, 2.7)));
            // Horizontal sweep: az = -PI..PI cycles.
            float phase = mod(t * spd + seed, 6.28318) - 3.14159;
            float az = atan(rd.x, -rd.z);
            float alt = asin(clamp(rd.y, -1.0, 1.0));
            float dAz = az - phase;
            if (dAz > 3.14159) dAz -= 6.28318;
            if (dAz < -3.14159) dAz += 6.28318;
            float dAlt = alt - lane;
            // Streak: long thin trail behind position.
            float along = -dAz; // behind = az < phase
            float thickness = 0.012;
            float bright = smoothstep(thickness, 0.0, abs(dAlt))
                         * smoothstep(0.0, 0.005, along)
                         * smoothstep(0.20, 0.0, along);
            // Color alternates cyan / magenta / amber.
            vec3 streakCol;
            float roll = hash(vec2(seed, 3.7));
            if (roll < 0.4) streakCol = vec3(0.20, 0.95, 1.00);
            else if (roll < 0.75) streakCol = vec3(1.00, 0.30, 0.80);
            else streakCol = vec3(1.00, 0.75, 0.20);
            col += streakCol * bright * 1.4;
          }
          return col;
        }

        // Holographic billboard: rectangular flicker with scanlines.
        vec3 hologram(vec3 rd, float t) {
          float az = atan(rd.x, -rd.z);
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          // Place hologram at fixed direction.
          float az0 = -0.6;
          float alt0 = 0.18;
          float dAz = az - az0;
          if (dAz > 3.14159) dAz -= 6.28318;
          if (dAz < -3.14159) dAz += 6.28318;
          float dAlt = alt - alt0;
          float w = 0.10, h = 0.08;
          if (abs(dAz) > w || abs(dAlt) > h) return vec3(0.0);
          // Scanlines.
          float scan = 0.5 + 0.5 * sin(dAlt * 220.0 + t * 6.0);
          float flicker = 0.7 + 0.3 * sin(t * 18.0);
          // Shape: "logo-like" arc.
          float shape = smoothstep(0.5, 0.45, length(vec2(dAz / w, dAlt / h)));
          vec3 base = mix(vec3(0.20, 0.95, 1.00),
                          vec3(1.00, 0.30, 0.80), 0.5 + 0.5 * sin(t * 0.7));
          return base * shape * scan * flicker * 1.3;
        }

        // Rain streaks: short diagonal lines as projected directional noise.
        float rain(vec3 rd, float t) {
          float az = atan(rd.x, -rd.z);
          float alt = asin(clamp(rd.y, -1.0, 1.0));
          // Diagonal streak coordinate.
          vec2 uv = vec2(az * 8.0 + alt * 1.5, alt * 18.0 + t * 4.0);
          float r = 0.0;
          for (int k = 0; k < 2; k++) {
            float fk = float(k);
            vec2 cell = floor(uv + vec2(fk * 0.37, 0.0));
            vec2 fc = fract(uv + vec2(fk * 0.37, 0.0));
            float h = hash(cell);
            if (h > 0.94) {
              float streak = smoothstep(0.04, 0.0, abs(fc.x - 0.5))
                           * smoothstep(0.45, 0.0, abs(fc.y - 0.5));
              r += streak * 0.4;
            }
          }
          // Above horizon only.
          r *= smoothstep(-0.05, 0.20, alt);
          return r;
        }

        // Wet street reflection: when looking down, mirror the sky/buildings.
        vec3 wetStreet(vec3 ro, vec3 rd, float t) {
          if (rd.y > -0.05) return vec3(0.0);
          float gt = -ro.y / rd.y;
          if (gt < 0.0 || gt > 60.0) return vec3(0.0);
          vec3 gp = ro + rd * gt;
          // Puddle pattern: brighter in puddle areas.
          float puddle = fbm(gp.xz * 0.4);
          puddle = smoothstep(0.45, 0.7, puddle);
          // Reflected ray (mirror across y=0).
          vec3 refRd = vec3(rd.x, -rd.y, rd.z);
          // Sample the ring sky color along reflected direction (cheap).
          float az = atan(refRd.x, -refRd.z);
          // Pick a representative neon color based on azimuth.
          float c = sin(az * 3.0 + t * 0.2) * 0.5 + 0.5;
          vec3 reflCol = mix(vec3(0.20, 0.05, 0.18),
                             vec3(1.00, 0.30, 0.80), c);
          // Mix in cyan glow.
          reflCol += vec3(0.20, 0.95, 1.00)
                   * smoothstep(0.5, 1.0, sin(az * 5.0 + t * 0.3) * 0.5 + 0.5)
                   * 0.4;
          // Base wet asphalt color.
          vec3 base = vec3(0.04, 0.03, 0.06);
          float fog = smoothstep(0.0, 25.0, gt);
          vec3 col = mix(base, reflCol * 0.5, puddle);
          // Distance fade into smog.
          col = mix(col, vec3(0.10, 0.04, 0.15), fog * 0.7);
          return col;
        }

        void main() {
          vec3 rd = normalize(uViewRotation * vWorldDir);
          vec3 ro = uCamLocal;
          float t = uTime;

          // ---- Smoggy purple sky with magenta horizon ----
          float skyT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyHigh = vec3(0.04, 0.02, 0.10);
          vec3 skyMid = vec3(0.18, 0.05, 0.22);
          vec3 skyLow = vec3(0.45, 0.10, 0.35);
          vec3 col = mix(skyLow, skyMid, smoothstep(0.50, 0.65, skyT));
          col = mix(col, skyHigh, smoothstep(0.65, 1.0, skyT));

          // Smog clouds.
          float smog = fbm(vec2(atan(rd.x, -rd.z) * 2.5,
                                rd.y * 4.0 + t * 0.05));
          col = mix(col, vec3(0.20, 0.05, 0.18),
                    smog * smoothstep(0.0, 0.3, rd.y) * 0.5);

          // ---- Ring of skyscraper silhouettes ----
          BuildingHit b = cityRing(rd, t);
          if (b.mask > 0.5) {
            vec3 buildingCol = vec3(0.020, 0.015, 0.035);
            // Backlit edge tint
            buildingCol += vec3(0.06, 0.02, 0.08);
            // Apply windows.
            vec3 lit = b.windowCol * b.windowMask * 1.5;
            col = buildingCol + lit;
            // Top antenna glow.
            col += vec3(1.00, 0.30, 0.55) * b.topGlow * 0.4;
          }

          // ---- Hover-car streaks ----
          col += hoverCars(rd, t);

          // ---- Holographic billboard ----
          col += hologram(rd, t);

          // ---- Rain streaks (above horizon, slight bright shimmer) ----
          col += vec3(0.50, 0.65, 0.95) * rain(rd, t) * 0.6;

          // ---- Wet street (looking down) ----
          if (rd.y < 0.0) {
            vec3 streetCol = wetStreet(ro, rd, t);
            // Replace sky/building color below horizon.
            float weight = smoothstep(0.0, -0.05, rd.y);
            col = mix(col, streetCol, weight);
          }

          // Atmospheric magenta lift.
          col = mix(col, vec3(0.55, 0.10, 0.45), 0.05);

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
