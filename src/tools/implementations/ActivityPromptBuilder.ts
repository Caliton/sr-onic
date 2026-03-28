/**
 * ActivityPromptBuilder — Constrói prompts estruturados para geração de PDFs de atividades pedagógicas.
 *
 * Responsabilidades:
 * - Montar o prompt por seções (header, estrutura, regras por tipo, estilo, conteúdo)
 * - Mapa extensível de regras por tipo de atividade
 * - Derivar faixa etária a partir do grade
 * - Sugestões de elementos SVG por tema
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ActivityPromptParams {
  grade: string;
  type: string;
  theme: string;
  studentContent: string;
  hasImage: boolean;
}

// ─── System Prompt Pedagógico ────────────────────────────────────────────────

export const ACTIVITY_SYSTEM_PROMPT = `Você é a **Duda**, a designer de materiais pedagógicos infantis da equipe do SrOnic.
Sua especialidade é transformar especificações de atividades em HTML profissional pronto para impressão em PDF.

REGRAS OBRIGATÓRIAS:
1. Retorne APENAS o HTML completo (<!DOCTYPE html>...</html>). Sem explicações, sem markdown, sem blocos de código.
2. Use CSS inline no <style> dentro do <head>. Nunca use links externos (fontes, CDNs, etc).
3. Use a diretiva @page para definir margens: @page { margin: 1.5cm 2cm; }
4. Use fontes seguras e legíveis: 'Comic Sans MS', 'Segoe UI', Arial, sans-serif.
5. O layout deve ser otimizado para impressão A4 em PRETO E BRANCO.
6. Use page-break-before/after para controlar paginação em atividades longas.
7. Todos os elementos visuais (tabelas, grids, SVGs) devem usar bordas escuras e alto contraste.
8. Tabelas devem ter border-collapse: collapse, bordas sólidas (#000), padding generoso.
9. Listas e textos devem ter espaçamento confortável para crianças escreverem.
10. O documento deve parecer uma FOLHA DE ATIVIDADE ESCOLAR profissional — não um relatório corporativo.

ADAPTAÇÃO POR FAIXA ETÁRIA:
- 1º-2º ano (5-7 anos): Fonte mínimo 20px, instruções muito curtas e lúdicas, poucos itens por atividade.
- 3º ano (7-9 anos): Fonte mínimo 18px, instruções claras, complexidade moderada.
- 4º-5º ano (9-11 anos): Fonte mínimo 16px, instruções mais detalhadas, maior complexidade e número de itens.

ESTILOS DE ATIVIDADE:
- Sempre use "moderno" como estilo base: layout limpo, espaçoso, organizado.
- Elementos decorativos (bordas arredondadas, ícones simples) são bem-vindos desde que não atrapalhem a impressão P&B.
- Cabeçalhos devem ser grandes, chamativos e usar fonte bold.`;

// ─── Mapa de Regras por Tipo ─────────────────────────────────────────────────

const ACTIVITY_TYPE_RULES: Record<string, string> = {
  cruzadinha: `CRUZADINHA:
- Tabela HTML com quadrados vazios (min 36x36px) e bordas grossas (2px solid #000).
- Cada célula editável deve estar vazia; células bloqueadas devem ter fundo #ccc.
- Numere as palavras (horizontal e vertical) com números pequenos no canto superior esquerdo da célula.
- Abaixo da grade: lista de DICAS numeradas separadas em "Horizontal" e "Vertical".
- A grade deve ser centralizada e ocupar pelo menos 60% da largura da página.`,

  'caca-palavras': `CAÇA-PALAVRAS:
- Tabela de letras com fonte monospace grande e espaçamento uniforme.
- Tamanho da grade: 10x10 (1º-2º ano), 12x12 (3º ano), 15x15 (4º-5º ano).
- Palavras escondidas na horizontal, vertical e diagonal (somente leitura esquerda→direita e cima→baixo).
- Preencha células vazias com letras aleatórias maiúsculas.
- Abaixo da grade: lista das palavras para encontrar, em 2-3 colunas lado a lado.
- Cada célula da tabela deve ter bordas finas (#999) e padding uniforme.`,

  'completar-lacunas': `COMPLETAR LACUNAS:
- Texto com linhas longas ____________ (mínimo 15 underscores) no lugar das respostas.
- Cada lacuna deve ter espaço suficiente para a criança escrever a resposta à mão.
- Numere as lacunas se houver um banco de palavras.
- Opcional: inclua um BANCO DE PALAVRAS em um box destacado no topo ou rodapé.
- Espaçamento entre linhas deve ser grande (line-height: 2.5) para facilitar a escrita.`,

  colorir: '', // Construído dinamicamente em buildColoringRule()

  labirinto: `LABIRINTO:
- Crie um labirinto usando uma tabela HTML (grid).
- Use bordas CSS seletivas em cada célula para criar as paredes do labirinto:
  Exemplo: border-top: 3px solid #000 para parede no topo, border: none para passagem.
- Tamanho do grid: 8x8 (1º-2º ano), 12x12 (3º-4º ano), 15x15 (5º ano).
- Marque claramente a ENTRADA (com emoji 🚀 ou texto "Início →") e SAÍDA (com emoji ⭐ ou texto "Chegada!").
- O caminho correto deve existir e ser único.
- As paredes devem ter alto contraste (preto, 3px) para impressão P&B.
- O labirinto deve ocupar pelo menos 70% da área útil da página.`,

  'ligar-pontos': `LIGAR OS PONTOS:
- Crie pontos numerados sequencialmente (1, 2, 3, ...) posicionados com CSS.
- Use um container com position: relative e os pontos com position: absolute.
- Cada ponto deve ser um círculo (border-radius: 50%) com número dentro, font-size grande.
- Quantidade de pontos: 15-20 (1º-2º ano), 25-35 (3º ano), 40-60 (4º-5º ano).
- Os pontos devem formar o contorno de um desenho relacionado ao tema quando ligados em ordem.
- Espaçamento entre pontos adjacentes deve ser suficiente para a criança traçar a linha com lápis.
- Instrução clara: "Ligue os pontos na ordem numérica para descobrir o desenho!"`,
};

// ─── Builder ─────────────────────────────────────────────────────────────────

export class ActivityPromptBuilder {
  /**
   * Constrói o prompt completo para geração de atividade.
   */
  build(params: ActivityPromptParams): string {
    const sections = [
      this.buildHeader(params),
      this.buildStructure(params),
      this.buildTypeRule(params),
      this.buildStyleRules(params),
      this.buildContent(params),
    ];

    return sections.filter(Boolean).join('\n\n');
  }

  // ── Seções ───────────────────────────────────────────────────────────────

  private buildHeader(params: ActivityPromptParams): string {
    const gradeLabel = params.grade.replace('-', 'º ');
    const ageRange = this.getAgeRange(params.grade);

    return `FOLHA DE ATIVIDADE PARA IMPRESSÃO — ${gradeLabel} do Ensino Fundamental (${ageRange})
Tipo: ${params.type}

CRIE O HTML DE UMA FOLHA DE ATIVIDADE PRONTA PARA O ALUNO. O produto final será IMPRESSO pela professora e entregue às crianças.`;
  }

  private buildStructure(params: ActivityPromptParams): string {
    const items = [
      '1. No topo: "Nome: ___________________________  Data: ___/___/___  Turma: _______"',
      '2. Título grande e chamativo da atividade.',
      '3. Instruções curtas e lúdicas para a criança.',
      '4. A ATIVIDADE EM SI (grids, tabelas, lacunas, imagens — conforme o tipo).',
    ];

    if (params.hasImage) {
      items.push(
        '5. O conteúdo já contém tags <img> com imagens geradas pelo ilustrador. MANTENHA-AS EXATAMENTE COMO ESTÃO no HTML final.'
      );
    }

    return `ESTRUTURA OBRIGATÓRIA DO HTML:\n${items.join('\n')}`;
  }

  private buildTypeRule(params: ActivityPromptParams): string {
    const type = params.type.toLowerCase();

    // Tipo "colorir" é construído dinamicamente
    if (type === 'colorir') {
      return `REGRAS PARA ESTA ATIVIDADE (${params.type.toUpperCase()}):\n${this.buildColoringRule(params)}`;
    }

    // Busca no mapa de regras
    const rule = ACTIVITY_TYPE_RULES[type];
    if (rule) {
      return `REGRAS PARA ESTA ATIVIDADE (${params.type.toUpperCase()}):\n${rule}`;
    }

    // Tipo desconhecido — instrução genérica com contexto
    return `REGRAS PARA ESTA ATIVIDADE (${params.type.toUpperCase()}):
- Crie uma atividade interativa e adequada para impressão.
- Use elementos HTML nativos (tabelas, listas, inputs visuais).
- A atividade deve ser autoexplicativa para a criança.
- Ocupe pelo menos 60% da área útil da página com o conteúdo principal.`;
  }

  private buildColoringRule(params: ActivityPromptParams): string {
    if (params.hasImage) {
      return `COLORIR:
A imagem do ilustrador já está inclusa no conteúdo.
MANTENHA as tags <img> EXATAMENTE como estão no HTML final.
Centralize a imagem e garanta que ela ocupe a maior parte da página.`;
    }

    const svgElements = this.getSvgElementsForTheme(params.theme);

    return `COLORIR:
VOCÊ DEVE criar um desenho GRANDE para colorir usando um <svg> INLINE diretamente no HTML. ISSO É OBRIGATÓRIO — NÃO deixe espaço vazio.

O SVG deve seguir TODAS estas regras:
- Usar width="100%" e viewBox="0 0 800 600" para ocupar a página inteira.
- Usar APENAS stroke="#000" stroke-width="3" fill="none" (contornos pretos, sem preenchimento).
- Conter elementos GRANDES e SIMPLES relacionados ao tema: ${svgElements}
- Ter no mínimo 5-8 elementos distribuídos pela área do SVG.
- NÃO usar <text> dentro do SVG.
- O desenho deve ser detalhado o suficiente para uma criança colorir por 10-15 minutos.
- Use formas variadas: <circle>, <ellipse>, <rect>, <path>, <polygon> — evite repetir a mesma forma.`;
  }

  private buildStyleRules(params: ActivityPromptParams): string {
    const { minFontSize, lineHeight } = this.getStyleForGrade(params.grade);

    return `REGRAS DE ESTILO:
- Fonte grande (mínimo ${minFontSize}px), legível e amigável.
- Line-height: ${lineHeight} para facilitar leitura e escrita.
- Layout limpo e espaçoso, pensado para crianças.
- Funcione bem impresso em preto e branco.
- Bordas e contornos devem ter alto contraste (#000).`;
  }

  private buildContent(params: ActivityPromptParams): string {
    return `CONTEÚDO DA ATIVIDADE (use apenas estas informações):\n\n${params.studentContent}`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Deriva faixa etária a partir do grade (ex: "1-ano" → "5-7 anos").
   */
  private getAgeRange(grade: string): string {
    const year = parseInt(grade, 10);
    if (isNaN(year) || year <= 2) return '5-7 anos';
    if (year <= 3) return '7-9 anos';
    return '9-11 anos';
  }

  /**
   * Retorna parâmetros de estilo adaptados à série.
   */
  private getStyleForGrade(grade: string): { minFontSize: number; lineHeight: number } {
    const year = parseInt(grade, 10);
    if (isNaN(year) || year <= 2) return { minFontSize: 20, lineHeight: 2.0 };
    if (year <= 3) return { minFontSize: 18, lineHeight: 1.8 };
    return { minFontSize: 16, lineHeight: 1.6 };
  }

  /**
   * Retorna sugestões de elementos SVG baseadas no tema da atividade.
   */
  private getSvgElementsForTheme(theme: string): string {
    const t = theme.toLowerCase();

    const themeMap: Array<{ keywords: string[]; elements: string }> = [
      {
        keywords: ['natureza', 'meio ambiente', 'ecologia', 'planta'],
        elements: 'sol, nuvens, árvore grande com copa detalhada, flores variadas, rio com ondas, borboleta, pássaro',
      },
      {
        keywords: ['animal', 'animais', 'fauna', 'bicho'],
        elements: 'cachorro, gato, pássaro no galho, borboleta, árvore, nuvem, sol, grama',
      },
      {
        keywords: ['folclore', 'folklore', 'lenda', 'cultura'],
        elements: 'personagem com chapéu de palha, fogueira, casa simples, lua, estrelas, árvores',
      },
      {
        keywords: ['casa', 'família', 'lar', 'moradia'],
        elements: 'casa com telhado, porta, janelas, jardim, árvore, sol, nuvens, cerca',
      },
      {
        keywords: ['espaço', 'planeta', 'universo', 'astronauta', 'foguete'],
        elements: 'foguete, planeta com anel, estrelas, lua crescente, astronauta, cometa',
      },
      {
        keywords: ['mar', 'oceano', 'praia', 'peixe', 'água'],
        elements: 'peixe grande, estrela do mar, concha, ondas do mar, barco, sol, nuvem, gaivota',
      },
      {
        keywords: ['corpo', 'saúde', 'higiene'],
        elements: 'corpo humano simplificado, mãos, escova de dentes, frutas, coração',
      },
      {
        keywords: ['transporte', 'veículo', 'trânsito'],
        elements: 'carro, ônibus, semáforo, estrada, bicicleta, avião no céu, nuvens',
      },
      {
        keywords: ['comida', 'alimento', 'alimentação', 'fruta'],
        elements: 'maçã, banana, cenoura, prato, garfo e faca, copo, cesta de frutas',
      },
    ];

    for (const entry of themeMap) {
      if (entry.keywords.some((kw) => t.includes(kw))) {
        return entry.elements;
      }
    }

    // Fallback genérico
    return 'sol com raios, nuvens, árvore grande, flores, casa simples, pássaro, borboleta';
  }
}
