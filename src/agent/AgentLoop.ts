import { ChatMessage, LlmResponse, ToolCall } from '../llm/ILlmProvider';
import { ProviderFactory } from '../llm/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Context } from 'grammy';

const MODULE = 'AgentLoop';

export interface AgentLoopResult {
  response: string;
  isFile?: boolean;
  fileName?: string;
  isAudio?: boolean;
}

export class AgentLoop {
  private providerFactory: ProviderFactory;
  private toolRegistry: ToolRegistry;
  private typingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(providerFactory: ProviderFactory, toolRegistry: ToolRegistry) {
    this.providerFactory = providerFactory;
    this.toolRegistry = toolRegistry;
  }

  public async run(
    messages: ChatMessage[],
    systemPrompt: string,
    ctx: Context,
    preferredProvider?: string
  ): Promise<AgentLoopResult> {
    const maxIterations = config.agent.maxIterations || 5;
    const tools = this.toolRegistry.getToolsSchema();
    let currentMessages = [...messages];
    let iteration = 0;
    let providerName = preferredProvider || config.llm.defaultProvider;

    // Start typing indicator
    this.startTypingIndicator(ctx);

    // Global pipeline timeout
    const timeoutMs = config.agent.pipelineTimeoutMs;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      while (iteration < maxIterations) {
        if (abortController.signal.aborted) {
          logger.warn(MODULE, `Pipeline timeout reached (${timeoutMs}ms)`);
          return {
            response: '⚠️ Processamento excedeu o tempo limite. Tente simplificar a solicitação.',
          };
        }

        iteration++;
        logger.info(MODULE, `--- Iteration ${iteration}/${maxIterations} ---`);

        // Get LLM response with fallback
        let llmResponse: LlmResponse;
        try {
          llmResponse = await this.callLlmWithFallback(currentMessages, tools, systemPrompt, providerName);
        } catch (err) {
          logger.error(MODULE, `All providers failed: ${err}`);
          return {
            response: '⚠️ Nenhum provedor de IA disponível no momento. Tente novamente em alguns minutos.',
          };
        }

        // If we got a text response (final answer), return it
        if (llmResponse.text && (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0)) {
          logger.info(MODULE, `Final answer received at iteration ${iteration}`);
          return this.parseResponse(llmResponse.text);
        }

        // Process tool calls
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          // Normalize tool calls to ensure they have an ID (Gemini doesn't provide them natively)
          const normalizedToolCalls = llmResponse.toolCalls.map(tc => ({
            ...tc,
            id: tc.id || `call_${Math.random().toString(36).substring(7)}`
          }));

          // Inject the assistant message containing the tool calls
          currentMessages.push({
            role: 'assistant',
            content: '', // Empty content, but carries tool calls
            toolCalls: normalizedToolCalls,
          });

          for (const toolCall of normalizedToolCalls) {
            logger.info(MODULE, `[Action] Tool: ${toolCall.name} | Args: ${JSON.stringify(toolCall.arguments)}`);

            const observation = await this.executeTool(toolCall);
            logger.info(MODULE, `[Observation] ${observation.substring(0, 200)}...`);

            currentMessages.push({
              role: 'tool',
              content: observation,
              toolName: toolCall.name,
              toolCallId: toolCall.id,
            });
          }
        }
      }

      // Max iterations reached
      logger.warn(MODULE, `Max iterations (${maxIterations}) reached`);
      return {
        response: `⚠️ Limite de iterações atingido (${maxIterations}). Não consegui completar o processamento. Tente reformular sua solicitação.`,
      };
    } finally {
      clearTimeout(timeoutId);
      this.stopTypingIndicator();
    }
  }

  private async callLlmWithFallback(
    messages: ChatMessage[],
    tools: any[],
    systemPrompt: string,
    preferredProvider: string
  ): Promise<LlmResponse> {
    // Try preferred provider first
    const primary = this.providerFactory.getProvider(preferredProvider);
    if (primary) {
      try {
        const response = await primary.chat(messages, tools, systemPrompt);
        this.providerFactory.reportSuccess(primary.name);
        return response;
      } catch (err) {
        logger.warn(MODULE, `Provider ${primary.name} failed: ${err}`);
        this.providerFactory.reportFailure(primary.name);
      }
    }

    // Try fallback providers
    const fallback = this.providerFactory.getNextAvailable(preferredProvider);
    if (fallback) {
      try {
        logger.info(MODULE, `Falling back to provider: ${fallback.name}`);
        const response = await fallback.chat(messages, tools, systemPrompt);
        this.providerFactory.reportSuccess(fallback.name);
        return response;
      } catch (err) {
        logger.error(MODULE, `Fallback provider ${fallback.name} also failed: ${err}`);
        this.providerFactory.reportFailure(fallback.name);
      }
    }

    throw new Error('All LLM providers are unavailable');
  }

  private async executeTool(toolCall: ToolCall): Promise<string> {
    const tool = this.toolRegistry.getTool(toolCall.name);
    if (!tool) {
      return JSON.stringify({ error: `Ferramenta '${toolCall.name}' não encontrada. Ferramentas disponíveis: ${this.toolRegistry.getToolNames().join(', ')}` });
    }

    try {
      const result = await tool.execute(toolCall.arguments);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, `Tool ${toolCall.name} execution error: ${errorMsg}`);
      return JSON.stringify({ error: `Erro ao executar '${toolCall.name}': ${errorMsg}` });
    }
  }

  private parseResponse(text: string): AgentLoopResult {
    // Check for file output markers (full pattern)
    const fileMatch = text.match(/<<<ARQUIVO:(.+?)>>>([\s\S]+?)<<<\/ARQUIVO>>>/);
    if (fileMatch) {
      // Extract the text outside the marker as extra context
      const textOutside = text.replace(/<<<ARQUIVO:(.+?)>>>[\s\S]+?<<<\/ARQUIVO>>>/, '').trim();
      const response = textOutside || fileMatch[2].trim();

      return {
        response,
        isFile: true,
        fileName: fileMatch[1].trim(),
      };
    }

    // Strip any partial/leaked <<<ARQUIVO>>> markers from the text
    const cleanText = text.replace(/<<<\/?ARQUIVO[^>]*>>>/g, '').trim();

    return { response: cleanText || text };
  }

  private startTypingIndicator(ctx: Context): void {
    // Send typing immediately
    ctx.replyWithChatAction('typing').catch(() => {});

    // Refresh every 4 seconds (TG typing expires after ~5s)
    this.typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);
  }

  private stopTypingIndicator(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }
}
