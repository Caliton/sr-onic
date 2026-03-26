import { BaseTool } from '../BaseTool';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';

const MODULE = 'Guto';

export class CreateSkillTool extends BaseTool {
  public readonly name = 'create_skill';
  public readonly description =
    'Cria uma nova Skill (habilidade) para o SrOnic. A skill fica disponível imediatamente após criação (hot-reload). ' +
    'Use esta ferramenta quando o usuário pedir para criar, adicionar ou ensinar uma nova habilidade ao agente.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      skillName: {
        type: 'string',
        description:
          'Nome identificador da skill (slug, sem espaços, lowercase com hífens). Ex: "text-summarizer", "code-reviewer".',
      },
      description: {
        type: 'string',
        description:
          'Descrição curta do que a skill faz (1 linha). Será usada pelo SkillRouter para decidir quando ativar.',
      },
      triggers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Lista de comandos ou palavras-chave para ativação rápida (fast-path). Ex: ["/resumo", "resuma isso", "faz um resumo"].',
      },
      instructions: {
        type: 'string',
        description:
          'Instruções detalhadas em Markdown que o LLM deve seguir quando esta skill for ativada. ' +
          'Inclua: quando usar, como se comportar, regras, exemplos de uso, formato de resposta.',
      },
      cronSchedule: {
        type: 'string',
        description:
          'Opcional. Expressão cron para executar a skill automaticamente (ex: "0 9 * * 1-5" para seg-sex às 9h). Deixe vazio se não precisar.',
      },
      cronAction: {
        type: 'string',
        description:
          'Opcional. A mensagem/prompt enviada automaticamente quando o cron disparar.',
      },
    },
    required: ['skillName', 'description', 'instructions'],
  };

  public async execute(args: Record<string, unknown>): Promise<string> {
    const skillName = args.skillName as string;
    const description = args.description as string;
    const triggers = (args.triggers as string[]) || [];
    const instructions = args.instructions as string;
    const cronSchedule = args.cronSchedule as string | undefined;
    const cronAction = args.cronAction as string | undefined;

    // Validation
    if (!skillName || !skillName.match(/^[a-z0-9-]+$/)) {
      return JSON.stringify({
        error: 'Nome da skill inválido. Use apenas letras minúsculas, números e hífens (ex: "text-summarizer").',
      });
    }

    if (!instructions || instructions.trim().length < 20) {
      return JSON.stringify({
        error: 'Instruções muito curtas. Forneça instruções detalhadas de como a skill deve funcionar.',
      });
    }

    const skillDir = path.join(config.paths.skillsDir, skillName);
    const skillFile = path.join(skillDir, 'SKILL.md');

    // Check if skill already exists
    if (fs.existsSync(skillFile)) {
      return JSON.stringify({
        error: `Skill "${skillName}" já existe. Use outro nome ou edite manualmente o arquivo ${skillFile}.`,
      });
    }

    try {
      // Build frontmatter
      const frontmatter: string[] = [
        '---',
        `name: ${skillName}`,
        `description: ${description}`,
      ];

      if (triggers.length > 0) {
        frontmatter.push('triggers:');
        for (const trigger of triggers) {
          frontmatter.push(`  - ${trigger}`);
        }
      }

      if (cronSchedule && cronAction) {
        frontmatter.push('cron:');
        frontmatter.push(`  - schedule: "${cronSchedule}"`);
        frontmatter.push(`    action: "${cronAction}"`);
        frontmatter.push(`    description: "${description}"`);
      }

      frontmatter.push('---');
      frontmatter.push('');

      const content = frontmatter.join('\n') + instructions;

      // Create directory and write file
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFile, content, 'utf-8');

      logger.info(MODULE, `Skill created: ${skillName} at ${skillFile}`);

      return JSON.stringify({
        success: true,
        message: `✅ Skill "${skillName}" criada com sucesso! Ela já está disponível para uso imediato.`,
        path: skillFile,
        triggers: triggers.length > 0 ? triggers : 'Nenhum trigger definido (ativação via LLM Router)',
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Failed to create skill: ${errorMsg}`);

      // Cleanup on error
      try {
        if (fs.existsSync(skillDir)) fs.rmdirSync(skillDir, { recursive: true });
      } catch { /* ignore */ }

      return JSON.stringify({
        error: `Falha ao criar skill: ${errorMsg}`,
      });
    }
  }
}
