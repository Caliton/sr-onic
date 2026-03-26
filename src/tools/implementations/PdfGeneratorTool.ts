import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const MODULE = 'Duda';

const HTML_SYSTEM_PROMPT = `Você é a **Duda**, a designer da equipe do SrOnic. Você é apaixonada por tipografia, layout e documentos bonitos.

Sua especialidade é transformar conteúdo textual em HTML profissional para conversão em PDF. Você é perfeccionista — nenhum documento sai feio da sua mão.

REGRAS OBRIGATÓRIAS:
1. Retorne APENAS o HTML completo (<!DOCTYPE html>...</html>). Sem explicações, sem markdown, sem blocos de código.
2. Use CSS inline no <style> dentro do <head>. Nunca use links externos.
3. Use a diretiva @page para definir margens do PDF: @page { margin: 2cm 2.5cm; }
4. Use fontes seguras: 'Segoe UI', Arial, Helvetica, sans-serif.
5. O body deve ter font-size: 12pt, line-height: 1.6, color: #2c3e50.
6. Use page-break-before/after para controlar paginação em seções longas.
7. Cabeçalhos (h1, h2, h3) devem ter cores profissionais (#1a365d ou #2c5282).
8. Tabelas devem ter border-collapse: collapse, bordas sutis (#e2e8f0), padding adequado.
9. Listas devem ter espaçamento confortável (margin-bottom nos li).
10. O documento deve parecer PROFISSIONAL e IMPRESSO — como um relatório corporativo de alta qualidade.

ESTILOS DISPONÍVEIS:
- "formal": Cores sóbrias (#1a365d), serif para títulos, layout corporativo rigoroso.
- "moderno": Gradientes sutis, cards com box-shadow, fonte sans-serif, visual tech.
- "minimalista": Muito espaço em branco, tipografia limpa, cores restritas a preto/cinza.
- Se nenhum estilo for especificado, use "moderno" como padrão.`;

export class PdfGeneratorTool extends BaseTool {
  public readonly name = 'generate_pdf';
  public readonly description =
    'Gera um documento PDF profissional a partir de conteúdo textual. O conteúdo é convertido em HTML estilizado e renderizado em PDF formato A4. Use esta ferramenta quando o usuário pedir para criar, gerar ou exportar um PDF, relatório, documento ou contrato.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description:
          'O conteúdo completo que deve ser transformado em PDF. Pode ser texto puro, markdown ou instruções detalhadas do que o documento deve conter.',
      },
      fileName: {
        type: 'string',
        description:
          'Nome do arquivo PDF de saída (ex: "relatorio.pdf"). Deve terminar com .pdf.',
      },
      style: {
        type: 'string',
        enum: ['formal', 'moderno', 'minimalista'],
        description:
          'Estilo visual do documento. Opções: "formal" (corporativo), "moderno" (tech/visual), "minimalista" (limpo). Padrão: "moderno".',
      },
    },
    required: ['content', 'fileName'],
  };

  private providerFactory: ProviderFactory;
  private generating = false;
  private waitQueue: (() => void)[] = [];

  constructor(providerFactory: ProviderFactory) {
    super();
    this.providerFactory = providerFactory;
  }

  public async execute(args: Record<string, unknown>): Promise<string> {
    // Semaphore: only 1 PDF at a time to avoid Chromium RAM explosion
    await this.acquireLock();

    try {
      return await this.doGenerate(args);
    } finally {
      this.releaseLock();
    }
  }

  private acquireLock(): Promise<void> {
    if (!this.generating) {
      this.generating = true;
      return Promise.resolve();
    }
    logger.info(MODULE, 'PDF generation in progress, queueing request...');
    return new Promise<void>((resolve) => this.waitQueue.push(resolve));
  }

  private releaseLock(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next(); // Wake up next in queue (keeps lock)
    } else {
      this.generating = false;
    }
  }

  private async doGenerate(args: Record<string, unknown>): Promise<string> {
    const content = args.content as string;
    const rawFileName = args.fileName as string;
    const style = (args.style as string) || 'moderno';

    // Ensure .pdf extension
    const fileName = rawFileName.endsWith('.pdf') ? rawFileName : `${rawFileName}.pdf`;
    const filePath = path.join(config.paths.tmpDir, fileName);

    logger.info(MODULE, `Generating PDF: ${fileName} (style: ${style})`);

    try {
      // Step 1: Generate HTML via LLM (sub-agent call)
      const html = await this.generateHtml(content, style);

      if (!html || html.trim().length === 0) {
        return JSON.stringify({ error: 'Falha ao gerar o HTML do documento. O LLM retornou vazio.' });
      }

      logger.info(MODULE, `HTML generated: ${html.length} characters`);

      // Step 2: Render HTML to PDF via Puppeteer
      await this.renderPdf(html, filePath);

      logger.info(MODULE, `PDF saved: ${filePath}`);

      // Step 3: Persist a copy to the archive (survives tmp cleanup)
      this.archivePdf(filePath, fileName);

      // Return file marker for the Agent Loop to pick up
      return `<<<ARQUIVO:${fileName}>>>🎨 Duda aqui! Documento "${fileName}" ficou lindo, no estilo ${style}. Tá pronto!<<<\/ARQUIVO>>>`;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `PDF generation failed: ${errorMsg}`);

      // Cleanup on error
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch { /* ignore */ }

      return JSON.stringify({
        error: `Falha ao gerar PDF: ${errorMsg}`,
      });
    }
  }

  private async generateHtml(content: string, style: string): Promise<string> {
    const provider = this.providerFactory.getProvider(config.llm.defaultProvider);
    if (!provider) {
      throw new Error('Nenhum provedor LLM disponível para gerar o HTML.');
    }

    const userPrompt = `Estilo solicitado: "${style}"

Conteúdo para transformar em documento HTML/PDF:

${content}`;

    const response = await provider.chat(
      [{ role: 'user', content: userPrompt }],
      [], // no tools needed
      HTML_SYSTEM_PROMPT
    );

    let html = response.text || '';

    // Clean up if LLM wrapped in code blocks
    html = html.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/i, '');

    return html.trim();
  }

  private async renderPdf(html: string, outputPath: string): Promise<void> {
    // Ensure tmp directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '2cm',
          bottom: '2cm',
          left: '2.5cm',
          right: '2.5cm',
        },
      });
    } finally {
      await browser.close();
    }
  }

  private archivePdf(srcPath: string, fileName: string): void {
    try {
      const archiveDir = path.join(config.paths.activitiesDir, 'pdfs');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }
      const destPath = path.join(archiveDir, fileName);
      fs.copyFileSync(srcPath, destPath);
      logger.info(MODULE, `PDF archived: ${destPath}`);
    } catch (err) {
      // Non-critical: don't fail the PDF generation if archiving fails
      logger.warn(MODULE, `Failed to archive PDF: ${err}`);
    }
  }
}
