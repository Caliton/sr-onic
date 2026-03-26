import { BaseTool } from '../BaseTool';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const MODULE = 'Neto';

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilySearchResult[];
  answer?: string;
  query: string;
}

export class WebSearchTool extends BaseTool {
  public readonly name = 'web_search';
  public readonly description =
    'Pesquisa na internet usando busca web. Retorna resultados relevantes com título, URL e conteúdo extraído. ' +
    'Use para pesquisar preços, concorrentes, tendências, informações atualizadas ou qualquer dado que precise da internet. ' +
    'Exemplo: pesquisar preços de atividades pedagógicas na Hotmart, ver concorrentes no mercado.';

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'A consulta de busca. Ex: "atividades pedagógicas 1 ano pdf preço hotmart", "cruzadinha infantil para vender".',
      },
      maxResults: {
        type: 'number',
        description:
          'Número máximo de resultados (padrão: 5, máximo: 10).',
      },
      searchDepth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description:
          'Profundidade da busca. "basic" = rápido e econômico. "advanced" = mais detalhado (usa mais créditos). Padrão: "basic".',
      },
      includeAnswer: {
        type: 'boolean',
        description:
          'Se true, a API também retorna uma resposta resumida gerada automaticamente. Padrão: true.',
      },
    },
    required: ['query'],
  };

  public async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min((args.maxResults as number) || 5, 10);
    const searchDepth = (args.searchDepth as string) || 'basic';
    const includeAnswer = args.includeAnswer !== false;

    const apiKey = config.search.tavilyApiKey;

    if (!apiKey) {
      return JSON.stringify({
        error: 'TAVILY_API_KEY não configurada. Adicione ao arquivo .env para habilitar busca web.',
        suggestion: 'Crie uma conta gratuita em https://tavily.com e adicione a chave no .env',
      });
    }

    logger.info(MODULE, `Searching: "${query}" (depth: ${searchDepth}, max: ${maxResults})`);

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: maxResults,
          search_depth: searchDepth,
          include_answer: includeAnswer,
          include_raw_content: false,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tavily API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as TavilyResponse;

      logger.info(MODULE, `Search returned ${data.results.length} results for: "${query}"`);

      // Format results for LLM consumption
      const formattedResults = data.results.map((r, i) => ({
        position: i + 1,
        title: r.title,
        url: r.url,
        content: r.content.substring(0, 500), // Limit content length
        relevance: r.score,
      }));

      return JSON.stringify({
        success: true,
        query,
        answer: data.answer || null,
        resultCount: formattedResults.length,
        results: formattedResults,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Search failed: ${errorMsg}`);

      return JSON.stringify({
        error: `Falha na busca web: ${errorMsg}`,
        query,
      });
    }
  }
}
