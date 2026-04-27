export interface Category {
  categoryName: string;
  score: number;
  displayName?: string;
}

export interface Classification {
  categories: Category[];
}

export interface DebugData {
  rms: number;
  bufferSize: number;
  sampleRate: number;
}

export interface AudioClassifierResultItem {
  classifications: Classification[];
}

export interface AudioClassifierResult {
  items: AudioClassifierResultItem[];
  debug?: DebugData;
}

export interface SoundDetectedEventDetail {
  categories: Category[] | null;
  debug: DebugData;
}
