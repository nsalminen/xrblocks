import * as THREE from 'three';
import {Script} from '../../core/Script';
import {WorldOptions} from '../WorldOptions';
import {AudioListener} from '../../sound/AudioListener';
import {MediaPipeDetectorBackend} from './backends/MediaPipeDetectorBackend';
import {BaseDetectorBackend} from './SoundDetectorBackend';
import {AudioClassifierResult} from './DetectedSounds';

interface SoundDetectorEventMap extends THREE.Object3DEventMap {
  soundDetected: {
    audioClassifierResult: AudioClassifierResult;
  };
}

/**
 * Detects sounds from the mic input stream using MediaPipe's Audio Classifier.
 */
export class SoundDetector extends Script<SoundDetectorEventMap> {
  static dependencies = {options: WorldOptions};

  private backendPromises = new Map<string, Promise<BaseDetectorBackend>>();
  private audioListener?: AudioListener;
  private isListening = false;
  private options?: WorldOptions;

  /**
   * Initializes the SoundDetector.
   */
  override async init({options}: {options: WorldOptions}) {
    this.options = options;
  }

  private getOrCreateDetectorBackend(
    sampleRate: number
  ): Promise<BaseDetectorBackend> {
    if (!this.options) {
      throw new Error(
        'SoundDetector: Options not initialized. Call init first.'
      );
    }
    const activeBackend = this.options.sounds.backendConfig.activeBackend;

    let backendPromise = this.backendPromises.get(activeBackend);
    if (!backendPromise) {
      backendPromise = (async () => {
        if (activeBackend === 'mediapipe') {
          return new MediaPipeDetectorBackend({
            options: this.options!,
            sampleRate,
          });
        } else {
          throw new Error(
            `SoundDetector backend '${activeBackend}' is not supported.`
          );
        }
      })();
      this.backendPromises.set(activeBackend, backendPromise);
    }
    return backendPromise;
  }

  /**
   * Starts listening to the provided or default mic input stream.
   * @param stream - Optional MediaStream from the XR device's mic.
   */
  async startListening(stream?: MediaStream) {
    if (this.isListening) return;

    if (!this.audioListener) {
      this.audioListener = new AudioListener({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    }

    const sampleRate = this.audioListener?.audioContext?.sampleRate || 44000;
    const backend = await this.getOrCreateDetectorBackend(sampleRate);

    try {
      this.isListening = true;
      await this.audioListener.startCapture({
        onAudioData: async (buffer: ArrayBuffer) => {
          if (!backend) return;

          const normalizedAudio = backend.normalizeAudio(buffer);

          const audioClassifierResult = backend.classify(normalizedAudio);
          if (audioClassifierResult) {
            this.dispatchEvent({
              type: 'soundDetected',
              audioClassifierResult: audioClassifierResult,
            });
          }
        },
      });

      console.log('SoundDetector: Started listening using AudioListener.');
    } catch (error) {
      console.error(
        'SoundDetector: Failed to start audio classification:',
        error
      );
      this.isListening = false;
    }
  }

  /**
   * Stops listening and releases resources.
   */
  stopListening() {
    if (!this.isListening) return;
    this.audioListener?.stopCapture();
    this.isListening = false;
    console.log('SoundDetector: Stopped listening.');
  }

  override update(_timestamp: number, _frame?: XRFrame) {
    // No per-frame update logic needed, audio is handled asynchronously via streams.
  }
}
