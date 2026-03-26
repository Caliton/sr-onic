import { BaseTool } from '../BaseTool';
import { ProviderFactory } from '../../llm/ProviderFactory';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const MODULE = 'SeuRaimundo';

const CRITIC_SYSTEM_PROMPT = `Você é o **Seu Raimundo**, o Agente Crítico da equipe do SrOnic. Você é um professor aposentado com 30 anos de experiência, exigente mas justo. Seu bordão é "Tá bom, mas pode melhorar."

Seu papel é avaliar atividades pedagógicas com rigor e carinho, como se fosse usá-las na sua própria sala de aula. Você avalia com os olhos de:
1. Um PEDAGOGO experiente (qualidade educacional)
2. Um PROFESSOR que vai usar em sala (praticidade e clareza)
3. Um COMPRADOR (um professor compraria isso em uma plataforma?)
4. Uma CRIANÇA (é divertido e engajante para a faixa etária?)

REGRAS DE AVALIAÇÃO:
- Retorne SEMPRE em formato JSON válido, sem texto fora do JSON.
- Cada critério recebe nota de 1 a 10.
- Se QUALQUER nota for menor que 7, defina "approved" como false.
- No campo "feedback", seja ESPECÍFICO sobre o que precisa melhorar.
- No campo "improvements", liste ações concretas (não genéricas).

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON puro):
{
  "scores": {
    "pedagogical_quality": <1-10>,
    "clarity": <1-10>,
    "attractiveness": <1-10>,
    "age_appropriateness": <1-10>,
    "marketability": <1-10>
  },
  "approved": <true|false>,
  "feedback": "<resumo geral da avaliação>",
  "improvements": ["<melhoria 1>", "<melhoria 2>", ...]
}

CRITÉRIOS DETALHADOS:
- pedagogical_quality: Objetivos claros? Alinhado à BNCC? Desenvolve habilidades adequadas?
- clarity: Instruções simples? Uma criança entenderia sozinha? Professor saberia aplicar?
- attractiveness: Visual atrativo? Temática engajante? A criança QUER fazer?
- age_appropriateness: Dificuldade adequada à série? Vocabulário correto? Quantidade de itens ok?
- marketability: Um professor compraria isso? Tem qualidade profissional? Se destaca?`;

export class EvaluateActivityTool extends BaseTool {
  public readonly name = 'evaluate_activity';
  public readonly description =
    'Avalia a qualidade de uma atividade pedagógica usando um Agente Crítico. ' +
    'Retorna notas (1-10) em 5 critérios: qualidade pedagógica, clareza, atratividade, adequação etária e vendabilidade. ' +
    'Se algum critério ficar abaixo de 7, a atividade é reprovada com feedback de melhorias. ' +
    'SEMPRE use esta ferramenta DEPOIS de save_activity e ANTES de gerar o PDF.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      activityContent: {
        type: 'string',
        description:
          'O conteúdo completo da atividade que foi salva pelo save_activity (incluindo objetivos, instruções, conteúdo e estilo).',
      },
      grade: {
        type: 'string',
        description: 'Série escolar (ex: "1-ano", "3-ano").',
      },
      type: {
        type: 'string',
        description: 'Tipo de atividade (ex: "cruzadinha", "caca-palavras").',
      },
    },
    required: ['activityContent', 'grade', 'type'],
  };

  private providerFactory: ProviderFactory;

  constructor(providerFactory: ProviderFactory) {
    super();
    this.providerFactory = providerFactory;
  }

  public async execute(args: Record<string, unknown>): Promise<string> {
    const content = args.activityContent as string;
    const grade = args.grade as string;
    const type = args.type as string;

    logger.info(MODULE, `Evaluating activity: ${type} for ${grade}`);

    try {
      const provider = this.providerFactory.getProvider(config.llm.defaultProvider);
      if (!provider) {
        throw new Error('Nenhum provedor LLM disponível para avaliação.');
      }

      const userPrompt = `Avalie esta atividade pedagógica:

Série: ${grade}
Tipo: ${type}

CONTEÚDO DA ATIVIDADE:
${content}`;

      const response = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        [],
        CRITIC_SYSTEM_PROMPT
      );

      let result = response.text || '';

      // Clean up if LLM wrapped in code blocks
      result = result.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      // Try to parse as JSON to validate
      try {
        const evaluation = JSON.parse(result);
        logger.info(MODULE, `Evaluation complete — Approved: ${evaluation.approved}`);

        if (evaluation.approved) {
          return JSON.stringify({
            ...evaluation,
            message: '✅ Seu Raimundo aprovou! "Agora sim, tá caprichado. Pode mandar pra Duda fazer o PDF."',
          });
        } else {
          return JSON.stringify({
            ...evaluation,
            message: '⚠️ Seu Raimundo reprovou: "Tá bom, mas pode melhorar. Arruma esses pontos aí e me mostra de novo."',
          });
        }
      } catch {
        // If JSON parse fails, return raw response
        logger.warn(MODULE, 'Critic response was not valid JSON, returning raw');
        return result;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Evaluation failed: ${errorMsg}`);
      return JSON.stringify({
        error: `Falha na avaliação: ${errorMsg}`,
        approved: true, // On error, don't block the pipeline
      });
    }
  }
}
