import { ToolDefinition } from '../llm/ILlmProvider';

export abstract class BaseTool {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly parameters: ToolDefinition['parameters'];

  public abstract execute(args: Record<string, unknown>): Promise<string>;

  public toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}
