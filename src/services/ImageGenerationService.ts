import { OpenAI } from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

const MODULE = 'ImageGen';

export class ImageGenerationService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.openai.apiKey) {
      this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    } else {
      logger.warn(MODULE, 'OPENAI_API_KEY no configurado. Geração de imagens desabilitada.');
    }
  }

  public isAvailable(): boolean {
    return this.openai !== null;
  }

  /**
   * Generates a black-and-white, line-art coloring page image using DALL-E 3.
   * Returns a base64 encoded string of the image.
   */
  public async generateColoringPage(theme: string, type: string): Promise<string | null> {
    if (!this.openai) {
      logger.error(MODULE, 'Cannot generate image: OpenAI not configured.');
      return null;
    }

    const start = Date.now();
    try {
      logger.info(MODULE, `Requesting DALL-E 3 image for theme: ${theme}`);
      
      const prompt = `A highly detailed, clean black and white line art coloring book page for children. Subject: ${theme}. Activity type: ${type}. Pure white background, strictly thick black outlines. No gray, no shading, no colors, no text, no background noise. Perfect for a kid to color with crayons.`;

      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json', // Return base64 so we don't have to download
        style: 'natural',
      });

      if (!response.data || response.data.length === 0 || !response.data[0].b64_json) {
        throw new Error('DALL-E 3 did not return b64_json data.');
      }
      const b64Json = response.data[0].b64_json;

      logger.info(MODULE, `Image generated successfully in ${Date.now() - start}ms`);
      return b64Json;
    } catch (err: any) {
      logger.error(MODULE, `DALL-E 3 image generation failed: ${err.message}`);
      return null;
    }
  }
}
