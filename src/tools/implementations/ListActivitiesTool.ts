import { BaseTool } from '../BaseTool';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MODULE = 'ListActivities';

export class ListActivitiesTool extends BaseTool {
  public readonly name = 'list_activities';
  public readonly description =
    'Lista todas as atividades pedagógicas salvas pela Prof. Lina. ' +
    'Retorna título, série, tema, tipo, status e caminho de cada atividade. ' +
    'O usuário pode então solicitar regeneração do PDF de qualquer atividade listada.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      grade: {
        type: 'string',
        description:
          'Filtro opcional por série. Ex: "1-ano". Se omitido, lista todas.',
      },
      status: {
        type: 'string',
        description:
          'Filtro opcional por status. Valores: "done", "pending_review", "approved". Se omitido, lista todas.',
      },
    },
    required: [] as string[],
  };

  public async execute(args: Record<string, unknown>): Promise<string> {
    const gradeFilter = (args.grade as string) || null;
    const statusFilter = (args.status as string) || null;

    const activitiesDir = config.paths.activitiesDir;

    if (!fs.existsSync(activitiesDir)) {
      return JSON.stringify({
        activities: [],
        total: 0,
        message: 'Nenhuma atividade encontrada. A pasta de atividades está vazia.',
      });
    }

    const files = fs.readdirSync(activitiesDir).filter((f) => f.endsWith('.md'));

    if (files.length === 0) {
      return JSON.stringify({
        activities: [],
        total: 0,
        message: 'Nenhuma atividade salva ainda.',
      });
    }

    const activities: Array<{
      fileName: string;
      title: string;
      grade: string;
      theme: string;
      type: string;
      status: string;
      createdAt: string;
      filePath: string;
    }> = [];

    for (const file of files) {
      const filePath = path.join(activitiesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const metadata = this.parseFrontmatter(content);
        if (!metadata) continue;

        // Apply filters
        if (gradeFilter && metadata.grade !== gradeFilter) continue;
        if (statusFilter && metadata.status !== statusFilter) continue;

        activities.push({
          fileName: file,
          title: metadata.title || file,
          grade: metadata.grade || 'N/A',
          theme: metadata.theme || 'N/A',
          type: metadata.type || 'N/A',
          status: metadata.status || 'unknown',
          createdAt: metadata.created_at || 'N/A',
          filePath,
        });
      } catch (err) {
        logger.warn(MODULE, `Failed to read activity ${file}: ${err}`);
      }
    }

    // Sort by creation date (newest first)
    activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return JSON.stringify({
      activities,
      total: activities.length,
      message: activities.length > 0
        ? `Encontrei ${activities.length} atividade(s). Para regenerar o PDF de alguma, peça: "Gera o PDF da atividade [título]".`
        : 'Nenhuma atividade encontrada com os filtros aplicados.',
    });
  }

  private parseFrontmatter(content: string): Record<string, any> | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    try {
      return yaml.load(match[1]) as Record<string, any>;
    } catch {
      return null;
    }
  }
}
