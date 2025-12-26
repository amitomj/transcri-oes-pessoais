
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, FileText, MessageSquare, PlayCircle, Save, FolderOpen, Plus, Trash2,
  CheckCircle2, AlertCircle, Loader2, FileAudio, BrainCircuit, Database, 
  X, Key, Users, File as FileIcon, FileImage, LayoutGrid, Paperclip, Mic, Gavel, Edit2, Check,
  ChevronDown, ChevronRight, StopCircle, Play, Layers, ArrowUp, ArrowDown, LogOut, ExternalLink, AlertTriangle, Sun, Moon, Pencil, ChevronUp, UserPlus, Download, ZapOff, Library, Headphones, Music, HelpCircle, User, Filter, Search as SearchIcon, BookOpen, Settings, ShieldCheck, Zap, Play as PlayIcon
} from 'lucide-react';
import { EvidenceFile, Fact, ProjectState, ChatMessage, ProcessedContent, Person, EvidenceType, Citation, EvidenceCategory, AnalysisReport, SerializedProject, SerializedDatabase, FactStatus, UsageMetadata } from './types';
import { processFile, analyzeFactsFromEvidence, chatWithEvidence, sanitizeTranscript, parseSecondsSafe } from './services/geminiService';
import { exportToWord, saveProjectFile, saveDatabaseFile, loadFromJSON, exportTranscriptsToWord } from './utils/exportService';
import { generateDocumentation } from './utils/documentationGenerator';
import EvidenceViewer from './components/EvidenceViewer';

const initialProjectState: ProjectState = {
  people: [],
  facts: [],
  processedData: [], 
  savedReports: [],
  chatHistory: [],
  lastModified: Date.now(),
};

type View = 'landing' | 'setup' | 'people' | 'analysis' | 'chat' | 'library';

