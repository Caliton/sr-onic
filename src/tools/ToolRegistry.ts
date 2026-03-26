import { BaseTool } from './BaseTool';
import { ToolDefinition } from '../llm/ILlmProvider';
import { logger } from '../utils/logger';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  public register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
    logger.info('ToolRegistry', `Registered tool: ${tool.name}`);
  }

  public getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  public getToolsSchema(): ToolDefinition[] {
    return this.getAllTools().map((tool) => tool.toDefinition());
  }

  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  public getToolDescriptions(): string {
    return this.getAllTools()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
  }
}
