import * as THREE from 'three';
import {Script} from '../../core/Script';
import {AudioClassifierResult, Category} from './DetectedSounds';
import {WorldOptions} from '../WorldOptions';
import {AudioListener} from '../../sound/AudioListener';
import {FilesetResolver, AudioClassifier} from '@mediapipe/tasks-audio';

let sharedAudioClassifier: any = null;
let initializingPromise: Promise<any> | null = null;

async function getAudioClassifier(config: any) {
  if (sharedAudioClassifier) return sharedAudioClassifier;
  if (initializingPromise) return initializingPromise;

  initializingPromise = (async () => {
    const audioTasks = await FilesetResolver.forAudioTasks(config.wasmFilesUrl);
    sharedAudioClassifier = await AudioClassifier.createFromOptions(
      audioTasks,
      {
        baseOptions: {modelAssetPath: config.modelAssetPath},
      }
    );
    return sharedAudioClassifier;
  })();

  return initializingPromise;
}

export interface DetectorBackendContext {
  options: WorldOptions;
}

export abstract class BaseDetectorBackend {
  protected context: DetectorBackendContext;

  constructor(context: DetectorBackendContext) {
    this.context = context;
  }

  abstract classify(
    audioData: Float32Array,
    sampleRate: number
  ): AudioClassifierResult | null;

  normalizeAudio(int16Data: Int16Array): Float32Array {
    const normalizedAudio = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      normalizedAudio[i] = int16Data[i] / 32768.0;
    }
    return normalizedAudio;
  }

  populateDebugData(
    normalizedAudio: Float32Array,
    sampleRate: number
  ): {rms: number; bufferSize: number; sampleRate: number} {
    let sumSquares = 0;
    for (let i = 0; i < normalizedAudio.length; i++) {
      sumSquares += normalizedAudio[i] * normalizedAudio[i];
    }
    const rms = Math.sqrt(sumSquares / normalizedAudio.length);

    return {
      rms: rms,
      bufferSize: normalizedAudio.length,
      sampleRate: sampleRate,
    };
  }
}

export class MediaPipeDetectorBackend extends BaseDetectorBackend {
  private chunkSamples = 16000;
  private accumulatedAudio: number[] = [];

  constructor(context: DetectorBackendContext) {
    super(context);
    const mediapipeConfig = this.context.options.sounds.backendConfig.mediapipe;
    this.chunkSamples = mediapipeConfig.chunkSamples;

    // Trigger initialization but don't await it here
    getAudioClassifier(mediapipeConfig).catch((error) => {
      console.error(
        'MediaPipeDetectorBackend: Failed to load MediaPipe audio module:',
        error
      );
    });
  }

  override classify(
    audioData: Float32Array,
    sampleRate: number
  ): AudioClassifierResult | null {
    if (!sharedAudioClassifier) return null;

    for (let i = 0; i < audioData.length; i++) {
      this.accumulatedAudio.push(audioData[i]);
    }

    if (this.accumulatedAudio.length >= this.chunkSamples) {
      const chunk = new Float32Array(
        this.accumulatedAudio.slice(0, this.chunkSamples)
      );
      this.accumulatedAudio = this.accumulatedAudio.slice(this.chunkSamples); // simple non-overlapping window

      console.log('Sample Rate: ', sampleRate);
      const mediaPipeResult = sharedAudioClassifier.classify(chunk, sampleRate);
      const debugData = this.populateDebugData(chunk, sampleRate);

      return {
        items: mediaPipeResult,
        debug: debugData,
      };
    }
    return null;
  }
}

/**
 * Detects sounds from the mic input stream using MediaPipe's Audio Classifier.
 */
export class SoundDetector extends Script {
  static dependencies = {options: WorldOptions};

  private backendPromise?: Promise<BaseDetectorBackend>;
  private audioListener?: AudioListener;
  private isListening = false;
  private options?: WorldOptions;

  /**
   * Initializes the SoundDetector.
   */
  override async init({options}: {options: WorldOptions}) {
    this.options = options;
  }

  private getOrCreateDetectorBackend(): Promise<BaseDetectorBackend> {
    if (!this.backendPromise) {
      if (!this.options) {
        throw new Error(
          'SoundDetector: Options not initialized. Call init first.'
        );
      }
      this.backendPromise = (async () => {
        return new MediaPipeDetectorBackend({options: this.options!});
      })();
    }
    return this.backendPromise;
  }

  /**
   * Starts listening to the provided or default mic input stream.
   * @param stream - Optional MediaStream from the XR device's mic.
   */
  async startListening(stream?: MediaStream) {
    if (this.isListening) return;

    if (!this.audioListener) {
      this.audioListener = new AudioListener({
        sampleRate: 44000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    }

    try {
      this.isListening = true;
      await this.audioListener.startCapture({
        onAudioData: async (buffer: ArrayBuffer) => {
          const backend = await this.getOrCreateDetectorBackend();

          const int16 = new Int16Array(buffer);

          const normalizedAudio = backend.normalizeAudio(int16);

          const sampleRate =
            this.audioListener?.audioContext?.sampleRate || 44000;

          const result = backend.classify(normalizedAudio, sampleRate);
          if (result) {
            this.dispatchEvent({
              type: 'soundDetected',
              detail: result,
            } as any);
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
