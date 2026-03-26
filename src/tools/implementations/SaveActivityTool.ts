import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';

const MODULE = 'ProfLina';

export class SaveActivityTool extends BaseTool {
  public readonly name = 'save_activity';
  public readonly description =
    'Salva uma atividade pedagógica planejada como arquivo .md. ' +
    'Use com generatePdf=false para salvar e depois avaliar com evaluate_activity. ' +
    'Após aprovação do Agente Crítico, chame novamente com generatePdf=true para gerar o PDF final.';

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
          'Se true, gera o PDF imediatamente (usar SOMENTE após aprovação do Agente Crítico). ' +
          'Se false (padrão), apenas salva o .md para avaliação.',
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
        const pdfResult = await this.generatePdfFromActivity(mdContent, slug, grade, type);
        this.markAsDone(filePath);

        return JSON.stringify({
          success: true,
          message: `✅ Prof. Lina: "Atividade '${title}' aprovada e o PDF ficou lindo! Meus alunos iam amar."`,
          specFile: filePath,
          pdfGenerated: true,
          pdfResult,
        });
      } else {
        // Save only — awaiting critic evaluation
        return JSON.stringify({
          success: true,
          message: `📝 Prof. Lina: "Planejei a atividade '${title}' com carinho! Agora o Seu Raimundo precisa avaliar antes da gente mandar pra Duda fazer o PDF."`,
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

  private async generatePdfFromActivity(
    mdContent: string,
    slug: string,
    grade: string,
    type: string
  ): Promise<string> {
    // Get PdfGeneratorTool from registry pattern — we call it directly
    // by using the ProviderFactory to generate HTML and then Puppeteer to render
    const PdfGeneratorTool = (await import('./PdfGeneratorTool')).PdfGeneratorTool;
    const pdfTool = new PdfGeneratorTool(this.providerFactory);

    const pdfFileName = `atividade_${slug}.pdf`;

    // Enrich the content prompt for activity-specific HTML generation
    const enrichedContent = `ATIVIDADE PEDAGÓGICA PARA IMPRESSÃO — ${grade.replace('-', 'º ')}

IMPORTANTE: Este é um material EDUCACIONAL INFANTIL para impressão. O layout deve ser:
- Lúdico e colorido (mas imprimível em preto e branco também)
- Fonte grande e legível para crianças (mínimo 14pt no corpo)
- Instruções claras e simples
- Espaço para nome e data do aluno no topo
- Tipo de atividade: ${type}
- Se for CRUZADINHA: criar grid com bordas visíveis, dicas numeradas
- Se for CAÇA-PALAVRAS: grid de letras com palavras escondidas, lista de palavras para encontrar
- Se for COLORIR: criar desenhos com contornos simples usando SVG ou bordas CSS
- Se for LABIRINTO: criar caminhos com bordas CSS
- Se for COMPLETAR LACUNAS: texto com espaços sublinhados _______

${mdContent}`;

    const result = await pdfTool.execute({
      content: enrichedContent,
      fileName: pdfFileName,
      style: 'moderno',
    });

    return result;
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
