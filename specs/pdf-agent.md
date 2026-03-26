# Spec: PDF Generator Agent (Sub-Agente)

**Versão:** 1.0
**Status:** Aprovada
**Autor:** Antigravity (IA)
**Data:** 2026-03-25

---

## 1. Resumo

O PDF Generator Agent é um sub-agente do SrOnic especializado em gerar documentos PDF profissionais. Ele funciona como uma `BaseTool` (`generate_pdf`) que o Agent Loop principal pode invocar. Internamente, o sub-agente realiza uma chamada LLM dedicada para converter conteúdo textual em HTML+CSS estilizado e, em seguida, renderiza o HTML em PDF via Puppeteer (headless Chromium) no formato A4.

---

## 2. Contexto e Motivação

**Problema:**
O usuário frequentemente precisa gerar documentos formatados (relatórios, contratos, currículos, specs) a partir de conversas no Telegram. Sem uma ferramenta dedicada, o LLM só consegue gerar texto puro ou Markdown, que não é ideal para distribuição profissional.

**Evidências:**
Tentativas anteriores de gerar PDFs usando apenas strings formatadas no chat produzem resultados sem qualidade de impressão. PDFs profissionais exigem layout, tipografia e paginação controlados — algo que só se obtém via HTML/CSS renderizado.

**Por que agora:**
O Puppeteer renderiza qualquer HTML+CSS em PDF pixel-perfect sem necessidade de ferramentas externas. Combinado com a capacidade do LLM de gerar HTML sofisticado, temos um pipeline poderoso para documentos sob demanda.

---

## 3. Goals (Objetivos)

- [ ] G-01: Prover uma `BaseTool` (`generate_pdf`) que o Agent Loop invoca para gerar PDFs profissionais.
- [ ] G-02: Utilizar o LLM internamente (sub-agente) para converter conteúdo textual em HTML+CSS otimizado para impressão.
- [ ] G-03: Renderizar o HTML via Puppeteer em PDF formato A4 com margens configuradas.
- [ ] G-04: Suportar 3 estilos visuais: "formal", "moderno" e "minimalista".
- [ ] G-05: Integrar com o `FileOutputStrategy` para enviar o PDF como documento no Telegram.

**Métricas de sucesso:**
| Métrica | Baseline atual | Target | Prazo |
|---------|---------------|--------|-------|
| Taxa de geração com sucesso | N/A | 95%+ dos requests geram PDF válido | MVP |
| Tempo de geração (HTML+PDF) | N/A | < 30s para documentos de até 5 páginas | MVP |

---

## 4. Non-Goals (Fora do Escopo)

- NG-01: Editar PDFs existentes. O sub-agente apenas cria novos PDFs.
- NG-02: OCR ou extração de conteúdo de PDFs existentes (já coberto pelo `pdf-parse` no InputHandler).
- NG-03: Templates com campos preenchíveis (formulários PDF). O foco é documentos estáticos.
- NG-04: Geração de PDFs com imagens externas. Apenas texto e styling CSS.

---

## 5. Usuários e Personas

**Módulo Cliente:** O `AgentLoop` principal invoca a tool `generate_pdf` quando o LLM decide que o usuário quer um documento PDF. A `SkillRouter` pode ativar a skill `pdf-generator` para enriquecer o system prompt com instruções de uso da ferramenta.

---

## 6. Requisitos Funcionais

### 6.1 Requisitos Principais

| ID | Requisito | Prioridade | Critério de Aceite |
|----|-----------|-----------|-------------------|
| RF-01 | A tool `generate_pdf` deve aceitar `content` (texto), `fileName` (string) e `style` (opcional) como parâmetros. | Must | O LLM consegue invocar a tool com os parâmetros corretos via JSON schema. |
| RF-02 | O sub-agente deve chamar o LLM com system prompt especializado para gerar HTML+CSS inline otimizado para PDF. | Must | O HTML gerado é completo (`<!DOCTYPE html>...`) com estilos embutidos, sem dependências externas. |
| RF-03 | O Puppeteer deve renderizar o HTML em PDF formato A4 com margens 2cm/2.5cm e background ativo. | Must | PDF abre corretamente em qualquer leitor e tem layout profissional A4. |
| RF-04 | Após a geração, o PDF deve ser salvo em `./tmp/` e o retorno deve usar o marcador `<<<ARQUIVO:nome.pdf>>>` para o output handler enviar como documento. | Must | O Telegram entrega o PDF como documento anexo ao usuário. |
| RF-05 | O `FileOutputStrategy` deve detectar que o arquivo já existe no disco (binário) e enviá-lo diretamente sem sobrescrever com texto. | Must | PDFs são enviados como arquivos binários válidos, não como texto. |

