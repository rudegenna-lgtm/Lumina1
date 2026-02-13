
import { VoiceType, AmbientSound, VoiceConfig } from './types';

export const VOICES: Record<VoiceType, VoiceConfig> = {
  [VoiceType.MALE]: {
    name: 'MALE',
    label: 'Deep Mature Male',
    geminiVoice: 'Charon'
  },
  [VoiceType.FEMALE]: {
    name: 'FEMALE',
    label: 'Smooth Mature Female',
    geminiVoice: 'Puck'
  },
  [VoiceType.YOUNG_MALE]: {
    name: 'YOUNG_MALE',
    label: 'Young Energetic Male',
    geminiVoice: 'Kore'
  },
  [VoiceType.YOUNG_FEMALE]: {
    name: 'YOUNG_FEMALE',
    label: 'Soft Young Female',
    geminiVoice: 'Zephyr'
  },
  [VoiceType.ANCIENT_MALE]: {
    name: 'ANCIENT_MALE',
    label: 'Ancient Deep Male',
    geminiVoice: 'Fenrir'
  }
};

export const AMBIENT_SOUNDS: AmbientSound[] = [
  {
    id: 'rain',
    name: 'Rainfall',
    url: 'https://cdn.pixabay.com/audio/2022/07/04/audio_3d100787e7.mp3',
    icon: '🌧️'
  },
  {
    id: 'birds',
    name: 'Summer Forest',
    url: 'https://cdn.pixabay.com/audio/2021/11/14/audio_9bc574f880.mp3',
    icon: '🐦'
  },
  {
    id: 'fireplace',
    name: 'Fireplace',
    url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_2456e30900.mp3',
    icon: '🔥'
  },
  {
    id: 'crickets',
    name: 'Night Crickets',
    url: 'https://cdn.pixabay.com/audio/2022/10/21/audio_731557760b.mp3',
    icon: '🦗'
  }
];
