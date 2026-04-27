import 'xrblocks/addons/simulator/SimulatorAddons.js';
import * as xb from 'xrblocks';
import {Text} from 'troika-three-text';
import * as THREE from 'three';
import {LongSelectHandler} from 'xrblocks/addons/ui/LongSelectHandler.js';

const options = new xb.Options();
options.world.enabled = true;
options.hands.enabled = true;

// Enable sound detection if the method is compiled and available.
// Otherwise, this script assumes system knows how to setup sound detector or the user provides it manually.
options.world.enableSoundDetection?.();

// Fallback to direct field manipulation if needed
if (options.world.sounds) {
  options.world.sounds.enabled = true;
}

options.setAppTitle('Sound Detector Demo');
options.setAppDescription(
  'Detects and classifies sounds from mic input, displaying result in HUD.'
);
options.xrButton.showEnterSimulatorButton = true;

class SoundDisplay extends xb.Script {
  static dependencies = {camera: THREE.Camera, world: xb.World};

  init({camera, world}) {
    this.camera = camera;
    this.world = world;

    this.lastClassification = '';

    this.hudText = new Text();
    this.hudText.text = 'Initialized';
    this.hudText.fontSize = 0.05;
    this.hudText.color = 0x00ffff;
    this.hudText.maxWidth = 0.5;
    this.hudText.position.set(0, 0, -0.5); // 50cm in front of camera
    this.hudText.textAlign = 'center';
    this.hudText.anchorX = 'center';
    this.hudText.anchorY = 'middle';

    // Add directly to this script's scene object instead of camera, to ensure WebXR renders it
    this.add(this.hudText);

    // Need to call sync() on troika text to process geometry.
    this.hudText.sync();

    if (this.world.sounds) {
      this.world.sounds.addEventListener('soundDetected', (event) => {
        const result = event.detail;

        let bestCategory = null;
        let bestScore = -1;

        const items = result ? result.items : [];

        if (items && items.length > 0) {
          const firstItem = items[0];
          if (
            firstItem.classifications &&
            firstItem.classifications.length > 0
          ) {
            const firstClassification = firstItem.classifications[0];
            if (
              firstClassification.categories &&
              firstClassification.categories.length > 0
            ) {
              bestCategory = firstClassification.categories[0];
              bestScore = bestCategory.score;
            }
          }
        }

        if (bestCategory) {
          this.lastClassification = `${bestCategory.categoryName} (${Math.round(bestScore * 100)}%)`;
        } else {
          this.lastClassification = 'Unknown Sound';
        }

        const debug = result ? result.debug : null;
        let debugStr = '';
        if (debug) {
          const {rms, bufferSize, sampleRate} = debug;
          debugStr = `RMS: ${rms.toFixed(4)} | B: ${bufferSize} | S: ${sampleRate}`;
        }

        if (this.lastClassification) {
          this.hudText.text = `${this.lastClassification}\n${debugStr}`;
        } else {
          this.hudText.text = `Listening...\n${debugStr}`;
        }
        this.hudText.sync();
      });

      console.log('SoundDisplay: attached. Waiting for long pinch to listen.');
    } else {
      this.hudText.text = 'Sound Det not initialized';
      this.hudText.sync();
    }
  }

  update() {
    // Manually update the position and rotation to keep the text 50 cm in front of camera
    if (this.hudText && this.camera) {
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();

      this.camera.getWorldPosition(position);
      this.camera.getWorldQuaternion(quaternion);

      // Get forward direction
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);

      // Position text 0.5m in front of camera
      this.hudText.position.copy(position).addScaledVector(forward, 0.5);
      this.hudText.quaternion.copy(quaternion);
    }
  }
}

function start() {
  const display = new SoundDisplay();

  const longSelectHandler = new LongSelectHandler(() => {
    if (display.world.sounds) {
      display.hudText.text = 'Listening...';
      display.hudText.sync();
      display.world.sounds.startListening();
    }
  });

  xb.add(display);
  xb.add(longSelectHandler);
  xb.init(options);
}

document.addEventListener('DOMContentLoaded', function () {
  start();
});