const TokenBadge: React.FC<{ usage?: UsageMetadata, compact?: boolean }> = ({ usage, compact }) => {
    if (!usage) return null;
    return (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 ${compact ? '' : 'mt-2'}`}>
            <Zap size={11} fill="currentColor"/>
            <span title={`Input: ${usage.promptTokens} | Output: ${usage.candidatesTokens}`}>
                {compact ? usage.totalTokens : `Pedido: ${usage.promptTokens} | Resposta: ${usage.candidatesTokens} | Total: ${usage.totalTokens}`} tokens
            </span>
        </div>
    );
};

const CitationGroup: React.FC<{ 
    fileName: string;
    contentLines: string[];
    evidenceFiles: EvidenceFile[]; 
    onSeek: (fileId: string, seconds: number) => void; 
    onOpenOriginal: (fileId: string, page?: number) => void;
    renderInline: (text: string) => React.ReactNode;
}> = ({ fileName, contentLines, evidenceFiles, onSeek, onOpenOriginal, renderInline }) => {
    const evidence = evidenceFiles.find(f => f.name.toLowerCase().includes(fileName.toLowerCase()) || fileName.toLowerCase().includes(f.name.toLowerCase()));
    const allRefs: { label: string, value: number }[] = [];
    contentLines.forEach(line => {
        const regex = /\[(?:.*?@\s*)?(\d{1,2}:\d{2}(?::\d{2})?|P[áa]g\.?\s*\d+)(?:\])?/g; 
        let match;
        while ((match = regex.exec(line)) !== null) {
            const val = match[1];
            if (val.toLowerCase().includes('pág')) {
                const pageNum = parseInt(val.match(/\d+/)?.[0] || "1");
                allRefs.push({ label: val, value: pageNum });
            } else {
                allRefs.push({ label: val, value: parseSecondsSafe(val) });
            }
        }
    });
    const uniqueRefs = allRefs.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i).sort((a,b) => a.value - b.value);
    const isAudio = evidence?.type === 'AUDIO';
    return (
        <div className="my-4 bg-white dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-md transition-all group text-left">
            <div className="px-4 py-3 bg-blue-50 dark:bg-primary-900/20 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {isAudio ? <FileAudio size={16} className="text-primary-600 dark:text-primary-400" /> : <FileText size={16} className="text-orange-600 dark:text-orange-400" />}
                    <span className="text-xs font-black text-gray-700 dark:text-primary-300 uppercase truncate max-w-[300px]" title={fileName}>{fileName}</span>
                </div>
            </div>
            <div className="p-5 text-base text-gray-700 dark:text-slate-300 leading-relaxed space-y-3">
                {contentLines.map((line, i) => (<div key={i}>{renderInline(line)}</div>))}
            </div>
            {evidence && uniqueRefs.length > 0 && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 flex flex-wrap gap-2 items-center">
                    {uniqueRefs.map((ref, idx) => (
                         <button key={idx} onClick={(e) => { e.stopPropagation(); if (isAudio) onSeek(evidence.id, ref.value); else onOpenOriginal(evidence.id, ref.value); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border shadow-sm ${isAudio ? 'bg-blue-100 dark:bg-primary-900/30 text-blue-700 dark:text-primary-300 border-blue-200 hover:bg-blue-200' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 hover:bg-orange-200'}`}>
                            {isAudio ? <Play size={10} fill="currentColor"/> : <BookOpen size={10}/>} {ref.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<View>('landing');
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]); 
  const [project, setProject] = useState<ProjectState>(initialProjectState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const abortProcessingRef = useRef<boolean>(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [dragOverCategory, setDragOverCategory] = useState<EvidenceCategory | null>(null);

  const projectInputRef = useRef<HTMLInputElement>(null);
  const databaseInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  useEffect(() => {
    if (currentView === 'chat') {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [project.chatHistory, currentView]);

  const handleGlobalError = (e: any) => {
      if (e.message === "AUTH_FAILED") {
          alert("A chave API foi rejeitada ou é inválida.");
          setCurrentView('landing'); 
      } else if (e.message?.includes('429')) {
          setShowQuotaModal(true);
      } else {
          alert(`Erro: ${e.message}`);
      }
  };

  const getFileType = (file: File): EvidenceType => {
      const name = file.name.toLowerCase();
      if (file.type.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a')) return 'AUDIO';
      if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
      return 'OTHER';
  };

  const handleLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const result = await loadFromJSON(file);
        if (result.type === 'project') {
            setProject(prev => ({ ...prev, ...result.data }));
        } else if (result.type === 'database') {
            setProject(prev => ({ ...prev, processedData: result.data.processedData }));
            const restoredManifest = result.data.fileManifest.map((m: any) => ({
                ...m,
                file: null,
                isVirtual: true
            }));
            setEvidenceFiles(prev => {
                const existingNames = new Set(prev.map(f => f.name));
                const filteredRestored = restoredManifest.filter((f: any) => !existingNames.has(f.name));
                return [...prev, ...filteredRestored];
            });
        }
        alert("Ficheiro carregado com sucesso.");
    } catch (err: any) {
        alert(err.message);
    }
    e.target.value = '';
  };

  const peopleMap = React.useMemo(() => {
      const map: Record<string, string> = {};
      evidenceFiles.forEach(f => {
          if (f.personId) {
              const p = project.people.find(person => person.id === f.personId);
              if (p) map[f.id] = p.name;
          }
      });
      return map;
  }, [evidenceFiles, project.people]);

  const handleOpenOriginal = (fileId: string, pageOrSeconds?: number) => {
      const file = evidenceFiles.find(f => f.id === fileId);
      if (file && file.file) {
          let url = URL.createObjectURL(file.file);
          if (file.type === 'PDF' && pageOrSeconds) url += `#page=${pageOrSeconds}`;
          window.open(url, '_blank');
      } else {
          alert("Ficheiro original não disponível (Virtual). Por favor, adicione o ficheiro físico na aba DADOS.");
      }
  };

  const renderTextWithInlineCitations = (text: string) => {
      const parts = text.split(/(\[.*?\])/g);
      return (
        <span>
            {parts.map((part, i) => {
                const matchNameRef = part.match(/^\[(.*?)\s*@\s*(.*?)\]$/); 
                if (matchNameRef) {
                    const fileRef = matchNameRef[1];
                    const refPart = matchNameRef[2];
                    const file = evidenceFiles.find(f => f.name.toLowerCase().includes(fileRef.toLowerCase()) || fileRef.toLowerCase().includes(f.name.toLowerCase()));
                    if (file) {
                        const isAudio = file.type === 'AUDIO';
                        return (
                            <button key={i} onClick={(e) => { 
                                e.stopPropagation(); 
                                if (isAudio) { 
                                    // Always trigger a seek even if ID is same
                                    setActiveEvidenceId(null);
                                    setTimeout(() => {
                                        setActiveEvidenceId(file.id); 
                                        setSeekSeconds(parseSecondsSafe(refPart));
                                    }, 0);
                                } else { 
                                    handleOpenOriginal(file.id, parseInt(refPart.match(/\d+/)?.[0] || "1")); 
                                } 
                            }} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors border shadow-sm mx-1 ${isAudio ? 'bg-blue-100 dark:bg-primary-900/40 text-blue-700 dark:text-primary-300 border-blue-200 hover:bg-blue-200' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-200 hover:bg-orange-200'}`}>
                                {isAudio ? <Play size={9} fill="currentColor"/> : <BookOpen size={9}/>} {refPart}
                            </button>
                        );
                    }
                }
                return <span key={i}>{part}</span>;
            })}
        </span>
      );
  };

  const renderMessageContent = (msg: ChatMessage) => {
      const lines = msg.text.split('\n');
      const renderedElements: React.ReactNode[] = [];
      let currentGroup: { fileName: string, lines: string[] } | null = null;
      lines.forEach((line, i) => {
          const match = line.match(/\[(.*?)\s*@/);
          const fileNameRef = match ? match[1].trim() : null;
          if (fileNameRef) {
              if (currentGroup && currentGroup.fileName.toLowerCase() === fileNameRef.toLowerCase()) currentGroup.lines.push(line);
              else {
                  if (currentGroup) renderedElements.push(<CitationGroup key={`group-${i}`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
                  currentGroup = { fileName: fileNameRef, lines: [line] };
              }
          } else {
              if (currentGroup) {
                  renderedElements.push(<CitationGroup key={`group-${i}`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
                  currentGroup = null;
              }
              if (line.trim()) renderedElements.push(<p key={`text-${i}`} className="mb-3 last:mb-0 leading-relaxed text-left text-base">{renderTextWithInlineCitations(line)}</p>);
          }
      });
      if (currentGroup) renderedElements.push(<CitationGroup key={`group-last`} fileName={currentGroup.fileName} contentLines={currentGroup.lines} evidenceFiles={evidenceFiles} onSeek={(fid, sec) => { setActiveEvidenceId(fid); setSeekSeconds(sec); }} onOpenOriginal={handleOpenOriginal} renderInline={renderTextWithInlineCitations}/>);
      if (msg.role === 'model' && msg.usage) renderedElements.push(<TokenBadge key="usage" usage={msg.usage} />);
      return renderedElements;
  };

  const addFiles = (fileList: FileList | File[], category: EvidenceCategory) => {
      setEvidenceFiles(prevFiles => {
          const updatedFiles = [...prevFiles];
          const newFilesToAdd: EvidenceFile[] = [];
          Array.from(fileList).forEach((f: File) => {
              if (f.size > 90 * 1024 * 1024) return;
              const relativePath = (f as any).webkitRelativePath || "";
              let folderName = relativePath ? (relativePath.split('/').slice(-2, -1)[0] || "Raiz") : "Raiz";
              const existingIndex = updatedFiles.findIndex(ev => ev.name === f.name && ev.category === category);
              if (existingIndex !== -1) {
                  updatedFiles[existingIndex] = { ...updatedFiles[existingIndex], file: f, isVirtual: false, size: f.size };
              } else {
                  newFilesToAdd.push({ id: Math.random().toString(36).substr(2, 9), file: f, name: f.name, folder: folderName, type: getFileType(f), category: category, size: f.size });
              }
          });
          return [...updatedFiles, ...newFilesToAdd];
      });
  };

  const runProcessing = async (scope: { type: 'ALL' | 'CATEGORY' | 'FOLDER' | 'FILE', value?: string }) => {
     const unprocessed = evidenceFiles.filter(f => {
         if (f.isVirtual || project.processedData.find(pd => pd.fileId === f.id)) return false;
         if (scope.type === 'ALL') return true;
         if (scope.type === 'CATEGORY') return f.category === scope.value;
         if (scope.type === 'FILE') return f.id === scope.value;
         return false;
     });
     if (unprocessed.length === 0) { alert("Não existem novos ficheiros físicos para processar nesta categoria."); return; }
     for (const file of unprocessed) {
         if (abortProcessingRef.current) break;
         setProcessingQueue(prev => [...prev, file.id]);
         try {
             const result = await processFile(file, userApiKey);
             setProject(prev => ({ ...prev, processedData: [...prev.processedData, result] }));
         } catch (e: any) { handleGlobalError(e); } 
         finally { setProcessingQueue(prev => prev.filter(id => id !== file.id)); }
     }
  };

  const runAnalysis = async () => {
      setIsAnalyzing(true);
      try {
          const report = await analyzeFactsFromEvidence(project.processedData, project.facts, peopleMap, evidenceFiles, userApiKey);
          setProject(prev => ({ ...prev, savedReports: [report, ...prev.savedReports] }));
          setSelectedReportId(report.id);
          setCurrentView('analysis');
      } catch (e: any) { handleGlobalError(e); }
      finally { setIsAnalyzing(false); }
  };

  const handleChat = async () => {
      if (!chatInput.trim()) return;
      const msg: ChatMessage = { id: Date.now().toString(), role: 'user', text: chatInput, timestamp: Date.now() };
      setProject(p => ({ ...p, chatHistory: [...p.chatHistory, msg] }));
      setChatInput(""); setIsChatting(true);
      try {
          const resp = await chatWithEvidence(project.processedData, [], msg.text, peopleMap, evidenceFiles, userApiKey);
          setProject(p => ({ ...p, chatHistory: [...p.chatHistory, { id: (Date.now()+1).toString(), role: 'model', text: resp.text, timestamp: Date.now(), usage: resp.usage }] }));
      } catch(e: any) { handleGlobalError(e); }
      finally { setIsChatting(false); }
  };

  const handleRenameSpeaker = (fileId: string, oldName: string, newName: string) => {
    setProject(prev => ({
        ...prev,
        processedData: prev.processedData.map(pd => {
            if (pd.fileId === fileId) {
                const escapedOldName = oldName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const updatedSegments = pd.segments.map(seg => ({
                    ...seg,
                    text: seg.text.replace(new RegExp(`^\\s*\\*\\*${escapedOldName}\\*\\*[:\\s]*`, 'g'), `**${newName}**: `)
                                  .replace(new RegExp(`^\\s*${escapedOldName}:`, 'g'), `${newName}: `)
                }));
                return { ...pd, segments: updatedSegments, fullText: updatedSegments.map(s => `[${s.timestamp}] ${s.text}`).join('\n') };
            }
            return pd;
        })
    }));
  };

  const renderUploadSection = (title: string, category: EvidenceCategory, icon: React.ReactNode, description: string) => {
    const filesInCategory = evidenceFiles.filter(f => f.category === category);
    const unproccessedCount = filesInCategory.filter(f => !f.isVirtual && !project.processedData.some(pd => pd.fileId === f.id)).length;
    const folders: Record<string, EvidenceFile[]> = {};
    filesInCategory.forEach(f => {
        const folder = f.folder || 'Raiz';
        if (!folders[folder]) folders[folder] = [];
        folders[folder].push(f);
    });

    return (
        <div 
          className={`bg-white dark:bg-slate-900 p-8 rounded-3xl border-2 border-dashed transition-all flex flex-col min-h-[400px] ${dragOverCategory === category ? 'border-primary-500 bg-primary-50/5' : 'border-gray-200 dark:border-slate-800'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOverCategory(category); }}
          onDragLeave={() => setDragOverCategory(null)}
          onDrop={(e) => { e.preventDefault(); setDragOverCategory(null); if(e.dataTransfer.files) addFiles(e.dataTransfer.files, category); }}
        >
            <div className="flex items-center justify-between mb-5">
                <div className="w-14 h-14 bg-gray-50 dark:bg-slate-950 rounded-2xl flex items-center justify-center shadow-inner">{icon}</div>
                <div className="flex flex-col items-end">
                  <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{filesInCategory.length} Itens</span>
                  {unproccessedCount > 0 && (
                      <button onClick={() => runProcessing({ type: 'CATEGORY', value: category })} className="mt-1 text-[10px] font-black text-primary-600 hover:text-primary-500 flex items-center gap-1.5 uppercase transition-colors">
                        <PlayCircle size={12}/> Processar Novos ({unproccessedCount})
                      </button>
                  )}
                </div>
            </div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2">{title}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 mb-6">{description}</p>
            <div className="flex-1 space-y-4 max-h-80 overflow-y-auto pr-3 custom-scrollbar mb-6 text-left">
                {Object.entries(folders).map(([folderName, files]) => {
                    const folderKey = `${category}-${folderName}`;
                    const isExpanded = expandedFolders[folderKey] !== false;
                    return (
                        <div key={folderKey} className="space-y-2">
                            <button onClick={() => setExpandedFolders(prev => ({ ...prev, [folderKey]: !isExpanded }))} className="w-full flex items-center gap-2.5 text-[11px] font-black text-gray-400 uppercase tracking-widest hover:text-primary-500 transition-colors">
                                {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                <FolderOpen size={14}/> {folderName} ({files.length})
                            </button>
                            {isExpanded && files.map(file => {
                                const isProcessed = project.processedData.some(pd => pd.fileId === file.id);
                                const isQueued = processingQueue.includes(file.id);
                                return (
                                  <div key={file.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${file.isVirtual ? 'bg-orange-50/30 border-orange-100 dark:border-orange-900/30' : 'bg-gray-50 dark:bg-slate-950/50 border-gray-100 dark:border-slate-800'} group`}>
                                      <div className="flex flex-col truncate flex-1 pr-3">
                                          <span className={`text-xs font-bold truncate ${file.isVirtual ? 'text-orange-600' : 'text-gray-700 dark:text-slate-300'}`}>{file.name}</span>
                                          {file.isVirtual && <span className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Requer Ficheiro Físico</span>}
                                      </div>
                                      <div className="flex items-center gap-2.5 shrink-0">
                                          {isProcessed ? <CheckCircle2 size={14} className="text-green-500"/> : isQueued ? <Loader2 size={14} className="animate-spin text-primary-500"/> : !file.isVirtual ? (
                                              <button onClick={() => runProcessing({ type: 'FILE', value: file.id })} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><PlayCircle size={16}/></button>
                                          ) : null}
                                          <button onClick={() => setEvidenceFiles(prev => prev.filter(f => f.id !== file.id))} className="p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16}/></button>
                                      </div>
                                  </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-auto">
                <label className="flex items-center justify-center gap-2.5 py-3.5 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-slate-400 hover:bg-primary-600 hover:text-white hover:border-primary-600 cursor-pointer transition-all shadow-sm">
                    <FileIcon size={16}/> Ficheiros
                    <input type="file" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files, category)} />
                </label>
                <label className="flex items-center justify-center gap-2.5 py-3.5 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-slate-400 hover:bg-primary-600 hover:text-white hover:border-primary-600 cursor-pointer transition-all shadow-sm">
                    <FolderOpen size={16}/> Pastas
                    <input type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} className="hidden" onChange={e => e.target.files && addFiles(e.target.files, category)} />
                </label>
            </div>
        </div>
    );
  };

  const currentReport = project.savedReports.find(r => r.id === selectedReportId) || project.savedReports[0];

  if (currentView === 'landing') return (
    <div className="h-full flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-100 via-gray-50 to-white dark:from-slate-900 dark:via-slate-950">
        <div className="max-w-4xl w-full text-center space-y-10 animate-in fade-in duration-500 flex flex-col items-center">
            <div className="w-24 h-24 bg-primary-600 rounded-[2.5rem] flex items-center justify-center shadow-2xl mb-2 hover:scale-105 transition-transform"><Database size={48} className="text-white"/></div>
            <div>
                <h1 className="text-5xl font-black text-gray-900 dark:text-white mb-3 uppercase tracking-tighter">Veritas Forense V2</h1>
                <p className="text-lg text-gray-500 dark:text-slate-400 font-semibold">Sistema de Transcrição e Análise Forense Multimodal Profissional</p>
            </div>
            <div className="w-full max-w-2xl bg-white dark:bg-slate-900 p-12 rounded-[3rem] border border-gray-200 dark:border-slate-800 shadow-2xl text-left space-y-10">
                <div className="space-y-4">
                    <h3 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-4">Configuração Geral</h3>
                    <input type="password" className="w-full bg-gray-50 dark:bg-slate-950 border-2 border-gray-200 dark:border-slate-800 p-6 rounded-3xl text-lg outline-none focus:border-primary-500 transition-all dark:text-white font-mono shadow-inner" placeholder="Insira a sua Gemini API Key..." value={userApiKey} onChange={e => setUserApiKey(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-5">
                    <button onClick={() => projectInputRef.current?.click()} className="p-6 bg-gray-50 dark:bg-slate-950 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-800 rounded-[2rem] flex items-center gap-4 cursor-pointer group transition-all text-left shadow-sm">
                      <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-2xl"><FileText size={28} className="text-green-600"/></div>
                      <div className="text-left"><h3 className="font-black text-sm dark:text-white uppercase tracking-tight">Projeto</h3><p className="text-[10px] text-gray-500 font-bold uppercase">Restaurar estado</p></div>
                    </button>
                    <button onClick={() => databaseInputRef.current?.click()} className="p-6 bg-gray-50 dark:bg-slate-950 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-800 rounded-[2rem] flex items-center gap-4 cursor-pointer group transition-all text-left shadow-sm">
                      <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-2xl"><Database size={28} className="text-blue-600"/></div>
                      <div className="text-left"><h3 className="font-black text-sm dark:text-white uppercase tracking-tight">Base Dados</h3><p className="text-[10px] text-gray-500 font-bold uppercase">Transcrições</p></div>
                    </button>
                </div>
                <button onClick={() => setCurrentView('setup')} className="w-full p-6 bg-primary-600 hover:bg-primary-500 text-white rounded-3xl font-black shadow-xl flex items-center justify-center gap-4 transition-all uppercase tracking-[0.2em] text-lg group">Iniciar Aplicação <ChevronRight size={32} className="group-hover:translate-x-1 transition-transform"/></button>
            </div>
        </div>
        <input type="file" ref={projectInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
        <input type="file" ref={databaseInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-200 overflow-hidden">
        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col z-20 shrink-0 shadow-lg overflow-y-auto custom-scrollbar transition-all duration-300">
            <div onClick={() => setCurrentView('landing')} className="p-6 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100 dark:border-slate-800/50 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center font-black text-white shadow-xl shrink-0">V2</div>
                <div className="flex flex-col overflow-hidden text-left">
                    <span className="font-black text-sm uppercase tracking-tighter text-gray-900 dark:text-white truncate">Veritas Forense</span>
                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-widest">Professional</span>
                </div>
            </div>
            <nav className="flex flex-col gap-2 w-full px-4">
                {[
                    {id:'setup', icon:LayoutGrid, label:'Área de Dados'},
                    {id:'people', icon:Users, label:'Intervenientes'},
                    {id:'library', icon:Library, label:'Biblioteca'},
                    {id:'analysis', icon:FileText, label:'Análise Factos'},
                    {id:'chat', icon:MessageSquare, label:'Chat Assistente'}
                ].map(item => (
                    <button key={item.id} onClick={() => setCurrentView(item.id as View)} className={`w-full px-5 py-4 rounded-2xl flex items-center gap-4 transition-all group ${currentView === item.id ? 'bg-primary-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
                      <item.icon size={22}/>
                      <span className="text-xs font-black uppercase tracking-widest">{item.label}</span>
                    </button>
                ))}
            </nav>
            <div className="mx-6 h-px bg-gray-100 dark:bg-slate-800 my-6"></div>
            <div className="flex flex-col gap-2 w-full px-4 pb-12">
                <button onClick={() => setIsDarkMode(!isDarkMode)} className="w-full px-5 py-3.5 rounded-2xl flex items-center gap-4 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all group">
                    {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    <span className="text-xs font-black uppercase tracking-widest">{isDarkMode ? 'Modo Claro' : 'Modo Escuro'}</span>
                </button>
                <button onClick={() => setIsSettingsOpen(true)} className="w-full px-5 py-3.5 rounded-2xl flex items-center gap-4 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all group">
                    <Settings size={20}/>
                    <span className="text-xs font-black uppercase tracking-widest">Definições</span>
                </button>
                <div className="grid grid-cols-2 gap-2 px-2 mt-4">
                    <button onClick={() => saveProjectFile(project)} className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-gray-50 dark:bg-slate-950 border border-gray-100 dark:border-slate-800 text-gray-400 hover:text-blue-600 transition-all group">
                        <ArrowDown size={18}/>
                        <span className="text-[8px] font-black uppercase">Save PRJ</span>
                    </button>
                    <button onClick={() => saveDatabaseFile(project, evidenceFiles)} className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-gray-50 dark:bg-slate-950 border border-gray-100 dark:border-slate-800 text-gray-400 hover:text-emerald-600 transition-all group">
                        <ArrowDown size={18}/>
                        <span className="text-[8px] font-black uppercase">Save DB</span>
                    </button>
                </div>
            </div>
            <input type="file" ref={projectInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
            <input type="file" ref={databaseInputRef} accept=".json" onChange={handleLoadProject} className="hidden" />
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden relative">
            <header className="h-20 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 backdrop-blur flex items-center px-10 justify-between shrink-0 text-left">
                <h1 className="text-xl font-black text-gray-800 dark:text-white uppercase tracking-tighter">
                    {currentView === 'setup' && 'Gestão de Evidências e Metadados'}
                    {currentView === 'library' && 'Arquivo Digital de Depoimentos'}
                    {currentView === 'analysis' && 'Relatório de Cruzamento e Factos'}
                    {currentView === 'chat' && 'Análise Assistida por IA'}
                    {currentView === 'people' && 'Intervenientes do Processo'}
                </h1>
                <div className="flex gap-6 text-[11px] font-mono text-gray-500 uppercase items-center">
                    {userApiKey ? <span className="text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-900/10 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800/50 flex items-center gap-1.5"><ShieldCheck size={14}/> Gemini Pro Ativo</span> : <span className="text-amber-500 font-bold bg-amber-50 dark:bg-amber-900/10 px-3 py-1.5 rounded-full border border-amber-100 dark:border-amber-800/50 flex items-center gap-1.5"><ZapOff size={14}/> Modo Offline</span>}
                    <div className="h-6 w-px bg-gray-200 dark:bg-slate-800"></div>
                    <span className="font-bold">Total Ficheiros: <span className="text-primary-600">{evidenceFiles.length}</span></span>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-10 bg-gray-50 dark:bg-slate-950">
                {currentView === 'setup' && (
                    <div className="max-w-screen-2xl mx-auto space-y-12 pb-24 text-left animate-in fade-in duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                            {renderUploadSection("Depoimentos", 'TESTIMONY', <Mic className="text-blue-500" size={28}/>, "Upload de áudios (MP3, WAV, M4A) para transcrição automática.")}
                            {renderUploadSection("Autos de Prova", 'INQUIRY', <Gavel className="text-red-500" size={28}/>, "PDFs de inquirições, autos de notícia e relatórios periciais.")}
                            {renderUploadSection("Anexos Diversos", 'OTHER', <Paperclip className="text-amber-500" size={28}/>, "Outros documentos, fotos ou transcrições manuais.")}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 pt-10 border-t border-gray-200 dark:border-slate-800">
                            <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-gray-200 dark:border-slate-800 text-left shadow-md">
                                <h3 className="text-xl font-black text-gray-800 dark:text-white mb-8 flex items-center gap-3 uppercase tracking-tight"><CheckCircle2 className="text-emerald-500" size={24}/> Factos a Validar</h3>
                                <div className="space-y-6 max-h-[500px] overflow-y-auto pr-3 custom-scrollbar">
                                    {project.facts.map((fact, idx) => (
                                        <div key={fact.id} className="flex gap-5 group">
                                            <div className="flex flex-col items-center shrink-0">
                                                <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-gray-400 group-hover:bg-primary-500 group-hover:text-white transition-all">#{idx+1}</div>
                                            </div>
                                            <textarea value={fact.text} onChange={(e) => setProject(p => ({ ...p, facts: p.facts.map(f => f.id === fact.id ? { ...f, text: e.target.value } : f) }))} className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-2xl p-5 text-base leading-relaxed outline-none focus:border-primary-500 transition-all resize-none h-32 dark:text-slate-300" placeholder="Descreva o facto..."/>
                                            <button onClick={() => setProject(p => ({ ...p, facts: p.facts.filter(f => f.id !== fact.id) }))} className="self-center p-3 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={22}/></button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setProject(p => ({ ...p, facts: [...p.facts, { id: Math.random().toString(36), text: "" }] }))} className="mt-8 text-xs font-black text-primary-600 uppercase tracking-[0.2em] flex items-center gap-3 hover:text-primary-500 transition-colors bg-primary-50 dark:bg-primary-900/10 px-6 py-3 rounded-2xl border border-primary-100 dark:border-primary-900/30"><Plus size={18}/> Adicionar Facto</button>
                            </div>
                            <div className="flex flex-col justify-center items-center p-12 border-2 border-dashed border-gray-300 dark:border-slate-800 rounded-[3rem] bg-white/50 dark:bg-slate-900/20 text-center shadow-inner">
                                <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-[2rem] flex items-center justify-center text-primary-600 mb-8"><PlayCircle size={40}/></div>
                                <h3 className="text-3xl font-black dark:text-white mb-4 uppercase tracking-tighter">Análise Cruzada</h3>
                                <p className="text-base text-gray-500 dark:text-slate-400 mb-10 max-w-sm">A IA irá processar os depoimentos e gerar um relatório forense detalhado.</p>
                                <button onClick={runAnalysis} disabled={isAnalyzing || project.processedData.length === 0} className="px-12 py-5 bg-primary-600 hover:bg-primary-500 text-white rounded-[2rem] font-black shadow-2xl transition-all disabled:opacity-50 flex items-center gap-4 uppercase tracking-[0.2em] text-sm">
                                    {isAnalyzing ? <Loader2 className="animate-spin" size={20}/> : "Gerar Relatório Forense"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {currentView === 'library' && (
                    <div className="max-w-screen-2xl mx-auto space-y-10 text-left animate-in fade-in">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-black dark:text-white flex items-center gap-4 uppercase tracking-tighter"><Library className="text-primary-500" size={32}/> Biblioteca de Depoimentos</h2>
                            <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="bg-white dark:bg-slate-900 border-2 border-gray-100 dark:border-slate-800 rounded-2xl py-3 px-6 text-sm font-bold outline-none focus:border-primary-500 w-80" placeholder="Pesquisar depoimento..."/>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                            {evidenceFiles.filter(f => f.type === 'AUDIO' && f.name.toLowerCase().includes(librarySearch.toLowerCase())).map(file => {
                                const processed = project.processedData.find(pd => pd.fileId === file.id);
                                return (
                                    <div key={file.id} className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-gray-200 dark:border-slate-800 shadow-md hover:shadow-2xl transition-all group cursor-pointer text-left flex flex-col h-full" onClick={() => setActiveEvidenceId(file.id)}>
                                        <div className="w-16 h-16 bg-blue-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center text-blue-600 mb-6 transition-all group-hover:scale-110 shadow-inner"><FileAudio size={32}/></div>
                                        <h3 className="font-black text-gray-800 dark:text-white truncate pr-4 text-base mb-2">{file.name}</h3>
                                        <div className="flex-1 mt-2">{processed && <TokenBadge usage={processed.usage} compact />}</div>
                                        <div className="mt-8 flex items-center justify-between">
                                            <span className={`text-[11px] uppercase font-black tracking-[0.2em] px-3 py-1 rounded-lg ${processed ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>{processed ? 'CONCLUÍDO' : 'PENDENTE'}</span>
                                            <div className="p-3 bg-primary-600 text-white rounded-xl opacity-0 group-hover:opacity-100 transition-all shadow-lg"><PlayIcon size={18} fill="currentColor"/></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {currentView === 'analysis' && (
                    <div className="max-w-6xl mx-auto text-left pb-16 animate-in fade-in duration-500">
                        {currentReport ? (
                            <div className="bg-white dark:bg-slate-900 p-12 rounded-[3rem] border border-gray-200 dark:border-slate-800 shadow-xl space-y-10">
                                <div className="flex justify-between items-start border-b pb-8 dark:border-slate-800">
                                    <div className="space-y-2">
                                        <h2 className="text-4xl font-black dark:text-white uppercase tracking-tighter">{currentReport.name}</h2>
                                        <TokenBadge usage={currentReport.usage} />
                                    </div>
                                    <button onClick={() => exportToWord(currentReport, currentReport.name)} className="flex items-center gap-3 px-8 py-4 bg-primary-600 text-white rounded-2xl text-xs font-black hover:bg-primary-500 shadow-xl transition-all uppercase tracking-widest"><Download size={20}/> Exportar Word</button>
                                </div>
                                <section>
                                    <h3 className="text-xl font-black mb-6 flex items-center gap-3 text-gray-800 dark:text-white uppercase tracking-tight"><BrainCircuit className="text-primary-500" size={24}/> Parecer do Analista Forense</h3>
                                    <div className="p-8 bg-gray-50 dark:bg-slate-950 rounded-[2rem] border-2 border-gray-100 dark:border-slate-800 text-base italic leading-relaxed text-gray-700 dark:text-slate-300 shadow-inner">"{currentReport.generalConclusion}"</div>
                                </section>
                                <section className="space-y-8">
                                    <h3 className="text-xl font-black flex items-center gap-3 text-gray-800 dark:text-white uppercase tracking-tight"><CheckCircle2 className="text-emerald-500" size={24}/> Factos Analisados e Cruzados</h3>
                                    {currentReport.results.map((res, i) => (
                                        <div key={i} className="p-8 bg-white dark:bg-slate-925 rounded-3xl border border-gray-200 dark:border-slate-800 shadow-sm hover:shadow-xl hover:border-primary-500/30 transition-all group">
                                            <div className="flex justify-between items-start mb-6">
                                                <h4 className="font-black text-lg text-gray-900 dark:text-white flex-1 mr-8 leading-tight">#{i+1}: {res.factText}</h4>
                                                <span className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase shrink-0 tracking-[0.15em] shadow-sm ${res.status === FactStatus.CONFIRMED ? 'bg-green-100 text-green-700' : res.status === FactStatus.DENIED ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{res.status}</span>
                                            </div>
                                            <p className="text-base text-gray-600 dark:text-slate-400 mb-8 leading-relaxed font-medium">{res.summary}</p>
                                            
                                            {res.citations && res.citations.length > 0 && (
                                                <div className="mt-6 space-y-3">
                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Evidências Citadas:</p>
                                                    <div className="grid grid-cols-1 gap-3">
                                                        {res.citations.map((cit, idx) => {
                                                            const evidence = evidenceFiles.find(ef => ef.id === cit.fileId);
                                                            const isAudio = evidence?.type === 'AUDIO';
                                                            return (
                                                                <div key={idx} className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-800">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            {isAudio ? <FileAudio size={14} className="text-primary-500"/> : <FileText size={14} className="text-orange-500"/>}
                                                                            <span className="text-[10px] font-black uppercase text-gray-500">{cit.fileName} @ {cit.timestamp}</span>
                                                                        </div>
                                                                        <button 
                                                                            onClick={() => { 
                                                                                if (isAudio) { 
                                                                                    setActiveEvidenceId(null);
                                                                                    setTimeout(() => {
                                                                                        setActiveEvidenceId(cit.fileId); 
                                                                                        setSeekSeconds(cit.seconds);
                                                                                    }, 0);
                                                                                } else { 
                                                                                    handleOpenOriginal(cit.fileId, parseSecondsSafe(cit.timestamp)); 
                                                                                } 
                                                                            }} 
                                                                            className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-[10px] font-black uppercase text-primary-600 hover:bg-primary-50 transition-colors shadow-sm"
                                                                        >
                                                                            {isAudio ? <><Play size={10} fill="currentColor"/> Ouvir</> : <><BookOpen size={10}/> Ver</>}
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-xs italic text-gray-500 dark:text-slate-400 leading-relaxed">"{cit.text}"</p>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </section>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-32 text-gray-400 gap-6 opacity-60">
                                <div className="w-24 h-24 bg-gray-100 dark:bg-slate-900 rounded-[2rem] flex items-center justify-center"><Database size={48}/></div>
                                <p className="font-black uppercase tracking-[0.2em] text-sm">Gere um relatório na aba de Dados.</p>
                            </div>
                        )}
                    </div>
                )}

                {currentView === 'chat' && (
                    <div className="h-full flex flex-col max-w-screen-xl mx-auto">
                        <div className="flex-1 overflow-y-auto space-y-8 pb-12 px-10 custom-scrollbar">
                            {project.chatHistory.map(msg => (
                                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-4 duration-500`}>
                                    <div className={`max-w-[85%] rounded-[2.5rem] p-8 shadow-xl text-base ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 border border-gray-200 dark:border-slate-800 rounded-tl-none'}`}>
                                        <div className="flex items-center gap-3 mb-4 text-[11px] font-black uppercase tracking-[0.2em] opacity-70">
                                            {msg.role === 'user' ? <User size={14}/> : <BrainCircuit size={14}/>}
                                            {msg.role === 'user' ? 'Analista' : 'Veritas IA'}
                                        </div>
                                        {renderMessageContent(msg)}
                                    </div>
                                </div>
                            ))}
                            {isChatting && <div className="flex justify-start"><div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] flex items-center gap-4 shadow-md"><Loader2 className="animate-spin text-primary-500"/><span className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">Analisando evidências...</span></div></div>}
                            <div ref={chatEndRef}/>
                        </div>
                        <div className="h-32 bg-white/50 dark:bg-slate-950/50 backdrop-blur-xl border-t border-gray-200 dark:border-slate-800 flex items-center px-12 gap-5 shrink-0">
                            <div className="flex-1 bg-white dark:bg-slate-900 rounded-[2rem] border-2 border-gray-100 dark:border-slate-800 flex items-center px-6 shadow-2xl focus-within:border-primary-500 group">
                                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} className="flex-1 bg-transparent py-6 text-base font-medium outline-none dark:text-slate-200" placeholder="Pergunte algo sobre o caso..."/>
                                <button onClick={handleChat} disabled={isChatting || !chatInput.trim()} className="p-3.5 bg-primary-600 text-white rounded-2xl hover:bg-primary-500 shadow-lg active:scale-95"><ArrowUp size={24} strokeWidth={3}/></button>
                            </div>
                        </div>
                    </div>
                )}
                {currentView === 'people' && (
                    <div className="max-w-5xl mx-auto text-left animate-in fade-in duration-500">
                        <div className="bg-white dark:bg-slate-900 p-12 rounded-[3rem] border border-gray-200 dark:border-slate-800 shadow-xl">
                            <h3 className="text-2xl font-black mb-10 flex items-center gap-4 text-gray-900 dark:text-white uppercase tracking-tighter"><Users className="text-primary-500" size={32}/> Intervenientes do Caso</h3>
                            <div className="space-y-6 mb-12">
                                {project.people.map(person => (
                                    <div key={person.id} className="flex gap-6 items-center bg-gray-50 dark:bg-slate-950 p-6 rounded-3xl border border-gray-100 dark:border-slate-800 group">
                                        <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 font-black shadow-inner uppercase text-lg shrink-0">{person.name?.charAt(0) || '?'}</div>
                                        <div className="flex-1 grid grid-cols-2 gap-8">
                                            <input value={person.name} onChange={e => setProject(p => ({ ...p, people: p.people.map(ps => ps.id === person.id ? { ...ps, name: e.target.value } : ps) }))} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl px-4 py-3 font-black text-base outline-none dark:text-white" placeholder="Nome completo..."/>
                                            <input value={person.role || ""} onChange={e => setProject(p => ({ ...p, people: p.people.map(ps => ps.id === person.id ? { ...ps, role: e.target.value } : ps) }))} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl px-4 py-3 text-base outline-none text-gray-500 font-bold" placeholder="Cargo/Papel..."/>
                                        </div>
                                        <button onClick={() => setProject(p => ({ ...p, people: p.people.filter(ps => ps.id !== person.id) }))} className="p-3 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={24}/></button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => setProject(p => ({ ...p, people: [...p.people, { id: Math.random().toString(36), name: "", role: "" }] }))} className="flex items-center gap-3 text-sm font-black text-primary-600 uppercase bg-primary-50 dark:bg-primary-900/10 px-8 py-4 rounded-2xl border border-primary-100 transition-all"><UserPlus size={20}/> Adicionar Novo Interveniente</button>
                        </div>
                    </div>
                )}
            </div>
        </main>
        {activeEvidenceId && (
            <EvidenceViewer 
                file={evidenceFiles.find(f => f.id === activeEvidenceId) || null}
                processedData={project.processedData.find(pd => pd.fileId === activeEvidenceId)}
                initialSeekSeconds={seekSeconds}
                onClose={() => { setActiveEvidenceId(null); setSeekSeconds(null); }}
                onRenameSpeaker={handleRenameSpeaker}
            />
        )}
        {isSettingsOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] w-full max-w-lg border border-gray-200 dark:border-slate-800 shadow-2xl animate-in zoom-in-95">
                    <div className="flex justify-between items-center mb-10">
                        <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Definições</h3>
                        <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-100 rounded-full"><X size={24}/></button>
                    </div>
                    <div className="space-y-6 text-left">
                        <p className="text-[11px] font-black uppercase text-gray-400 tracking-[0.2em] mb-3 ml-1">Chave Gemini API</p>
                        <input type="password" className="w-full bg-gray-50 dark:bg-slate-950 border-2 border-gray-100 dark:border-slate-800 p-5 rounded-2xl text-gray-900 dark:text-white font-mono text-base outline-none focus:border-primary-500 shadow-inner" placeholder="AI Studio Secret Key..." value={userApiKey} onChange={e => setUserApiKey(e.target.value)} />
                    </div>
                    <button onClick={() => setIsSettingsOpen(false)} className="w-full mt-10 py-5 bg-primary-600 text-white rounded-2xl font-black shadow-xl hover:bg-primary-500 transition-all uppercase tracking-[0.2em] text-sm">Guardar Configuração</button>
                </div>
            </div>
        )}
        {showQuotaModal && (
            <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                 <div className="bg-white dark:bg-slate-900 p-12 rounded-[3rem] max-w-md text-center shadow-2xl border border-gray-200 dark:border-slate-800">
                     <AlertTriangle size={48} className="mx-auto mb-8 text-amber-500 shadow-inner"/>
                     <h3 className="text-2xl font-black mb-4 dark:text-white uppercase tracking-tighter">Quota Excedida</h3>
                     <p className="text-base text-gray-500 dark:text-slate-400 mb-10 leading-relaxed font-medium">O limite de pedidos da Google Gemini Free foi atingido. Aguarde cerca de 60 segundos.</p>
                     <button onClick={() => setShowQuotaModal(false)} className="w-full py-5 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-black shadow-xl transition-all uppercase tracking-[0.2em] text-xs">Continuar em Instantes</button>
                 </div>
            </div>
        )}
    </div>
  );
};

export default App;
