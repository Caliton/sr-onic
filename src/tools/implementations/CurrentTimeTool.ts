import { BaseTool } from '../BaseTool';

export class CurrentTimeTool extends BaseTool {
  public readonly name = 'get_current_time';
  public readonly description = 'Retorna a data e hora atuais no fuso horário local do sistema.';
  public readonly parameters = {
    type: 'object' as const,
    properties: {},
    required: [],
  };

  public async execute(): Promise<string> {
    const now = new Date();
    return JSON.stringify({
      date: now.toLocaleDateString('pt-BR'),
      time: now.toLocaleTimeString('pt-BR'),
      iso: now.toISOString(),
      dayOfWeek: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
    });
  }
}
