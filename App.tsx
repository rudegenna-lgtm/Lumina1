
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VOICES, AMBIENT_SOUNDS } from './constants';
import { VoiceType, Story, AmbientSound } from './types';
import { generateStory, generateSpeech, decode, decodeAudioData } from './services/geminiService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'generate' | 'library' | 'playing'>('generate');
  const [inputMode, setInputMode] = useState<'ai' | 'manual'>('ai');
  const [currentVoice, setCurrentVoice] = useState<VoiceType>(VoiceType.FEMALE);
  const [engine, setEngine] = useState<'ai' | 'system'>('ai');
  const [activeAmbients, setActiveAmbients] = useState<Set<string>>(new Set());
  const [ambientVolumes, setAmbientVolumes] = useState<Record<string, number>>({});
  const [stories, setStories] = useState<Story[]>([]);
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const ambientAudioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const ttsAudioContext = useRef<AudioContext | null>(null);
  const currentTtsSource = useRef<AudioBufferSourceNode | null>(null);
  const sleepTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const saved = localStorage.getItem('lumina_stories');
    if (saved) setStories(JSON.parse(saved));
    
    const initialVolumes: Record<string, number> = {};
    AMBIENT_SOUNDS.forEach(s => initialVolumes[s.id] = 0.5);
    setAmbientVolumes(initialVolumes);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      // Fix: Ensure audio objects are correctly typed as HTMLAudioElement to avoid 'unknown' errors
      (Object.values(ambientAudioRefs.current) as HTMLAudioElement[]).forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      stopAllTTS();
      if (sleepTimerRef.current) window.clearInterval(sleepTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (sleepTimer !== null) {
      setTimeLeft(sleepTimer * 60);
      if (sleepTimerRef.current) window.clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev === null || prev <= 1) {
            if (sleepTimerRef.current) window.clearInterval(sleepTimerRef.current);
            handleSleepEnd();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(null);
      if (sleepTimerRef.current) window.clearInterval(sleepTimerRef.current);
    }
  }, [sleepTimer]);

  const handleSleepEnd = () => {
    stopAllTTS();
    stopAllAmbients();
    setSleepTimer(null);
  };

  const stopAllAmbients = () => {
    setActiveAmbients(new Set());
    // Fix: Cast the results of Object.values to HTMLAudioElement[] to prevent TypeScript errors on 'audio.pause()'
    (Object.values(ambientAudioRefs.current) as HTMLAudioElement[]).forEach(audio => {
      audio.pause();
    });
  };

  const saveStory = (story: Story) => {
    const newStories = [story, ...stories];
    setStories(newStories);
    localStorage.setItem('lumina_stories', JSON.stringify(newStories));
  };

  const toggleAmbient = (id: string) => {
    const newSet = new Set(activeAmbients);
    if (newSet.has(id)) {
      newSet.delete(id);
      if (ambientAudioRefs.current[id]) {
        const audio = ambientAudioRefs.current[id];
        // Smooth stop
        let vol = audio.volume;
        const fade = setInterval(() => {
          if (vol > 0.05) {
            vol -= 0.05;
            audio.volume = vol;
          } else {
            audio.pause();
            clearInterval(fade);
          }
        }, 30);
      }
    } else {
      newSet.add(id);
      const sound = AMBIENT_SOUNDS.find(s => s.id === id);
      if (sound) {
        if (!ambientAudioRefs.current[id]) {
          const audio = new Audio(sound.url);
          audio.loop = true;
          audio.crossOrigin = "anonymous";
          ambientAudioRefs.current[id] = audio;
        }
        
        const audio = ambientAudioRefs.current[id];
        audio.volume = 0;
        audio.play().catch(err => {
          console.error(`Failed to play ${sound.name}`, err);
          setError(`Could not play ${sound.name}. Click again.`);
        });

        // Smooth fade in
        let vol = 0;
        const targetVol = ambientVolumes[id] || 0.5;
        const fade = setInterval(() => {
          if (vol < targetVol) {
            vol += 0.05;
            audio.volume = Math.min(vol, targetVol);
          } else {
            clearInterval(fade);
          }
        }, 30);
      }
    }
    setActiveAmbients(newSet);
  };

  const updateAmbientVolume = (id: string, vol: number) => {
    setAmbientVolumes(prev => ({ ...prev, [id]: vol }));
    if (ambientAudioRefs.current[id] && activeAmbients.has(id)) {
      ambientAudioRefs.current[id].volume = vol;
    }
  };

  const stopAllTTS = useCallback(() => {
    if (currentTtsSource.current) {
      try { currentTtsSource.current.stop(); } catch (e) {}
      currentTtsSource.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsNarrating(false);
  }, []);

  const handleCreate = async () => {
    if (inputMode === 'ai') {
      if (!isOnline) {
        setError("Story generation requires an internet connection.");
        return;
      }
      if (!prompt.trim()) return;
      setIsGenerating(true);
      setError(null);
      try {
        const res = await generateStory(prompt);
        const newStory: Story = {
          id: Date.now().toString(),
          title: res.title,
          content: res.content,
          createdAt: Date.now()
        };
        saveStory(newStory);
        setCurrentStory(newStory);
        setActiveTab('playing');
        setPrompt('');
      } catch (err: any) {
        setError('Failed to generate story.');
        console.error(err);
      } finally {
        setIsGenerating(false);
      }
    } else {
      if (!manualTitle.trim() || !manualContent.trim()) return;
      const newStory: Story = {
        id: Date.now().toString(),
        title: manualTitle,
        content: manualContent,
        createdAt: Date.now()
      };
      saveStory(newStory);
      setCurrentStory(newStory);
      setActiveTab('playing');
      setManualTitle('');
      setManualContent('');
    }
  };

  const startNarration = async (story: Story) => {
    stopAllTTS();
    setIsLoadingAudio(true);
    setError(null);

    const effectiveEngine = !isOnline ? 'system' : engine;

    if (effectiveEngine === 'ai') {
      try {
        if (!ttsAudioContext.current) {
          ttsAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        if (ttsAudioContext.current.state === 'suspended') await ttsAudioContext.current.resume();

        const voiceConfig = VOICES[currentVoice];
        const base64Audio = await generateSpeech(story.content, voiceConfig.geminiVoice);
        
        if (base64Audio && ttsAudioContext.current) {
          const audioBuffer = await decodeAudioData(decode(base64Audio), ttsAudioContext.current, 24000, 1);
          const source = ttsAudioContext.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ttsAudioContext.current.destination);
          source.onended = () => setIsNarrating(false);
          source.start(0);
          currentTtsSource.current = source;
          setIsNarrating(true);
        } else {
          throw new Error("No audio data");
        }
      } catch (err) {
        console.warn('AI Narration failed, falling back to system engine', err);
        startSystemNarration(story.content);
      } finally {
        setIsLoadingAudio(false);
      }
    } else {
      startSystemNarration(story.content);
      setIsLoadingAudio(false);
    }
  };

  const startSystemNarration = (text: string) => {
    if (!window.speechSynthesis) {
      setError("Speech not supported.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const voiceConfig = VOICES[currentVoice];
    
    const isFemale = voiceConfig.name.includes('FEMALE');
    const targetVoice = voices.find(v => 
      isFemale ? v.name.toLowerCase().includes('female') : v.name.toLowerCase().includes('male')
    ) || voices[0];

    utterance.voice = targetVoice;
    utterance.rate = 0.9;
    utterance.pitch = isFemale ? 1.05 : 0.95;
    utterance.onend = () => setIsNarrating(false);
    utterance.onstart = () => setIsNarrating(true);

    window.speechSynthesis.speak(utterance);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen pb-24 md:pb-0 md:pl-20 flex flex-col bg-[#050811] text-slate-100 selection:bg-indigo-500/30 overflow-x-hidden">
      
      {/* Visualizer Background */}
      {isNarrating && (
        <div className="fixed inset-0 pointer-events-none z-0 opacity-20">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-64 bg-indigo-600/30 blur-[120px] rounded-full animate-pulse" />
        </div>
      )}

      {/* Sidebar / Bottom Nav */}
      <nav className="fixed bottom-0 left-0 w-full h-20 bg-black/60 backdrop-blur-3xl border-t border-white/5 flex items-center justify-around z-50 md:top-0 md:left-0 md:w-20 md:h-full md:flex-col md:border-t-0 md:border-r">
        {[
          { id: 'generate', icon: <path d="M12 4v16m8-8H4"/> },
          { id: 'library', icon: <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/> },
          { id: 'playing', icon: <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/> }
        ].map(item => (
          <button 
            key={item.id}
            onClick={() => setActiveTab(item.id as any)}
            className={`p-4 rounded-2xl transition-all duration-500 relative ${activeTab === item.id ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {activeTab === item.id && <div className="absolute inset-0 bg-indigo-500/10 rounded-2xl scale-110 blur-sm" />}
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{item.icon}</svg>
          </button>
        ))}
      </nav>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full relative z-10">
        <header className="mb-10 text-center flex flex-col items-center">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-serif font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-500">Lumina</h1>
          </div>
          <p className="text-slate-500 text-sm font-medium tracking-widest uppercase">Atmospheric Narratives</p>
        </header>

        {activeTab === 'generate' && (
          <div className="space-y-8 animate-fadeIn max-w-2xl mx-auto">
            <div className="flex bg-white/5 p-1 rounded-2xl w-fit mx-auto backdrop-blur-xl border border-white/5">
              <button onClick={() => setInputMode('ai')} disabled={!isOnline} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${inputMode === 'ai' ? 'bg-white text-black shadow-xl' : 'text-slate-500 opacity-50'}`}>AI Weaver</button>
              <button onClick={() => setInputMode('manual')} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${inputMode === 'manual' ? 'bg-white text-black shadow-xl' : 'text-slate-500'}`}>Scribe</button>
            </div>

            <div className="bg-white/[0.02] border border-white/10 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-2xl relative overflow-hidden">
               <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-600/10 blur-[60px] rounded-full" />
              {inputMode === 'ai' ? (
                <>
                  <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Whisper a theme into the void..."
                    className="w-full h-40 bg-transparent text-xl font-serif italic border-none rounded-2xl p-0 text-slate-100 placeholder:text-slate-700 focus:ring-0 outline-none resize-none relative z-10"
                  />
                  <button 
                    onClick={handleCreate}
                    disabled={isGenerating || !prompt.trim() || !isOnline}
                    className="w-full mt-6 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 py-4 rounded-2xl font-black text-sm tracking-widest uppercase transition-all shadow-indigo-500/20 shadow-lg active:scale-95"
                  >
                    {isGenerating ? "Weaving..." : "Manifest Story"}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <input type="text" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Title of the tale" className="w-full bg-transparent border-b border-white/10 py-3 text-lg font-bold outline-none" />
                  <textarea value={manualContent} onChange={(e) => setManualContent(e.target.value)} placeholder="Once, in a place beyond time..." className="w-full h-48 bg-transparent border-none rounded-2xl py-5 text-slate-300 placeholder:text-slate-700 focus:ring-0 outline-none resize-none font-serif italic" />
                  <button onClick={handleCreate} disabled={!manualTitle.trim() || !manualContent.trim()} className="w-full bg-white text-black py-4 rounded-2xl font-black text-sm tracking-widest uppercase transition-all">Keep Story</button>
                </div>
              )}
            </div>

            <div className="pt-4">
              <p className="text-[10px] font-black tracking-widest uppercase text-slate-600 mb-6 text-center">Select Narrator Presence</p>
              <div className="grid grid-cols-5 gap-2">
                {(Object.entries(VOICES) as [VoiceType, any][]).map(([key, config]) => (
                  <button 
                    key={key} 
                    onClick={() => setCurrentVoice(key)} 
                    className={`p-3 md:p-4 rounded-3xl border transition-all flex flex-col items-center gap-2 ${currentVoice === key ? 'bg-indigo-600/30 border-indigo-400 scale-105 ring-4 ring-indigo-500/10' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                  >
                    <span className="text-xl md:text-2xl">
                      {key === VoiceType.MALE ? '🌑' : key === VoiceType.FEMALE ? '🌕' : key === VoiceType.YOUNG_MALE ? '🪐' : key === VoiceType.YOUNG_FEMALE ? '✨' : '🔥'}
                    </span>
                    <span className="text-[8px] md:text-[9px] font-bold uppercase tracking-tighter text-center leading-none h-4 flex items-center">{config.label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
            {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center rounded-xl animate-bounce">{error}</div>}
          </div>
        )}

        {activeTab === 'library' && (
          <div className="animate-fadeIn max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            {stories.length === 0 ? (
              <div className="col-span-full py-32 text-center opacity-30 italic font-serif">The archives are empty. Begin a new weave.</div>
            ) : stories.map(s => (
              <div key={s.id} onClick={() => { setCurrentStory(s); setActiveTab('playing'); }} className="p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/5 hover:border-indigo-500/40 transition-all cursor-pointer group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-600/30 transition-all group-hover:w-2" />
                <h3 className="text-xl font-serif font-bold group-hover:text-indigo-400 transition-colors">{s.title}</h3>
                <p className="text-slate-500 text-xs line-clamp-2 mt-2 font-medium italic">{s.content}</p>
                <div className="mt-6 flex justify-between items-center opacity-40">
                  <span className="text-[9px] font-black uppercase tracking-widest">{new Date(s.createdAt).toLocaleDateString()}</span>
                  <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center group-hover:border-indigo-400/50 group-hover:bg-indigo-400/10"><svg className="w-3 h-3 group-hover:text-indigo-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"/></svg></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'playing' && (
          <div className="animate-fadeIn max-w-4xl mx-auto space-y-8 pb-10">
            {!currentStory ? (
              <div className="py-32 text-center">
                <button onClick={() => setActiveTab('library')} className="px-10 py-4 bg-white/5 rounded-full font-bold border border-white/10 hover:bg-white/10 transition-all">Browse Library</button>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                {/* Story Title & Visualizer */}
                <div className="relative w-full py-12 flex flex-col items-center justify-center mb-6">
                   <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-end gap-1.5 h-32 transition-opacity duration-1000 ${isNarrating ? 'opacity-100' : 'opacity-20'}`}>
                    {[...Array(30)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-1 rounded-full bg-gradient-to-t from-indigo-600 to-indigo-300/40 transition-all duration-300 ${isNarrating ? 'animate-visualizer' : 'h-2'}`}
                        style={{ animationDelay: `${i * 0.08}s`, height: isNarrating ? '100%' : '8px' }}
                      />
                    ))}
                  </div>
                  <h2 className="relative z-10 text-4xl md:text-6xl font-serif font-bold text-center px-10 tracking-tight transition-all duration-1000 group-hover:scale-105">{currentStory.title}</h2>
                </div>

                {/* Playback & Mode Controls */}
                <div className="flex items-center gap-8 md:gap-14 mb-10">
                  <div className="flex flex-col items-center">
                    <button 
                      onClick={() => setSleepTimer(prev => prev === 15 ? 30 : prev === 30 ? 60 : prev === 60 ? null : 15)}
                      className={`p-5 rounded-full border transition-all hover:scale-110 ${sleepTimer ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'border-white/10 text-slate-600'}`}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </button>
                    {timeLeft && <span className="text-[10px] font-black mt-3 text-indigo-400 tracking-wider">{formatTime(timeLeft)}</span>}
                  </div>

                  <button 
                    onClick={() => isNarrating ? stopAllTTS() : startNarration(currentStory)}
                    disabled={isLoadingAudio}
                    className={`w-28 h-28 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-95 relative ${isNarrating ? 'bg-white text-black' : 'bg-indigo-600 text-white hover:bg-indigo-500 hover:shadow-indigo-600/40'}`}
                  >
                    {isLoadingAudio ? (
                      <div className="w-10 h-10 border-4 border-indigo-400 border-t-white rounded-full animate-spin" />
                    ) : isNarrating ? (
                      <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    ) : (
                      <svg className="w-12 h-12 ml-1.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    )}
                    {isNarrating && <div className="absolute inset-0 rounded-full bg-white animate-ping opacity-10 pointer-events-none" />}
                  </button>

                  <div className="flex flex-col items-center">
                    <button 
                      onClick={() => setEngine(prev => prev === 'ai' ? 'system' : 'ai')}
                      disabled={!isOnline}
                      className={`p-5 rounded-full border transition-all hover:scale-110 ${engine === 'ai' ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'border-white/10 text-slate-600'}`}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </button>
                    <span className="text-[10px] font-black mt-3 text-slate-500 uppercase tracking-widest">{engine}</span>
                  </div>
                </div>

                {/* Atmosphere Mixer */}
                <div className="w-full max-w-2xl bg-white/[0.02] border border-white/10 p-8 rounded-[3rem] shadow-xl relative overflow-hidden backdrop-blur-3xl">
                  <div className="flex justify-between items-center border-b border-white/5 pb-4 mb-6">
                    <h4 className="text-[11px] font-black tracking-[0.2em] uppercase text-indigo-400/80">Atmosphere Mixer</h4>
                    <button onClick={stopAllAmbients} className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors">Silent All</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                    {AMBIENT_SOUNDS.map(s => (
                      <div key={s.id} className="flex flex-col gap-3 group">
                        <div className="flex justify-between items-center">
                          <button 
                            onClick={() => toggleAmbient(s.id)}
                            className={`flex items-center gap-3 text-sm font-bold transition-all relative ${activeAmbients.has(s.id) ? 'text-white' : 'text-slate-600 hover:text-slate-400'}`}
                          >
                            <span className={`transition-transform duration-500 ${activeAmbients.has(s.id) ? 'scale-125 rotate-12' : 'group-hover:scale-110'}`}>{s.icon}</span>
                            <span>{s.name}</span>
                            {activeAmbients.has(s.id) && <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-1 bg-indigo-400 rounded-full animate-ping" />}
                          </button>
                          <span className="text-[10px] text-slate-700 font-mono tracking-tighter">{(ambientVolumes[s.id] * 100).toFixed(0)}%</span>
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.01" 
                          value={ambientVolumes[s.id] || 0} 
                          onChange={(e) => updateAmbientVolume(s.id, parseFloat(e.target.value))}
                          className="w-full accent-indigo-500 h-1.5 bg-white/5 rounded-full outline-none appearance-none cursor-pointer hover:bg-white/10 transition-colors"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Immersive Text Reader */}
                <div className="mt-12 px-6 max-h-[40vh] overflow-y-auto custom-scrollbar scroll-smooth">
                  <p className="font-serif text-2xl md:text-3xl leading-[1.7] text-slate-400 italic text-center max-w-3xl mx-auto transition-all duration-1000 p-8">
                    {currentStory.content}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes visualizer {
          0%, 100% { height: 10%; opacity: 0.2; transform: translateY(0); }
          50% { height: 100%; opacity: 0.8; transform: translateY(-5px); }
        }
        .animate-visualizer { animation: visualizer 1.8s ease-in-out infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.4); }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          background: #818cf8;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.6);
          border: 2px solid #050811;
          transition: all 0.2s;
        }
        input[type='range']::-webkit-slider-thumb:hover {
          background: #ffffff;
          transform: scale(1.2);
        }
        .animate-fadeIn {
          animation: fadeIn 0.8s ease-out forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default App;
