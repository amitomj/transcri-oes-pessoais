
import React, { useEffect, useRef, useState } from 'react';
import { EvidenceFile, ProcessedContent } from '../types';
import { Play, Pause, X, Rewind, FastForward, FileText, User, ExternalLink, Search, ChevronUp, ChevronDown, Edit3, PlayCircle, Users, Check, BrainCircuit } from 'lucide-react';

interface EvidenceViewerProps {
  file: EvidenceFile | null;
  processedData: ProcessedContent | undefined;
  initialSeekSeconds: number | null;
  personName?: string;
  onClose: () => void;
  onRenameSpeaker: (fileId: string, oldName: string, newName: string) => void;
}

const EvidenceViewer: React.FC<EvidenceViewerProps> = ({ 
  file, 
  processedData, 
  initialSeekSeconds, 
  personName,
  onClose,
  onRenameSpeaker
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Speaker State
  const [showSpeakerTools, setShowSpeakerTools] = useState(true);
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  useEffect(() => {
    if (file && file.file) {
      const url = URL.createObjectURL(file.file);
      setFileUrl(url);
      return () => { URL.revokeObjectURL(url); };
    }
    setFileUrl(null);
  }, [file]);

  // Handle seeking when initialSeekSeconds changes while component is already active
  useEffect(() => {
    if (audioRef.current && initialSeekSeconds !== null && !isNaN(initialSeekSeconds)) {
        // If readyState is 0 (HAVE_NOTHING), handleLoadedMetadata will take over
        if (audioRef.current.readyState >= 1) {
            audioRef.current.currentTime = Math.max(0, initialSeekSeconds);
            audioRef.current.play().then(() => setIsPlaying(true)).catch(console.log);
        }
    }
  }, [initialSeekSeconds, file]);

  useEffect(() => {
      if (processedData) {
          const speakers = new Set<string>();
          processedData.segments.forEach(seg => {
              const boldMatch = seg.text.match(/^\s*\*\*(.*?)\*\*[:\s]*/);
              const colonMatch = seg.text.match(/^\s*([^:\n*]+):/);
              let name = boldMatch ? boldMatch[1].trim() : (colonMatch ? colonMatch[1].trim() : "");
              if (name && name.length > 0 && name.length < 50 && !/^\d{2}:\d{2}/.test(name)) {
                  speakers.add(name);
              }
          });
          setDetectedSpeakers(Array.from(speakers).sort());
      }
  }, [processedData]);

  useEffect(() => {
      if (!searchQuery.trim() || !processedData) { setSearchResults([]); return; }
      const results = processedData.segments
          .map((seg, idx) => seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ? idx : -1)
          .filter(idx => idx !== -1);
      setSearchResults(results);
      setCurrentResultIndex(0);
      if (results.length > 0) scrollToSegment(results[0]);
  }, [searchQuery, processedData]);

  const handleNextResult = () => {
      if (searchResults.length === 0) return;
      const nextIndex = (currentResultIndex + 1) % searchResults.length;
      setCurrentResultIndex(nextIndex);
      const segIndex = searchResults[nextIndex];
      scrollToSegment(segIndex);
      if (processedData && file?.type === 'AUDIO') jumpToSegment(processedData.segments[segIndex].seconds);
  };

  const handlePrevResult = () => {
      if (searchResults.length === 0) return;
      const prevIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
      setCurrentResultIndex(prevIndex);
      const segIndex = searchResults[prevIndex];
      scrollToSegment(segIndex);
      if (processedData && file?.type === 'AUDIO') jumpToSegment(processedData.segments[segIndex].seconds);
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      setDuration(audio.duration);
      if (initialSeekSeconds !== null && !isNaN(initialSeekSeconds)) {
          audio.currentTime = Math.max(0, initialSeekSeconds);
          audio.play().then(() => setIsPlaying(true)).catch(console.log);
      }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      if(!Number.isNaN(audioRef.current.duration)) setDuration(audioRef.current.duration);
      if (processedData?.segments) {
        const idx = processedData.segments.findIndex((seg, i) => {
           const nextSeg = processedData.segments[i + 1];
           return time >= seg.seconds && (nextSeg ? time < nextSeg.seconds : true);
        });
        if (idx !== -1 && idx !== activeSegmentIndex) {
            setActiveSegmentIndex(idx);
            scrollToSegment(idx);
        }
      }
    }
  };

  const scrollToSegment = (index: number) => {
      const el = document.getElementById(`seg-${index}`);
      if (el && scrollContainerRef.current) {
          const rect = el.getBoundingClientRect();
          const containerRect = scrollContainerRef.current.getBoundingClientRect();
          if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  };

  const jumpToSegment = (seconds: number) => {
      if (audioRef.current) {
          audioRef.current.currentTime = seconds;
          audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
      }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
      else { audioRef.current.play().catch(console.error); setIsPlaying(true); }
    }
  };

  const skip = (amount: number) => { if (audioRef.current) audioRef.current.currentTime += amount; };

  const formatTime = (time: number) => {
      if (Number.isNaN(time)) return "00:00";
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  const renderHighlightedText = (text: string) => {
      if (!searchQuery.trim()) return text;
      const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
      return parts.map((part, i) => 
          part.toLowerCase() === searchQuery.toLowerCase() 
            ? <span key={i} className="bg-yellow-300 dark:bg-yellow-600/50 text-black dark:text-white rounded px-0.5">{part}</span> 
            : part
      );
  };
  
  const submitRename = (oldName: string) => {
      const trimmedNew = newSpeakerName.trim();
      if(file && trimmedNew && trimmedNew !== oldName) {
          onRenameSpeaker(file.id, oldName, trimmedNew);
          setEditingSpeaker(null);
          setNewSpeakerName("");
      }
  };

  if (!file) return null;
  const isAudio = file.type === 'AUDIO';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
       <div className="bg-white dark:bg-slate-900 w-[95%] h-[90%] max-w-7xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200">
          <div className="h-16 bg-gray-50 dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
             <div className="flex items-center gap-4">
                 <div className={`p-2 rounded-lg ${isAudio ? 'bg-blue-100 text-blue-600 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                     {isAudio ? <Play size={20} /> : <FileText size={20} />}
                 </div>
                 <div className="text-left">
                     <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate max-w-md">{file.name}</h2>
                     <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                         {personName && <span className="flex items-center gap-1"><User size={12} /> {personName}</span>}
                         <span className="bg-gray-200 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">{file.type}</span>
                     </div>
                 </div>
             </div>
             <div className="flex items-center gap-2">
                 {fileUrl && (
                     <a href={fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                         <ExternalLink size={18} />
                         <span className="hidden sm:inline text-xs font-bold">Abrir Original</span>
                     </a>
                 )}
                 <div className="w-px h-6 bg-gray-200 dark:bg-slate-800 mx-2"></div>
                 <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                     <X size={24} />
                 </button>
             </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
             <div className="w-1/3 bg-gray-50 dark:bg-slate-925 border-r border-gray-200 dark:border-slate-800 flex flex-col p-6 flex-shrink-0">
                 {isAudio ? (
                     <div className="w-full space-y-6">
                         <div className="aspect-video bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-inner flex items-center justify-center relative overflow-hidden">
                             <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 dark:from-primary-900/10 to-transparent"></div>
                             {isPlaying && (
                                 <div className="flex gap-1 items-end h-16">
                                     {[...Array(12)].map((_, i) => (
                                         <div key={i} className="w-1.5 bg-blue-500 dark:bg-primary-500 rounded-full animate-pulse" style={{ height: `${20 + Math.random() * 80}%`, animationDuration: `${0.4 + Math.random() * 0.6}s` }}></div>
                                     ))}
                                 </div>
                             )}
                             {!isPlaying && <PlayCircle size={64} className="text-gray-200 dark:text-slate-800" />}
                         </div>
                         <div className="space-y-4">
                             <div className="flex justify-between text-xs font-mono font-bold text-gray-500 dark:text-slate-400">
                                 <span>{formatTime(currentTime)}</span>
                                 <span>{formatTime(duration)}</span>
                             </div>
                             <input type="range" min="0" max={duration || 100} value={currentTime} step="0.1" onChange={(e) => { if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full" />
                             <div className="flex items-center justify-center gap-6 pt-2">
                                 <button onClick={() => skip(-10)} className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-white p-2 transition-colors"><Rewind size={24} /></button>
                                 <button onClick={togglePlay} className="w-16 h-16 bg-blue-600 dark:bg-primary-600 hover:bg-blue-500 dark:hover:bg-primary-500 rounded-full flex items-center justify-center text-white shadow-xl transition-all hover:scale-105 active:scale-95">
                                     {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                                 </button>
                                 <button onClick={() => skip(10)} className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-white p-2 transition-colors"><FastForward size={24} /></button>
                             </div>
                         </div>
                     </div>
                 ) : (
                     <div className="text-center space-y-4 w-full h-full flex flex-col items-center justify-center">
                         {fileUrl ? (
                             <a href={fileUrl} target="_blank" rel="noreferrer" className="group cursor-pointer flex flex-col items-center justify-center w-full h-64 hover:bg-gray-100 dark:hover:bg-slate-900 rounded-2xl transition-colors border-2 border-dashed border-gray-200 dark:border-slate-800">
                                 <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto transition-all shadow-lg border border-gray-100 dark:border-slate-700 group-hover:scale-110">
                                     <FileText size={40} className="text-gray-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-primary-400" />
                                 </div>
                                 <p className="text-sm text-gray-500 dark:text-slate-400 mt-6 font-bold group-hover:text-blue-600 dark:group-hover:text-primary-400 flex items-center gap-2">Ver Documento Original <ExternalLink size={14}/></p>
                             </a>
                         ) : (
                             <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-3xl p-12 opacity-50">
                                 <FileText size={48} className="text-gray-300 dark:text-slate-600 mb-4" />
                                 <p className="text-sm font-bold text-gray-400">Conteúdo Virtual (Texto)</p>
                             </div>
                         )}
                     </div>
                 )}
                 <div className="mt-8 w-full bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col text-left">
                     <button onClick={() => setShowSpeakerTools(!showSpeakerTools)} className="w-full px-5 py-4 flex items-center justify-between text-xs font-black uppercase tracking-widest text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                         <span className="flex items-center gap-2"><Users size={14}/> Interlocutores ({detectedSpeakers.length})</span>
                         {showSpeakerTools ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                     </button>
                     {showSpeakerTools && (
                         <div className="p-4 bg-white dark:bg-slate-950 max-h-64 overflow-y-auto space-y-3 border-t border-gray-100 dark:border-slate-800">
                             {detectedSpeakers.map(speaker => (
                                 <div key={speaker} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 p-3 rounded-xl border border-gray-100 dark:border-slate-800 group/speaker">
                                     {editingSpeaker === speaker ? (
                                         <div className="flex items-center gap-2 flex-1">
                                             <input className="flex-1 text-xs p-2 bg-white dark:bg-slate-800 border-2 border-primary-500 rounded-lg text-gray-900 dark:text-white outline-none" value={newSpeakerName} onChange={e => setNewSpeakerName(e.target.value)} autoFocus onKeyDown={(e) => { if(e.key === 'Enter') submitRename(speaker); if(e.key === 'Escape') setEditingSpeaker(null); }} />
                                             <button onClick={() => submitRename(speaker)} className="p-2 bg-green-500 text-white rounded-lg"><Check size={14}/></button>
                                             <button onClick={() => setEditingSpeaker(null)} className="p-2 bg-gray-400 text-white rounded-lg"><X size={14}/></button>
                                         </div>
                                     ) : (
                                         <>
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-8 h-8 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs text-primary-600 dark:text-primary-400 font-black shrink-0">{speaker.charAt(0).toUpperCase()}</div>
                                                <span className="text-xs text-gray-800 dark:text-slate-200 font-bold truncate">{speaker}</span>
                                            </div>
                                            <button onClick={() => { setEditingSpeaker(speaker); setNewSpeakerName(speaker); }} className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 p-2 opacity-0 group-hover/speaker:opacity-100 transition-all"><Edit3 size={16} /></button>
                                         </>
                                     )}
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>
             </div>
             <div className="flex-1 bg-white dark:bg-slate-900 flex flex-col relative overflow-hidden">
                 <div className="h-14 border-b border-gray-100 dark:border-slate-800 flex items-center px-6 gap-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-20">
                     <Search size={18} className="text-gray-400" />
                     <input className="flex-1 bg-transparent border-none outline-none text-sm text-gray-700 dark:text-slate-300 placeholder-gray-400 font-medium" placeholder="Pesquisar na transcrição..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                     {searchResults.length > 0 && (
                         <div className="flex items-center gap-3 text-xs font-bold text-gray-500 bg-gray-100 dark:bg-slate-800 px-3 py-1.5 rounded-full border border-gray-200 dark:border-slate-700">
                             <span className="font-mono">{currentResultIndex + 1} / {searchResults.length}</span>
                             <div className="flex gap-1">
                                <button onClick={handlePrevResult} className="p-1 hover:text-primary-600 transition-colors"><ChevronUp size={16}/></button>
                                <button onClick={handleNextResult} className="p-1 hover:text-primary-600 transition-colors"><ChevronDown size={16}/></button>
                             </div>
                         </div>
                     )}
                 </div>
                 <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-8 space-y-4 scroll-smooth custom-scrollbar text-left">
                     {processedData ? (
                         processedData.segments.map((seg, idx) => (
                             <div id={`seg-${idx}`} key={idx} onClick={() => isAudio && jumpToSegment(seg.seconds)} className={`p-5 rounded-2xl border-2 transition-all duration-300 cursor-pointer group relative ${activeSegmentIndex === idx && isAudio ? 'bg-primary-50 dark:bg-primary-900/10 border-primary-500/50 shadow-md' : 'bg-transparent border-transparent hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
                                 <div className="flex gap-6">
                                     <span className={`text-[10px] font-black font-mono mt-1.5 min-w-[3.5rem] tracking-tighter ${activeSegmentIndex === idx ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-slate-600'}`}>{seg.timestamp}</span>
                                     <div className="flex-1 space-y-1">
                                         <p className={`text-base leading-relaxed whitespace-pre-wrap ${activeSegmentIndex === idx ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-600 dark:text-slate-300'}`}>{renderHighlightedText(seg.text)}</p>
                                     </div>
                                 </div>
                                 {activeSegmentIndex === idx && isAudio && (
                                     <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-500 rounded-full"></div>
                                 )}
                             </div>
                         ))
                     ) : (
                         <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-6">
                             <div className="relative">
                                 <div className="w-16 h-16 border-4 border-primary-200 dark:border-primary-900/30 border-t-primary-600 rounded-full animate-spin"></div>
                                 <div className="absolute inset-0 flex items-center justify-center"><BrainCircuit className="text-primary-600" size={24}/></div>
                             </div>
                             <p className="font-bold">A carregar transcrição...</p>
                         </div>
                     )}
                 </div>
             </div>
          </div>
       </div>
       {fileUrl && isAudio && (
           <audio ref={audioRef} src={fileUrl} onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
       )}
    </div>
  );
};

export default EvidenceViewer;
