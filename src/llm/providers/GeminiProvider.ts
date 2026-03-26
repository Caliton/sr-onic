import { GoogleGenerativeAI, Content, Part, Tool, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { ILlmProvider, ChatMessage, ToolDefinition, LlmResponse, ToolCall } from '../ILlmProvider';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class GeminiProvider implements ILlmProvider {
  public readonly name = 'gemini';
  public isAvailable = true;
  private client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(config.llm.geminiApiKey);
    if (!config.llm.geminiApiKey) {
      this.isAvailable = false;
      logger.warn('GeminiProvider', 'No API key configured, provider disabled');
    }
  }

  public async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LlmResponse> {
    const model = this.client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt || undefined,
      generationConfig: {
        maxOutputTokens: 2048,
      },
    });

    const geminiHistory = this.buildHistory(messages);
    const lastMessage = messages[messages.length - 1];

    const geminiTools: Tool[] | undefined = tools && tools.length > 0
      ? [{ functionDeclarations: tools.map((t) => this.toFunctionDeclaration(t)) }]
      : undefined;

    const chat = model.startChat({
      history: geminiHistory,
      tools: geminiTools,
    });

    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;
    const candidate = response.candidates?.[0];

    if (!candidate || !candidate.content) {
      return { text: response.text() || 'Sem resposta do Gemini.' };
    }

    const toolCalls: ToolCall[] = [];
    let text = '';

    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          arguments: (part.functionCall.args as Record<string, unknown>) || {},
        });
      } else if (part.text) {
        text += part.text;
      }
    }

    if (toolCalls.length > 0) {
      return { toolCalls };
    }

    return { text: text || response.text() || '' };
  }

  private buildHistory(messages: ChatMessage[]): Content[] {
    // Exclude the last message (sent as current input) and system messages
    const history: Content[] = [];
    const relevantMessages = messages.slice(0, -1);

    for (const msg of relevantMessages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'tool') {
        history.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.toolName || 'tool_result',
              response: { result: msg.content },
            },
          }],
        });
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        history.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }

    return history;
  }

  private toFunctionDeclaration(tool: ToolDefinition): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: this.convertSchema(tool.parameters),
    };
  }

  private convertSchema(schema: Record<string, unknown>): any {
    const result: any = {};

    if (schema.type === 'object') {
      result.type = SchemaType.OBJECT;
      if (schema.properties) {
        result.properties = {};
        for (const [key, value] of Object.entries(schema.properties as Record<string, any>)) {
          result.properties[key] = this.convertPropertySchema(value);
        }
      }
      if (schema.required) {
        result.required = schema.required;
      }
    }

    return result;
  }

  private convertPropertySchema(prop: any): any {
    const typeMap: Record<string, SchemaType> = {
      string: SchemaType.STRING,
      number: SchemaType.NUMBER,
      integer: SchemaType.INTEGER,
      boolean: SchemaType.BOOLEAN,
      array: SchemaType.ARRAY,
      object: SchemaType.OBJECT,
    };

    const result: any = {
      type: typeMap[prop.type] || SchemaType.STRING,
      description: prop.description || '',
    };

    if (prop.enum) {
      result.enum = prop.enum;
    }

    if (prop.items) {
      result.items = this.convertPropertySchema(prop.items);
    }

    return result;
  }
}
