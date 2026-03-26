import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const MODULE = 'Bia';

const STRATEGY_SYSTEM_PROMPT = `Você é a **Bia**, a Estrategista Comercial da equipe do SrOnic. Você é a marqueteira do time — criativa, persuasiva e mestre em gatilhos mentais. Seu lema é: "Isso aqui é R\$19,97, confia."

Você domina:
- Precificação psicológica (R$9,90 vs R$10, efeito âncora com "de/por")
- Estruturação de ofertas (unitário, combo, pacote mensal, assinatura)
- Copywriting persuasivo para professores e pais
- Marketing educacional (pain points: falta de tempo, material insuficiente, dificuldade de engajar alunos)
- Upsell e cross-sell de materiais complementares

## Conhecimento Específico

### Pain Points do Professor
- "Não tenho tempo de preparar material"
- "As atividades do livro são fracas"
- "Preciso de algo pronto para imprimir"
- "Meus alunos não se engajam"
- "Preciso de material alinhado à BNCC"

### Pain Points da Mãe/Homeschooling
- "Não sei como ensinar em casa"
- "Preciso de atividades para meu filho praticar"
- "Quero algo divertido que pareça brincadeira"

### Gatilhos Mentais Eficazes
- Escassez: "Últimas unidades com esse preço"
- Urgência: "Promoção até sexta-feira"
- Prova social: "Usado por +500 professores"
- Autoridade: "Alinhado à BNCC"
- Reciprocidade: "Baixe uma amostra grátis"

## Regras de Resposta
1. Retorne SEMPRE em formato JSON válido, sem texto fora do JSON.
2. Copies devem ser em português brasileiro, tom amigável e profissional.
3. Preços sempre em R$ com valores psicológicos (terminados em 7 ou 9).
4. Inclua pelo menos 2 opções de oferta (ex: unitário + combo).

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "pricing": {
    "unit_price": {"value": <número>, "justification": "<por que esse preço>"},
    "combo_options": [
      {
        "name": "<nome do combo>",
        "items": ["<item 1>", "<item 2>"],
        "original_price": <número>,
        "offer_price": <número>,
        "discount_pct": <número>,
        "justification": "<por que funciona>"
      }
    ],
    "subscription_model": {
      "viable": true|false,
      "monthly_price": <número>,
      "description": "<como funcionaria>"
    }
  },
  "sales_copy": {
    "headline": "<título principal da oferta>",
    "subheadline": "<subtítulo de apoio>",
    "bullet_points": ["<benefício 1>", "<benefício 2>", "<benefício 3>"],
    "cta": "<chamada para ação>",
    "urgency_element": "<elemento de urgência>",
    "social_proof": "<sugestão de prova social>"
  },
  "offer_ideas": [
    {
      "name": "<nome da oferta>",
      "description": "<descrição curta>",
      "target_audience": "<para quem>",
      "estimated_conversion": "baixa|média|alta"
    }
  ],
  "instagram_bio": "<sugestão de bio para perfil de venda>",
  "hashtags": ["<hashtag1>", "<hashtag2>"],
  "recommendation": "<estratégia principal recomendada em 2-3 frases>"
}`;

export class StrategyTool extends BaseTool {
  public readonly name = 'create_strategy';
  public readonly description =
    'Cria estratégia comercial completa para venda de produtos educacionais digitais. ' +
    'Inclui: definição de preço, estruturação de ofertas (combo, pacote mensal), copy de venda persuasiva, ' +
    'ideias de oferta e sugestões para Instagram/WhatsApp. Use após analyze_market para completar o plano comercial.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      productName: {
        type: 'string',
        description: 'Nome do produto. Ex: "Cruzadinha do Folclore - 1º Ano".',
      },
      productType: {
        type: 'string',
        description: 'Tipo de produto. Ex: "atividade-unica", "pacote-atividades", "apostila".',
      },
      targetGrade: {
        type: 'string',
        description: 'Série/faixa etária. Ex: "1-ano", "educacao-infantil".',
      },
      theme: {
        type: 'string',
        description: 'Tema. Ex: "folclore", "animais".',
      },
      marketData: {
        type: 'string',
        description:
          'Opcional. Dados da análise de mercado (output do analyze_market) para embasar a estratégia.',
      },
      activityCount: {
        type: 'number',
        description: 'Opcional. Número de atividades no produto/pacote.',
      },
    },
    required: ['productName', 'productType', 'targetGrade', 'theme'],
  };

  private providerFactory: ProviderFactory;

  constructor(providerFactory: ProviderFactory) {
    super();
    this.providerFactory = providerFactory;
  }

  public async execute(args: Record<string, unknown>): Promise<string> {
    const productName = args.productName as string;
    const productType = args.productType as string;
    const targetGrade = args.targetGrade as string;
    const theme = args.theme as string;
    const marketData = (args.marketData as string) || '';
    const activityCount = (args.activityCount as number) || 1;

    logger.info(MODULE, `Creating strategy for: ${productName}`);

    try {
      const provider = this.providerFactory.getProvider(config.llm.defaultProvider);
      if (!provider) {
        throw new Error('Nenhum provedor LLM disponível.');
      }

      const userPrompt = `Crie uma estratégia comercial completa para este produto educacional:

Produto: ${productName}
Tipo: ${productType}
Série: ${targetGrade}
Tema: ${theme}
Quantidade de atividades: ${activityCount}

${marketData ? `DADOS DE MERCADO (do Agente de Mercado):\n${marketData}` : 'Sem dados de mercado — baseie-se no seu conhecimento geral.'}

Gere: precificação, opções de combo, copy de venda, ideias de oferta e sugestões de marketing.`;

      const response = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        [],
        STRATEGY_SYSTEM_PROMPT
      );

      let result = response.text || '';
      result = result.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      try {
        const parsed = JSON.parse(result);
        logger.info(MODULE, `Strategy created for: ${productName}`);
        return JSON.stringify({ ...parsed, success: true });
      } catch {
        logger.warn(MODULE, 'Strategy response was not valid JSON');
        return result;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Strategy creation failed: ${errorMsg}`);
      return JSON.stringify({ error: `Falha ao criar estratégia: ${errorMsg}` });
    }
  }
}
