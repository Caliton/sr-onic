import { BaseTool } from '../BaseTool';
import { ToolDefinition } from '../../llm/ILlmProvider';
import { ImageGenerationService } from '../../services/ImageGenerationService';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';

const MODULE = 'Leo';

/**
 * "Leo" — The Illustrator.
 * Prof. Lina calls this tool to request a line-art illustration from DALL-E 3.
 * Returns the image path so Lina can embed it in the activity content.
 */
export class RequestIllustrationTool extends BaseTool {
  public readonly name = 'request_illustration';
  public readonly description =
    'Solicita ao Leo (ilustrador) a criação de um desenho em preto e branco (line art) para atividades infantis. ' +
    'Retorna o caminho da imagem gerada. Use ANTES de chamar save_activity para atividades visuais (colorir, labirinto, ligar-pontos).';

  public readonly parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Descrição detalhada do desenho. Ex: "Uma criança indígena sorrindo ao lado de uma oca, com um cocar de penas na cabeça, segurando um arco. Ao fundo, árvores e um rio."',
      },
      style: {
        type: 'string',
        description:
          'Estilo do desenho. Padrão: "coloring_book". Opções: "coloring_book" (contornos grossos para colorir), "maze" (labirinto), "connect_dots" (ligar pontos).',
      },
      fileName: {
        type: 'string',
        description:
          'Nome do arquivo de saída (sem extensão). Ex: "crianca-indigena-oca". Será salvo como PNG.',
      },
    },
    required: ['prompt', 'fileName'],
  };

  public async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = args.prompt as string;
    const style = (args.style as string) || 'coloring_book';
    const fileName = args.fileName as string;

    if (!prompt || !fileName) {
      return JSON.stringify({
        success: false,
        message: '❌ Leo: "Preciso de um prompt descrevendo o desenho e um fileName para salvar!"',
      });
    }

    const imageService = new ImageGenerationService();
    if (!imageService.isAvailable()) {
      return JSON.stringify({
        success: false,
        message:
          '❌ Leo: "Estou indisponível no momento. A chave da OpenAI (DALL-E) não foi configurada. ' +
          'A Prof. Lina pode continuar sem imagem — basta não incluir tag <img> no conteúdo."',
      });
    }

    logger.info(MODULE, `Illustration requested: "${prompt.substring(0, 80)}..." (style: ${style})`);

    const b64 = await imageService.generateColoringPage(prompt, style);

    if (!b64) {
      return JSON.stringify({
        success: false,
        message:
          '❌ Leo: "Não consegui gerar o desenho. Pode ter sido bloqueado por filtros de segurança. ' +
          'Tente reformular a descrição do desenho."',
      });
    }

    // Save to /data/activities/images/
    const imagesDir = path.join('data', 'activities', 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const sanitizedName = fileName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_');
    const fullPath = path.join(imagesDir, `${sanitizedName}.png`);

    fs.writeFileSync(fullPath, Buffer.from(b64, 'base64'));
    logger.info(MODULE, `Illustration saved: ${fullPath}`);

    return JSON.stringify({
      success: true,
      message: `🎨 Leo: "Pronto, Prof. Lina! Desenhei o que você pediu. Use a tag abaixo no conteúdo da atividade."`,
      imagePath: fullPath,
      imageTag: `<img src="${fullPath}" alt="${sanitizedName}" style="max-width:90%;display:block;margin:20px auto">`,
    });
  }
}