### 6.2 Fluxo Principal (Happy Path)

1. Usuário envia no Telegram: "Gera um PDF com um relatório sobre IA"
2. SkillRouter ativa a skill `pdf-generator`.
3. Agent Loop recebe system prompt enriquecido com instruções da skill.
4. LLM decide chamar a tool `generate_pdf({content: "...", fileName: "relatorio_ia.pdf", style: "moderno"})`.
5. PdfGeneratorTool chama o LLM internamente para gerar HTML estilizado.
6. HTML é renderizado via Puppeteer → PDF salvo em `./tmp/relatorio_ia.pdf`.
7. Tool retorna marcador de arquivo para o Agent Loop.
8. Agent Loop aciona FileOutputStrategy → PDF enviado como documento no Telegram.
9. Arquivo temporário é deletado após envio.

### 6.3 Fluxos Alternativos

**Fluxo Alternativo A — LLM falha ao gerar HTML:**
1. O provider retorna erro ou HTML vazio.
2. A tool captura o erro e retorna JSON com mensagem de falha.
3. O Agent Loop recebe a observação de erro e informa o usuário.

**Fluxo Alternativo B — Puppeteer falha na renderização:**
1. Chromium não consegue abrir ou renderizar (timeout, memória).
2. A tool captura o erro, limpa arquivos temporários e retorna JSON com erro.
3. O Agent Loop informa o usuário.

---

## 7. Requisitos Não-Funcionais

| ID | Requisito | Valor alvo | Observação |
|----|-----------|-----------|------------|
| RNF-01 | Tempo de geração total | < 30s | Inclui chamada LLM (HTML) + Puppeteer |
| RNF-02 | Consumo de RAM do Chromium | < 300MB | Documentos de até 10 páginas |
| RNF-03 | Cleanup de recursos | 100% | Browser sempre fechado no `finally`, PDFs limpos após envio |

---

## 8. Design e Interface

Nenhuma interface visual própria. O resultado é um arquivo PDF entregue via `replyWithDocument` no Telegram.

---

## 9. Modelo de Dados

Não gera tabela SQLite. Os PDFs são arquivos temporários em `./tmp/` deletados após envio.

---

## 10. Integrações e Dependências

| Dependência | Tipo | Impacto se indisponível |
|-------------|------|------------------------|
| `puppeteer` | Obrigatória | A tool retornará erro ao tentar gerar PDF. O Agent Loop informará o usuário. |
| `ILlmProvider` | Obrigatória | Sem provider, o HTML não é gerado. A tool falha com mensagem de erro. |
| `FileOutputStrategy` | Obrigatória | Sem ela, o PDF gerado não chega ao Telegram. |

---

## 11. Edge Cases e Tratamento de Erros

| Cenário | Trigger | Comportamento esperado |
|---------|---------|----------------------|
| EC-01: LLM retorna HTML malformado | Provider gera HTML incompleto sem `</html>` | Puppeteer tenta renderizar mesmo assim. Se falhar, erro é capturado e arquivo temporário é limpo. |
| EC-02: Conteúdo vazio ou inválido | Tool chamada com content="" | Retorna erro JSON imediatamente sem chamar LLM ou Puppeteer. |
| EC-03: Chromium não disponível | Puppeteer falha ao lançar browser | Catch no `renderPdf`, limpa arquivos, retorna erro ao Agent Loop. |
| EC-04: Documento muito grande | Conteúdo com 50k+ caracteres gera PDF de 100+ páginas | Timeout de 30s no Puppeteer previne travamento. O LLM deve resumir conteúdo quando necessário. |
| EC-05: Arquivo temporário não deletado | Crash entre geração e envio | Limpeza automática de `./tmp/` no próximo startup (RF-05 do PRD). |

---

## 12. Segurança e Privacidade

- O Puppeteer roda em sandbox (`--no-sandbox` para compatibilidade local, mas em ambiente single-user controlado).
- Nenhum conteúdo é enviado para servidores externos além da API do LLM (que já é uma dependência existente).
- Arquivos temporários são deletados imediatamente após envio.

---

## 13. Plano de Rollout

Deploy via registro da tool no `index.ts` e criação da skill em `.agents/skills/pdf-generator/`. Disponível imediatamente após restart do `npm run dev`.

---

## 14. Open Questions

- Avaliar se vale a pena adicionar suporte a imagens Base64 embutidas no HTML para enriquecer os PDFs gerados.
- Considerar cache do browser Puppeteer entre gerações para reduzir latência (manter uma instância aberta).
