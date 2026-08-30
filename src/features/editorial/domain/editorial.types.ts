export type EditorialScoreDimensionId = 'hook' | 'clarity' | 'pacing' | 'brand-fit';

export type EditorialScoreConfidence = 'heuristic' | 'local-ai' | 'hybrid';

export type EditorialScoreDimension = {
  id: EditorialScoreDimensionId;
  label: string;
  score: number;
  weight: number;
  evidence: string;
};

export type EditorialScore = {
  version: 1;
  model: string;
  provider?: 'heuristic' | 'ollama';
  modelVersion?: string;
  promptVersion?: string;
  confidence: EditorialScoreConfidence;
  total: number;
  dimensions: EditorialScoreDimension[];
  reasons: string[];
  inputs: {
    durationSeconds: number;
    transcriptAvailable: boolean;
    transcriptWordCount: number;
    transcriptChars?: number;
  };
  evaluationSetId: string;
  evaluatedAt: string;
  fallback?: boolean;
  fallbackReason?: string;
};

export type EditorialMetadata = {
  version: 1;
  title: string;
  description: string;
  titleSource: 'suggested' | 'manual';
  descriptionSource: 'suggested' | 'manual';
  score?: EditorialScore;
  source?: 'heuristic' | 'local-ai' | 'hybrid';
  fallbackReason?: string;
  status: 'draft' | 'reviewed';
  updatedAt?: string;
};

export type EditorialDictionaryEntry = {
  id: string;
  term: string;
  replacement?: string;
  kind: 'preferred' | 'forbidden';
  notes?: string;
};

export type EditorialEvaluationCase = {
  id: string;
  label: string;
  expectedScore: {
    min: number;
    max: number;
  };
};

export type EditorialEvaluationSet = {
  id: string;
  version: string;
  name: string;
  cases: EditorialEvaluationCase[];
};

export type EditorialAiConfig = {
  enabled: boolean;
  provider: 'ollama';
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTranscriptChars: number;
  temperature: number;
};

export type EditorialProviderStatus = {
  provider: 'ollama';
  enabled: boolean;
  available: boolean;
  modelAvailable: boolean;
  ready: boolean;
  model: string;
  baseUrl: string;
  reason: string;
};

export type EditorialConfig = {
  version: 1;
  ai: EditorialAiConfig;
  brand: {
    name: string;
    tone: string;
    entries: EditorialDictionaryEntry[];
  };
  evaluation: {
    activeSetId: string;
    sets: EditorialEvaluationSet[];
  };
};
