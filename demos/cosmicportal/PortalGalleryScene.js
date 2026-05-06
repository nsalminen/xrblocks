import * as THREE from 'three';
import * as xb from 'xrblocks';

import {Portal} from './Portal.js';
import {CosmicScene} from './scenes/CosmicScene.js';
import {CyberpunkScene} from './scenes/CyberpunkScene.js';
import {ForestScene} from './scenes/ForestScene.js';
import {LavaScene} from './scenes/LavaScene.js';
import {UnderwaterScene} from './scenes/UnderwaterScene.js';

const SCENES = [
  UnderwaterScene,
  ForestScene,
  CosmicScene,
  LavaScene,
  CyberpunkScene,
];

const ARC_RADIUS = 2.2; // distance from user to each portal (meters)
const ARC_SPAN = Math.PI * 0.85; // total arc span (~150°)

/**
 * A gallery of 5 portals arranged in a gentle arc in front of the user.
 * Each portal renders a fully different cinematic world.
 *
 * UX:
 *   1. Click a portal disc to "pick it up" (its ring spins faster + scales).
 *   2. Click anywhere on the depth mesh to drop it there, snapped to the
 *      surface normal.
 *   3. Click the held portal again (or click empty space twice) to cancel.
 */
export class PortalGalleryScene extends xb.Script {
  portals = [];
  labels = [];
  clock = new THREE.Clock();
  _held = null;

  init() {
    const userY = xb.core.user?.height ?? 1.6;
    const n = SCENES.length;

    // Place each portal along an arc centered at (0, userY, 0).
    for (let i = 0; i < n; i++) {
      const scene = SCENES[i];
      const portal = new Portal({scene, label: scene.name});
      this.add(portal);

      const t = n === 1 ? 0.5 : i / (n - 1);
      const ang = -ARC_SPAN / 2 + ARC_SPAN * t;
      const x = Math.sin(ang) * ARC_RADIUS;
      const z = -Math.cos(ang) * ARC_RADIUS;
      portal.position.set(x, userY, z);
      portal.lookAt(0, userY, 0);
      portal._bobBaseY = userY;

      this.portals.push(portal);

      // Floating label above the portal.
      const label = makeLabelSprite(scene.name);
      label.position.set(x, userY + Portal.RADIUS + 0.18, z);
      // Scale already set in makeLabelSprite.
      this.add(label);
      this.labels.push(label);
    }

    this.add(new THREE.AmbientLight(0x223355, 0.6));
    xb.showReticleOnDepthMesh?.(true);
  }

  onSelectStart(event) {
    const controller = event.target;

    // If a portal is already held, this click places it on the depth mesh
    // (or, if you click the same portal again, drops it without moving).
    if (this._held) {
      // Cancel hold if you re-click any portal.
      for (const p of this.portals) {
        if (xb.core.user?.select?.(p._disc, controller)) {
          this._held.setHeld(false);
          this._held = null;
          return;
        }
      }
      const depthMesh = xb.core.depth?.depthMesh;
      const intersection =
        depthMesh && xb.core.user?.select?.(depthMesh, controller);
      if (intersection) {
        this._held.placeAt(
          intersection.point,
          intersection.face?.normal,
          intersection.object?.matrixWorld
        );
        this._held.setHeld(false);
        this._held = null;
      }
      return;
    }

    // Nothing held: clicking a portal picks it up.
    for (const p of this.portals) {
      if (xb.core.user?.select?.(p._disc, controller)) {
        this._held = p;
        p.setHeld(true);
        return;
      }
    }
    // Click on empty space / depth mesh with nothing held = no-op.
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const cam = xb.core.camera;
    for (const p of this.portals) p.update(dt, cam);

    // Make labels face the camera (billboard) and follow their portal's bob.
    if (cam) {
      for (let i = 0; i < this.portals.length; i++) {
        const p = this.portals[i];
        const l = this.labels[i];
        l.position.y = p.position.y + Portal.RADIUS + 0.18;
        l.position.x = p.position.x;
        l.position.z = p.position.z;
      }
    }
  }
}

// ----- Helpers -----

function makeLabelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Subtle glassy background pill.
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(20, 30, 60, 0.55)');
  grad.addColorStop(1, 'rgba(10, 10, 30, 0.75)');
  ctx.fillStyle = grad;
  roundRect(ctx, 12, 18, canvas.width - 24, canvas.height - 36, 36);
  ctx.fill();

  // Border glow.
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.7)';
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 18, canvas.width - 24, canvas.height - 36, 36);
  ctx.stroke();

  // Title text.
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 64px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(120, 200, 255, 0.85)';
  ctx.shadowBlur = 18;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  // Sprite size: 0.5m wide, 0.125m tall (canvas aspect 4:1).
  sprite.scale.set(0.5, 0.125, 1);
  sprite.renderOrder = 4;
  // Don't intercept input rays — labels are decorative.
  sprite.raycast = () => {};
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
