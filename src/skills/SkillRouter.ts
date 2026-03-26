import { SkillMetadata } from './SkillLoader';
import { ILlmProvider, ChatMessage } from '../llm/ILlmProvider';
import { ProviderFactory } from '../llm/ProviderFactory';
import { logger } from '../utils/logger';

const MODULE = 'SkillRouter';

// Trivial messages that should skip the LLM router entirely
const TRIVIAL_PATTERNS = /^(oi|olá|ola|hey|hi|hello|obrigado|obrigada|valeu|thanks|tchau|bye|ok|sim|não|nao|👍|👎|❤️|😂|🤔|😊)$/i;

interface RouterCache {
  skillName: string | null;
  timestamp: number;
}

const CACHE_TTL_MS = 300_000; // 5 minutes

export class SkillRouter {
  private providerFactory: ProviderFactory;
  private cache: Map<string, RouterCache> = new Map();

  constructor(providerFactory: ProviderFactory) {
    this.providerFactory = providerFactory;
  }

  public async route(
    userMessage: string,
    skills: SkillMetadata[],
    userId: string
  ): Promise<SkillMetadata | null> {
    if (skills.length === 0) return null;

    // Fast-path 1: Trivial messages → no skill
    if (TRIVIAL_PATTERNS.test(userMessage.trim())) {
      logger.debug(MODULE, `Fast-path: trivial message, skipping router`);
      return null;
    }

    // Fast-path 2: Explicit command triggers
    const triggerMatch = this.matchTrigger(userMessage, skills);
    if (triggerMatch) {
      logger.info(MODULE, `Fast-path: trigger matched → ${triggerMatch.name}`);
      return triggerMatch;
    }

    // Check session cache
    const cacheKey = `${userId}:${this.normalizeMessage(userMessage)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      if (cached.skillName === null) return null;
      const skill = skills.find((s) => s.name === cached.skillName);
      if (skill) {
        logger.info(MODULE, `Cache hit: ${cached.skillName}`);
        return skill;
      }
    }

    // LLM-based routing
    try {
      const skillName = await this.routeWithLlm(userMessage, skills);

      // Cache the result
      this.cache.set(cacheKey, { skillName, timestamp: Date.now() });

      if (skillName) {
        const skill = skills.find((s) => s.name === skillName);
        if (skill) {
          logger.info(MODULE, `LLM Router resolved → ${skillName}`);
          return skill;
        }
      }

      logger.info(MODULE, `LLM Router: no skill matched`);
      return null;
    } catch (err) {
      logger.warn(MODULE, `LLM Router failed: ${err}. Falling back to no skill.`);
      return null;
    }
  }

  private matchTrigger(message: string, skills: SkillMetadata[]): SkillMetadata | null {
    const lowerMsg = message.toLowerCase().trim();

    for (const skill of skills) {
      if (!skill.triggers) continue;

      for (const trigger of skill.triggers) {
        const lowerTrigger = trigger.toLowerCase();
        // Match command-style triggers (e.g., /prd)
        if (lowerTrigger.startsWith('/') && lowerMsg.startsWith(lowerTrigger)) {
          return skill;
        }
        // Match keyword triggers
        if (lowerMsg.includes(lowerTrigger)) {
          return skill;
        }
      }
    }

    return null;
  }

  private async routeWithLlm(userMessage: string, skills: SkillMetadata[]): Promise<string | null> {
    const skillDescriptions = skills
      .map((s) => `- name: "${s.name}" | description: "${s.description}"`)
      .join('\n');

    const routerPrompt = `Você é um roteador de skills. Analise a mensagem do usuário e decida qual skill (se alguma) deve ser ativada.

Skills disponíveis:
${skillDescriptions}

Responda APENAS com JSON no formato: {"skillName": "nome-da-skill"} ou {"skillName": null} se nenhuma skill se aplicar.
Não inclua explicações, apenas o JSON puro.`;

    const messages: ChatMessage[] = [
      { role: 'user', content: userMessage },
    ];

    const provider = this.providerFactory.getProvider() || this.providerFactory.getNextAvailable();
    if (!provider) throw new Error('No provider available for routing');

    const response = await provider.chat(messages, undefined, routerPrompt);

    if (!response.text) return null;

    try {
      // Extract JSON from response
      const jsonMatch = response.text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.skillName || null;
    } catch {
      logger.warn(MODULE, `Failed to parse router response: ${response.text}`);
      return null;
    }
  }

  private normalizeMessage(msg: string): string {
    return msg.toLowerCase().trim().substring(0, 50);
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
