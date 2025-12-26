
import { GoogleGenAI } from "@google/genai";
import { EvidenceFile, EvidenceType, Fact, FactAnalysis, FactStatus, AnalysisReport, ChatMessage, ProcessedContent, Citation, UsageMetadata } from "../types";

const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64String = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const cleanRepetitiveLoops = (text: string): string => {
    if (!text) return "";
    const loopRegex = /\b(\w+)(?:[\s,.]+\1\b){3,}/gi;
    let cleaned = text.replace(loopRegex, '$1');
    const phraseLoopRegex = /(.{5,50}?)(?:[\s,.]+\1){3,}/gi;
    cleaned = cleaned.replace(phraseLoopRegex, '$1');
    return cleaned;
};

export const sanitizeTranscript = (rawText: string): { timestamp: string; seconds: number; text: string }[] => {
    const segments: { timestamp: string; seconds: number; text: string }[] = [];
    let formattedText = rawText
        .replace(/([^\n])\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2')
        .replace(/([^\n])\s+(\d{1,2}:\d{2}:\d{2})/g, '$1\n$2')
        .replace(/([^\n])\s*(\[P[áa]g)/g, '$1\n$2')
        .replace(/(\n\s*){2,}/g, '\n'); 
    
    const lines = formattedText.split('\n');
    const timestampRegex = /(?:^|[\s\*\-\.\(\[])(?:(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|P[áa]g\.?\s*(\d+)|Page\s*(\d+))(?:\]|\)|:)?[\*\-\)]*\s+(.*)/i;
    
    for (const line of lines) {
        if (line.trim().length < 2) continue;
        const match = line.match(timestampRegex);
        if (match) {
            const hours = match[1] ? parseInt(match[1]) : 0;
            const minutes = match[2] ? parseInt(match[2]) : null;
            const secondsPart = match[3] ? parseInt(match[3]) : null;
            const pageNum = match[4] || match[5] ? parseInt(match[4] || match[5]) : null;
            let metricValue = 0;
            let displayTimestamp = "";
            if (minutes !== null && secondsPart !== null) {
                metricValue = (hours * 3600) + (minutes * 60) + secondsPart;
                displayTimestamp = hours > 0 
                    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`
                    : `${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
            } else if (pageNum !== null) {
                metricValue = pageNum; 
                displayTimestamp = `Pág ${pageNum}`;
            }
            let text = match[6] ? match[6].trim() : "";
            if (["subtitles by", "inaudível"].some(t => text.toLowerCase().includes(t))) continue;
            text = cleanRepetitiveLoops(text);
            if (text && text.length > 0) {
                segments.push({ timestamp: displayTimestamp, seconds: metricValue, text: text });
            }
        } else if (segments.length > 0 && line.trim().length > 0) {
            let cleanLine = cleanRepetitiveLoops(line.trim());
            if (!cleanLine.startsWith('[') && cleanLine.length > 1) {
                segments[segments.length - 1].text += " " + cleanLine;
            }
        }
    }
    return segments;
};

export const parseSecondsSafe = (timestamp: string): number => {
    if (!timestamp) return 0;
    if (timestamp.toLowerCase().includes('pág') || timestamp.toLowerCase().includes('page')) {
        const match = timestamp.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
    }
    const parts = timestamp.replace(/[\[\]]/g, '').split(':').map(p => parseInt(p));
    if (parts.length === 3) {
        return (isNaN(parts[0]) ? 0 : parts[0] * 3600) + (isNaN(parts[1]) ? 0 : parts[1] * 60) + (isNaN(parts[2]) ? 0 : parts[2]);
    } else if (parts.length === 2) {
        return (isNaN(parts[0]) ? 0 : parts[0] * 60) + (isNaN(parts[1]) ? 0 : parts[1]);
    }
    return 0;
};

const handleApiError = (error: any) => {
    const msg = error.message?.toLowerCase() || "";
    if (msg.includes('api_key_invalid') || msg.includes('invalid api key') || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
        throw new Error("AUTH_FAILED");
    }
    throw error;
};

export const processFile = async (evidenceFile: EvidenceFile, customApiKey?: string): Promise<ProcessedContent> => {
  if (evidenceFile.isVirtual || !evidenceFile.file) {
      throw new Error("Este ficheiro é virtual e não pode ser processado.");
  }
  const ai = new GoogleGenAI({ apiKey: customApiKey || process.env.API_KEY });
  const modelName = 'gemini-3-flash-preview'; 
  let systemInstruction = "";
  let userPrompt = "";

  if (evidenceFile.type === 'AUDIO') {
      systemInstruction = `És um Transcritor Forense Profissional. 1. Transcreve TODA a gravação. 2. Identifica o orador. 3. FORMATO: [MM:SS] Orador: Texto...`;
      userPrompt = "Faz a transcrição integral e diarizada deste áudio.";
  } else {
      systemInstruction = `És um Assistente Legal. Extrai texto e usa [Pág X].`;
      userPrompt = "Extrai o texto completo deste documento.";
  }

  try {
        const filePart = await fileToGenerativePart(evidenceFile.file);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: [filePart, { text: userPrompt }] },
          config: { systemInstruction, temperature: 0.1 }
        });

        const rawText = response.text || "";
        const segments = sanitizeTranscript(rawText);
        const usage: UsageMetadata = {
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata?.totalTokenCount || 0
        };

        return {
          fileId: evidenceFile.id,
          fileName: evidenceFile.name,
          fullText: segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n'),
          segments,
          processedAt: Date.now(),
          usage
        };
    } catch (error: any) {
        handleApiError(error);
        throw error;
    }
};

