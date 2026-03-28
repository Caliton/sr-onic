import OpenAI from 'openai';
import { ILlmProvider, ChatMessage, ToolDefinition, LlmResponse, ToolCall } from '../ILlmProvider';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class DeepSeekProvider implements ILlmProvider {
  public readonly name = 'deepseek';
  public isAvailable = true;
  private client: OpenAI;

  constructor() {
    if (!config.llm.deepseekApiKey) {
      this.isAvailable = false;
      logger.warn('DeepSeekProvider', 'No API key configured, provider disabled');
    }

    this.client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: config.llm.deepseekApiKey || 'placeholder',
    });
  }

  public async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LlmResponse> {
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // System prompt
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        openaiMessages.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'tool') {
        openaiMessages.push({
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || 'tool_result',
        });
      } else if (msg.role === 'assistant') {
        const payload: OpenAI.Chat.ChatCompletionMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          payload.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id || 'tool_result',
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
          }));
        }
        openaiMessages.push(payload);
      } else {
        openaiMessages.push({ role: 'user', content: msg.content });
      }
    }

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined =
      tools && tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters as Record<string, unknown>,
            },
          }))
        : undefined;

    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: openaiMessages,
      tools: openaiTools,
      max_tokens: 16384,
    });

    const choice = response.choices[0];

    if (!choice) {
      return { text: 'Sem resposta do DeepSeek.' };
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = choice.message.tool_calls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          logger.warn('DeepSeekProvider', `Failed to parse tool args: ${tc.function.arguments}`);
        }
        return {
          name: tc.function.name,
          arguments: args,
        };
      });
      return { toolCalls };
    }

    return { text: choice.message.content || '' };
  }
}
