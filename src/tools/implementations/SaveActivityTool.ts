import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { ActivityPromptBuilder } from './ActivityPromptBuilder';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';

const MODULE = 'ProfLina';

export class SaveActivityTool extends BaseTool {
  public readonly name = 'save_activity';
  public readonly description =
    'Salva uma atividade pedagógica planejada como arquivo .md. ' +
    'Use com generatePdf=true para salvar e gerar o PDF final automaticamente, ' +
    'ou generatePdf=false para apenas salvar o rascunho.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      grade: {
        type: 'string',
        description:
          'Ano/série escolar. Ex: "1-ano", "2-ano", "3-ano", "4-ano", "5-ano".',
      },
      theme: {
        type: 'string',
        description:
          'Tema da atividade. Ex: "folclore", "minha-casa", "animais", "corpo-humano".',
      },
      type: {
        type: 'string',
        description:
          'Tipo de atividade. Ex: "cruzadinha", "caca-palavras", "colorir", "labirinto", "ligar-pontos", "completar-lacunas".',
      },
      title: {
        type: 'string',
        description:
          'Título completo da atividade. Ex: "Cruzadinha do Folclore Brasileiro".',
      },
      content: {
        type: 'string',
        description:
          'Conteúdo COMPLETO e DETALHADO da atividade em Markdown. Deve incluir: ' +
          'objetivos pedagógicos, instruções de layout (posição dos elementos, grid, espaços), ' +
          'conteúdo da atividade (palavras, dicas, itens), e sugestão de estilo visual. ' +
          'Quanto mais detalhado, melhor será o PDF gerado.',
      },
      generatePdf: {
        type: 'boolean',
        description:
          'Se true, gera o PDF imediatamente junto com o salvamento. ' +
          'Se false (padrão), apenas salva o .md como rascunho.',
      },
    },
    required: ['grade', 'theme', 'type', 'title', 'content'],
  };

  private providerFactory: ProviderFactory;

  constructor(providerFactory: ProviderFactory) {
    super();
    this.providerFactory = providerFactory;
  }

  public async execute(args: Record<string, unknown>): Promise<string> {
    const grade = args.grade as string;
    const theme = args.theme as string;
    const type = args.type as string;
    const title = args.title as string;
    const content = args.content as string;
    const generatePdf = (args.generatePdf as boolean) || false;

    const activitiesDir = config.paths.activitiesDir;

    // Ensure directory exists
    if (!fs.existsSync(activitiesDir)) {
      fs.mkdirSync(activitiesDir, { recursive: true });
    }

    // Build filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const slug = `${grade}_${type}_${theme}`.replace(/\s+/g, '-').toLowerCase();
    const fileName = `${timestamp}_${slug}.md`;
    const filePath = path.join(activitiesDir, fileName);

    // Build .md content with frontmatter
    const mdContent = `---
grade: ${grade}
theme: ${theme}
type: ${type}
title: "${title}"
created_at: ${new Date().toISOString()}
status: ${generatePdf ? 'approved' : 'pending_review'}
---

# ${title}
## ${grade.replace('-', 'º ')} do Ensino Fundamental

${content}
`;

    try {
      // Save the .md spec
      fs.writeFileSync(filePath, mdContent, 'utf-8');
      logger.info(MODULE, `Activity saved: ${filePath}`);

      if (generatePdf) {
        // Generate PDF (only after critic approval)
        logger.info(MODULE, `Triggering PDF generation for approved activity: ${title}`);
        const pdfResult = await this.generatePdfFromActivity(mdContent, slug, grade, type, theme);
        this.markAsDone(filePath);

        return JSON.stringify({
          success: true,
          message: `✅ Prof. Lina: "Atividade '${title}' aprovada e o PDF ficou lindo! Meus alunos iam amar."`,
          specFile: filePath,
          pdfGenerated: true,
          pdfResult,
        });
      } else {
        // Save only — draft mode
        return JSON.stringify({
          success: true,
          message: `📝 Prof. Lina: "Planejei a atividade '${title}' com carinho! Quando quiser, é só pedir que eu mando pra Duda fazer o PDF."`,
          specFile: filePath,
          pdfGenerated: false,
          activityContent: content,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Failed to save activity: ${errorMsg}`);

      return JSON.stringify({
        error: `Falha ao criar atividade: ${errorMsg}`,
        specSaved: fs.existsSync(filePath),
      });
    }
  }

  public async generatePdfFromActivity(
    mdContent: string,
    slug: string,
    grade: string,
    type: string,
    _theme: string
  ): Promise<string> {
    const PdfGeneratorTool = (await import('./PdfGeneratorTool')).PdfGeneratorTool;
    const pdfTool = new PdfGeneratorTool(this.providerFactory);

    const pdfFileName = `atividade_${slug}.pdf`;

    // Strip teacher-only sections (Objetivos, BNCC, Estilo Visual)
    const studentContent = this.stripTeacherSections(mdContent);

    // Check if Lina already embedded an image (from Leo / request_illustration)
    const hasImage = /<img\s/i.test(studentContent);

    const builder = new ActivityPromptBuilder();
    const enrichedContent = builder.build({
      grade,
      type,
      theme: _theme,
      studentContent,
      hasImage,
    });

    const result = await pdfTool.execute({
      content: enrichedContent,
      fileName: pdfFileName,
      style: 'moderno',
    });

    return result;
  }

  /**
   * Removes teacher-only sections from the activity markdown.
   * Keeps: Instruções para o Aluno, Conteúdo da Atividade
   * Strips: Objetivos Pedagógicos, Habilidades BNCC, Estilo Visual, frontmatter
   */
  private stripTeacherSections(mdContent: string): string {
    // Remove YAML frontmatter
    let content = mdContent.replace(/^---[\s\S]*?---\s*/m, '');

    // Remove top-level title duplicates (# Título, ## Série)
    content = content.replace(/^#{1,2}\s+.+$/gm, '');

    // Sections to strip entirely (heading + content until next heading)
    const teacherSections = [
      'Objetivos Pedagógicos',
      'Habilidades BNCC',
      'Estilo Visual',
    ];

    for (const section of teacherSections) {
      // Match ### Section Header + everything until the next ### or end
      const regex = new RegExp(
        `###\\s*${section}[\\s\\S]*?(?=###\\s|$)`,
        'gi'
      );
      content = content.replace(regex, '');
    }

    return content.trim();
  }



  private markAsDone(filePath: string): void {
    try {
      let content = fs.readFileSync(filePath, 'utf-8');
      content = content.replace('status: pending', 'status: done');
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch {
      // Non-critical, ignore
    }
  }
}
