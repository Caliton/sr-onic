import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { ACTIVITY_SYSTEM_PROMPT } from './ActivityPromptBuilder';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const MODULE = 'Duda';

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

      // Validate: warn if HTML body seems empty (no visual content)
      const hasVisualContent = /<svg[\s>]/i.test(html) || /<img[\s>]/i.test(html) || /<table[\s>]/i.test(html);
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const bodyTextLength = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim().length : 0;
      if (!hasVisualContent && bodyTextLength < 200) {
        logger.warn(MODULE, `HTML body appears mostly empty (${bodyTextLength} chars, no SVG/img/table). PDF may look blank.`);
      }

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
      ACTIVITY_SYSTEM_PROMPT
    );

    let html = response.text || '';

    logger.info(MODULE, `Raw LLM response length: ${html.length} chars`);

    // Extract HTML from response — the LLM may wrap it in markdown code blocks
    // or include thinking/explanation text before/after the HTML
    html = this.extractHtml(html);

    // Validate: the HTML must at least contain basic structure
    if (!html || !/<html[\s>]/i.test(html)) {
      logger.warn(MODULE, `No valid HTML structure found in LLM response. First 500 chars: ${(response.text || '').substring(0, 500)}`);
      return '';
    }

    // If HTML is truncated (missing closing tags), try to close it
    if (!/<\/html\s*>/i.test(html)) {
      logger.warn(MODULE, 'HTML appears truncated (missing </html>). Attempting to close tags.');
      // Close any open body and html tags
      if (!/<\/body\s*>/i.test(html)) {
        html += '\n</body>';
      }
      html += '\n</html>';
    }

    logger.info(MODULE, `Cleaned HTML length: ${html.length} chars`);

    return html.trim();
  }

  /**
   * Extracts valid HTML from LLM response that may contain markdown code blocks,
   * thinking blocks, or extra text around the actual HTML.
   */
  private extractHtml(raw: string): string {
    // Strategy 1: Extract from markdown code block (```html ... ```)
    const codeBlockMatch = raw.match(/```html?\s*\n?([\s\S]*?)```/i);
    if (codeBlockMatch) {
      logger.info(MODULE, 'Extracted HTML from markdown code block');
      return codeBlockMatch[1].trim();
    }

    // Strategy 2: Extract the HTML document directly (<!DOCTYPE or <html to </html>)
    const docMatch = raw.match(/(<!DOCTYPE[\s\S]*<\/html\s*>)/i);
    if (docMatch) {
      logger.info(MODULE, 'Extracted HTML document from raw response');
      return docMatch[1].trim();
    }

    // Strategy 3: Partial match — HTML starts but may be truncated
    const partialMatch = raw.match(/(<!DOCTYPE[\s\S]*)/i) || raw.match(/(<html[\s\S]*)/i);
    if (partialMatch) {
      logger.info(MODULE, 'Extracted partial/truncated HTML from response');
      return partialMatch[1].trim();
    }

    // Strategy 4: Strip leading/trailing code block markers (simple case)
    let cleaned = raw.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/i, '');
    return cleaned.trim();
  }

  private async renderPdf(html: string, outputPath: string): Promise<void> {
    // Ensure tmp directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Convert local image file paths to base64 data URIs
    // Puppeteer's sandboxed Chromium can't access local filesystem paths
    const processedHtml = this.inlineLocalImages(html);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();

      await page.setContent(processedHtml, {
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

  /**
   * Convert local image file paths (e.g. data/activities/images/xxx.png) to
   * base64 data URIs so Puppeteer's sandboxed Chromium can render them.
   */
  private inlineLocalImages(html: string): string {
    return html.replace(
      /(<img\s[^>]*src=["'])([^"']+\.(?:png|jpg|jpeg|gif|svg))(["'][^>]*>)/gi,
      (_match, prefix, src, suffix) => {
        // Skip already-inlined data URIs and external URLs
        if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
          return `${prefix}${src}${suffix}`;
        }

        // Resolve absolute path from project root
        const absPath = path.isAbsolute(src) ? src : path.resolve(src);

        try {
          if (fs.existsSync(absPath)) {
            const ext = path.extname(absPath).slice(1).toLowerCase();
            const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            const b64 = fs.readFileSync(absPath).toString('base64');
            logger.info(MODULE, `Inlined local image: ${src}`);
            return `${prefix}data:${mime};base64,${b64}${suffix}`;
          }
        } catch (err) {
          logger.warn(MODULE, `Failed to inline image ${src}: ${err}`);
        }

        return `${prefix}${src}${suffix}`;
      }
    );
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
