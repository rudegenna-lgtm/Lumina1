
export enum VoiceType {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  YOUNG_MALE = 'YOUNG_MALE',
  YOUNG_FEMALE = 'YOUNG_FEMALE',
  ANCIENT_MALE = 'ANCIENT_MALE'
}

export interface AmbientSound {
  id: string;
  name: string;
  url: string;
  icon: string;
}

export interface Story {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface VoiceConfig {
  name: string;
  label: string;
  geminiVoice: string;
}
