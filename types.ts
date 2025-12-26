
export type EvidenceType = 'AUDIO' | 'PDF' | 'IMAGE' | 'TEXT' | 'OTHER';
export type EvidenceCategory = 'TESTIMONY' | 'INQUIRY' | 'OTHER';

export interface Person {
  id: string;
  name: string;
  role?: string;
}

export interface UsageMetadata {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface EvidenceFile {
  id: string;
  file: File | null;
  name: string;
  folder?: string;
  type: EvidenceType;
  category: EvidenceCategory;
  personId?: string;
  size?: number;
  isVirtual?: boolean;
}

export interface Fact {
  id: string;
  text: string;
}

export enum FactStatus {
  CONFIRMED = 'Confirmado',
  DENIED = 'Desmentido',
  INCONCLUSIVE = 'Inconclusivo/Contraditório',
  NOT_MENTIONED = 'Não Mencionado',
}

export interface Citation {
  fileId: string;
  fileName: string;
  timestamp: string;
  seconds: number;
  text: string;
}

export interface FactAnalysis {
  factId: string;
  factText: string;
  status: FactStatus;
  summary: string;
  citations: Citation[];
}

export interface AnalysisReport {
  id: string; 
  name: string;
  generatedAt: string;
  results: FactAnalysis[];
  generalConclusion: string;
  usage?: UsageMetadata;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  usage?: UsageMetadata;
}

export interface ProcessedContent {
  fileId: string;
  fileName: string;
  fullText: string;
  segments: {
    timestamp: string;
    seconds: number;
    text: string;
  }[];
  processedAt: number;
  usage?: UsageMetadata;
}

export interface ProjectState {
  people: Person[];
  facts: Fact[];
  processedData: ProcessedContent[]; 
  savedReports: AnalysisReport[];
  chatHistory: ChatMessage[];
  lastModified: number;
}

export interface SerializedProject {
  type: 'project_v2';
  people: Person[];
  facts: Fact[];
  savedReports: AnalysisReport[];
  chatHistory: ChatMessage[];
  createdAt: number;
}

export interface SerializedDatabase {
  type: 'database_v2';
  processedData: ProcessedContent[];
  fileManifest: { id: string; name: string; type: EvidenceType; category: EvidenceCategory; folder?: string }[];
  exportedAt: number;
}
