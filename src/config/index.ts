import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  telegram: {
    botToken: string;
    allowedUserIds: number[];
  };
  llm: {
    geminiApiKey: string;
    deepseekApiKey: string;
    defaultProvider: string;
  };
  agent: {
    maxIterations: number;
    pipelineTimeoutMs: number;
  };
  memory: {
    maxContextTokens: number;
    windowSize: number;
    dbPath: string;
  };
  tts: {
    voice: string;
  };
  logging: {
    dir: string;
    maxSizeMb: number;
  };
  paths: {
    tmpDir: string;
    skillsDir: string;
    dataDir: string;
    activitiesDir: string;
  };
  heartbeat: {
    intervalMs: number;
    memoryThresholdMb: number;
  };
  scheduler: {
    enabled: boolean;
  };
  search: {
    tavilyApiKey: string;
  };
}

function parseAllowedUserIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
}

export const config: AppConfig = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: parseAllowedUserIds(process.env.TELEGRAM_ALLOWED_USER_IDS),
  },
  llm: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    defaultProvider: process.env.DEFAULT_PROVIDER || 'gemini',
  },
  agent: {
    maxIterations: parseInt(process.env.MAX_ITERATIONS || '5', 10),
    pipelineTimeoutMs: parseInt(process.env.PIPELINE_TIMEOUT_MS || '300000', 10),
  },
  memory: {
    maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '8000', 10),
    windowSize: parseInt(process.env.MEMORY_WINDOW_SIZE || '20', 10),
    dbPath: process.env.DB_PATH || path.join('.', 'data', 'sronic.db'),
  },
  tts: {
    voice: process.env.TTS_VOICE || 'pt-BR-ThalitaMultilingualNeural',
  },
  logging: {
    dir: process.env.LOG_DIR || path.join('.', 'data', 'logs'),
    maxSizeMb: parseInt(process.env.LOG_MAX_SIZE_MB || '50', 10),
  },
  paths: {
    tmpDir: path.join('.', 'tmp'),
    skillsDir: path.join('.', '.agents', 'skills'),
    dataDir: path.join('.', 'data'),
    activitiesDir: path.join('.', 'data', 'activities'),
  },
  heartbeat: {
    intervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '300000', 10), // 5 min
    memoryThresholdMb: parseInt(process.env.HEARTBEAT_MEMORY_THRESHOLD_MB || '1024', 10),
  },
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false', // enabled by default
  },
  search: {
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
  },
};
