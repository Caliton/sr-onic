import { SkillLoader, SkillMetadata } from './SkillLoader';
import { logger } from '../utils/logger';

export class SkillExecutor {
  private skillLoader: SkillLoader;

  constructor(skillLoader: SkillLoader) {
    this.skillLoader = skillLoader;
  }

  /**
   * Reads the full SKILL.md content for the matched skill 
   * and returns the content to be injected into the system prompt
   * during the Agent Loop execution for this single request.
   */
  public getSkillSystemPrompt(skill: SkillMetadata): string {
    try {
      const fullContent = this.skillLoader.loadSkillContent(skill.dirPath);
      logger.info('SkillExecutor', `Loaded skill content for '${skill.name}' (${fullContent.length} chars)`);

      return `

=== SKILL ATIVA: ${skill.name} ===
Use as instruções abaixo como guia especializado para responder a esta solicitação:

${fullContent}

=== FIM DA SKILL ===
`;
    } catch (err) {
      logger.error('SkillExecutor', `Failed to load skill content for '${skill.name}': ${err}`);
      return '';
    }
  }

  /**
   * Builds a summary of all available skills for inclusion in the system prompt.
   */
  public buildAvailableSkillsSummary(skills: SkillMetadata[]): string {
    if (skills.length === 0) return '';

    const list = skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');

    return `
Você tem acesso às seguintes habilidades especializadas (skills):
${list}

Quando uma skill estiver ativa, siga suas instruções detalhadas para gerar respostas de alta qualidade.
`;
  }
}
