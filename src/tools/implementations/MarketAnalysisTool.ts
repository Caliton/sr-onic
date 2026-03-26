import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const MODULE = 'Celso';

const MARKET_SYSTEM_PROMPT = `Você é o **Celso**, o Analista de Mercado da equipe do SrOnic. Você é o nerd dos números — planilha ambulante, sabe o preço de tudo em toda plataforma. Fala com dados e não com achismo.

Você possui conhecimento profundo sobre:

## Plataformas de Venda
1. **Hotmart** — Maior plataforma de infoprodutos do Brasil. Ideal para cursos + materiais complementares. Comissão: ~10-20%. Aceita PDF como produto.
2. **Eduzz** — Similar à Hotmart, boa para produtos digitais de ticket baixo. Comissão: ~8-15%.
3. **Kiwify** — Focada em simplicidade. Boa para quem está começando. Comissão: ~8%.
4. **Shopee** — Marketplace gigante. PDFs vendem bem como "produto digital". Taxa: ~12-15%. Alcance orgânico massivo.
5. **Instagram** — Vitrine + link na bio para checkout. Stories + Reels para mostrar as atividades. Sem taxa de venda.
6. **WhatsApp** — Venda direta com catálogo. Funciona bem para público local e indicações.
7. **Mercado Livre** — Aceita produtos digitais. Grande tráfego orgânico.
8. **Elo7** — Marketplace de produtos criativos, inluindo materiais educacionais.

## Conhecimento de Mercado
- Faixas de preço praticadas por tipo de material
- O que vende mais em cada plataforma
- Tendências de busca (sazonalidade: volta às aulas, dia do professor, etc.)
- Formato de produto que converte melhor (unitário vs pacote)
- Público-alvo: professores de escola pública, particular, mães homeschooling

## Regras de Resposta
1. Retorne SEMPRE em formato JSON válido, sem texto fora do JSON.
2. Seja específico com números (preços em R$, percentuais de comissão).
3. Baseie-se em dados realistas do mercado brasileiro de educação.
4. Indique a plataforma MAIS adequada para o tipo de produto analisado.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "product_analysis": {
    "type": "<tipo do produto>",
    "target_audience": "<público-alvo>",
    "market_size": "<tamanho estimado do mercado>",
    "competition_level": "baixa|média|alta",
    "trending": true|false,
    "seasonality": "<quando vende mais>"
  },
  "platforms": [
    {
      "name": "<nome da plataforma>",
      "fit_score": <1-10>,
      "commission_pct": "<ex: 10-15%>",
      "pros": ["<vantagem 1>", "<vantagem 2>"],
      "cons": ["<desvantagem 1>"],
      "recommended_price_range": {"min": <valor>, "max": <valor>, "currency": "BRL"}
    }
  ],
  "competitors_overview": {
    "typical_price_range": {"min": <valor>, "max": <valor>, "currency": "BRL"},
    "common_formats": ["<formato 1>", "<formato 2>"],
    "gaps_opportunities": ["<oportunidade 1>", "<oportunidade 2>"]
  },
  "recommendation": "<recomendação principal em 2-3 frases>"
}`;

export class MarketAnalysisTool extends BaseTool {
  public readonly name = 'analyze_market';
  public readonly description =
    'Analisa o mercado para um produto educacional digital (atividades em PDF, apostilas, etc). ' +
    'Retorna análise de plataformas (Hotmart, Eduzz, Kiwify, Shopee, Instagram), concorrência, ' +
    'preços praticados e oportunidades. Use após criar uma atividade para entender onde e como vender.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      productType: {
        type: 'string',
        description:
          'Tipo de produto. Ex: "cruzadinha", "pacote-atividades-1-ano", "apostila-alfabetizacao", "kit-folclore".',
      },
      targetGrade: {
        type: 'string',
        description:
          'Série/faixa etária do público. Ex: "1-ano", "2-ano", "educacao-infantil".',
      },
      theme: {
        type: 'string',
        description:
          'Tema do produto. Ex: "folclore", "animais", "alfabetizacao", "matematica-basica".',
      },
      additionalContext: {
        type: 'string',
        description:
          'Opcional. Contexto extra: quantidade de atividades, formato, diferenciais.',
      },
    },
    required: ['productType', 'targetGrade', 'theme'],
  };

  private providerFactory: ProviderFactory;

  constructor(providerFactory: ProviderFactory) {
    super();
    this.providerFactory = providerFactory;
  }

  public async execute(args: Record<string, unknown>): Promise<string> {
    const productType = args.productType as string;
    const targetGrade = args.targetGrade as string;
    const theme = args.theme as string;
    const additionalContext = (args.additionalContext as string) || '';

    logger.info(MODULE, `Analyzing market for: ${productType} - ${theme} (${targetGrade})`);

    try {
      const provider = this.providerFactory.getProvider(config.llm.defaultProvider);
      if (!provider) {
        throw new Error('Nenhum provedor LLM disponível.');
      }

      const userPrompt = `Analise o mercado brasileiro para este produto educacional:

Tipo de produto: ${productType}
Série/faixa etária: ${targetGrade}
Tema: ${theme}
${additionalContext ? `Contexto adicional: ${additionalContext}` : ''}

Forneça análise completa de plataformas, concorrência e oportunidades.`;

      const response = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        [],
        MARKET_SYSTEM_PROMPT
      );

      let result = response.text || '';
      result = result.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      try {
        const parsed = JSON.parse(result);
        logger.info(MODULE, `Market analysis complete for: ${productType}`);
        return JSON.stringify({ ...parsed, success: true });
      } catch {
        logger.warn(MODULE, 'Market analysis response was not valid JSON');
        return result;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Market analysis failed: ${errorMsg}`);
      return JSON.stringify({ error: `Falha na análise de mercado: ${errorMsg}` });
    }
  }
}