export const analyzeFactsFromEvidence = async (
  processedData: ProcessedContent[], 
  facts: Fact[],
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[],
  customApiKey?: string
): Promise<AnalysisReport> => {
  const ai = new GoogleGenAI({ apiKey: customApiKey || process.env.API_KEY });
  const modelName = 'gemini-3-flash-preview'; 

  const factsList = facts.map((f, i) => `${i + 1}. [ID: ${f.id}] ${f.text}`).join('\n');
  const evidenceContext = processedData.map(t => `<file name="${t.fileName}">${t.fullText}</file>`).join('\n');

  const systemInstruction = `És um Juiz Analista Forense. Analisa cada facto contra as evidências. 
  OBRIGATÓRIO: Para cada afirmação, cita a fonte no formato [NomeArquivo @ Tempo/Pág].
  ESTRUTURA DE RESPOSTA POR FACTO:
  [[FACT]] ID: {id}
  [[STATUS]] {Confirmado | Desmentido | Inconclusivo/Contraditório}
  [[SUMMARY]] {Justificação detalhada mencionando contradições se existirem}
  [[EVIDENCES]]
  - [Arquivo @ Tempo]: "Trecho da fala ou texto citado"
  [[END_FACT]]
  
  No fim, gera [[CONCLUSION]] {Geral} [[END_CONCLUSION]].`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: { parts: [{ text: `EVIDÊNCIAS DISPONÍVEIS:\n${evidenceContext}\n\nFACTOS A ANALISAR:\n${factsList}` }] },
      config: { systemInstruction, temperature: 0.1 }
    });

    const rawText = response.text || "";
    const results: FactAnalysis[] = [];
    let generalConclusion = "";
    
    const conclusionMatch = rawText.match(/\[\[CONCLUSION\]\]([\s\S]*?)\[\[END_CONCLUSION\]\]/);
    if (conclusionMatch) generalConclusion = conclusionMatch[1].trim();

    const factBlocks = rawText.split('[[FACT]]').slice(1);
    factBlocks.forEach(block => {
        const idMatch = block.match(/ID:\s*(.*?)(\n|\[)/);
        const statusMatch = block.match(/\[\[STATUS\]\]([\s\S]*?)\[\[END_STATUS\]\]/);
        const summaryMatch = block.match(/\[\[SUMMARY\]\]([\s\S]*?)\[\[END_SUMMARY\]\]/);
        const evidencesBlock = block.match(/\[\[EVIDENCES\]\]([\s\S]*?)\[\[END_FACT\]\]/);
        
        if (idMatch) {
            const citations: Citation[] = [];
            const citStr = evidencesBlock?.[1] || "";
            // Enhanced regex to match [File @ Time]: "Text"
            const citRegex = /\[\s*(.*?)\s*@\s*(.*?)\s*\](?:\s*:\s*["“](.*?)["”])?/g;
            let cMatch;
            while ((cMatch = citRegex.exec(citStr)) !== null) {
                const fName = cMatch[1].trim();
                const timestamp = cMatch[2].trim();
                const excerpt = cMatch[3] ? cMatch[3].trim() : "Referência encontrada no documento.";
                
                const source = fileMetadata.find(f => f.name.toLowerCase().includes(fName.toLowerCase()) || fName.toLowerCase().includes(f.name.toLowerCase()));
                if (source) {
                    citations.push({ 
                        fileId: source.id, 
                        fileName: source.name, 
                        timestamp, 
                        seconds: parseSecondsSafe(timestamp), 
                        text: excerpt 
                    });
                }
            }
            results.push({
                factId: idMatch[1].trim(),
                factText: facts.find(f => f.id === idMatch[1].trim())?.text || "",
                status: (statusMatch?.[1].trim() as FactStatus) || FactStatus.INCONCLUSIVE,
                summary: summaryMatch?.[1].trim() || "",
                citations
            });
        }
    });

    const usage: UsageMetadata = {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
    };

    return { id: Date.now().toString(), name: `Análise de Caso - ${new Date().toLocaleDateString()}`, generatedAt: new Date().toISOString(), generalConclusion, results, usage };
  } catch (error: any) {
    handleApiError(error);
    throw error;
  }
};

export const chatWithEvidence = async (
  processedData: ProcessedContent[],
  history: ChatMessage[],
  currentMessage: string,
  peopleMap: Record<string, string>,
  fileMetadata: EvidenceFile[],
  customApiKey?: string
): Promise<{ text: string; usage: UsageMetadata }> => {
   const ai = new GoogleGenAI({ apiKey: customApiKey || process.env.API_KEY });
   const modelName = 'gemini-3-flash-preview'; 
   try {
    const evidenceContext = processedData.map(t => `<doc name="${t.fileName}">${t.fullText}</doc>`).join('\n');
    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: [{ text: `CONTEXTO FORENSE:\n${evidenceContext}\n\nPERGUNTA DO UTILIZADOR: ${currentMessage}\n\nREGRAS: Cita obrigatoriamente a fonte em cada afirmação usando [NomeArquivo @ MM:SS] ou [NomeArquivo @ Pág X].` }] },
        config: { temperature: 0.2 }
    });
    const usage: UsageMetadata = {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
    };
    return { text: cleanRepetitiveLoops(response.text || ""), usage };
   } catch (error: any) { 
       handleApiError(error);
       throw error; 
   }
};
