# Spec: Agent Loop (Reasoning Engine)

**Versão:** 1.0
**Status:** Aprovada
**Autor:** SrOnic Agent
**Data:** 2026-03-06

---

## 1. Resumo

O **Agent Loop** é a engrenagem central do SrOnic. Ele implementa o padrão ReAct (Reasoning and Acting). É o módulo onde uma ação bruta entra, é submetida ao LLM base (Thought), uma ou mais ferramentas são chamadas (Action+Observation), até um veredito de resposta final ser chegado, repetindo em loop limitado de iterações para evitar impasses de contexto infinito.

---

## 2. Contexto e Motivação

**Problema:**
Um LLM standard responde de forma estática do ponto de vista do seu conhecimento congelado. Para que ele vire um Agente, é preciso que ele receba e aja recursivamente no ambiente que está imersivo a ele.

**Evidências:**
Tentar fazer uma "Mega Prompt" para que ele decida e gere arquivo num take só quase sempre gera inferências sujas e falsas promessas de execução (alucinadas). Ele deve executar uma ferramental real via Loop e aguardar o resultado para só então inferir o fecho.

**Por que agora:**
Precisamos desacoplar a parte de grammy/entrada de dados da parte de processamento puramente sistêmico (Tool calls/Registry).

---

## 3. Goals (Objetivos)

- [ ] G-01: Rodar uma iteração abstrata e agnóstica onde um `LLM` possa fornecer ou uma resposta final legível, ou um Tool Call bem estruturado.
- [ ] G-02: Executar automaticamente o call pelo Factory de tools e repassar a observação como se fosse o usuário (`ToolOutput`) no proximo payload pro LLM.
- [ ] G-03: Parar de forma determinística por um hard limit configurável (ex: 5 interações no MAX_ITERATIONS).

**Métricas de sucesso:**
| Métrica | Baseline atual | Target | Prazo |
|---------|---------------|--------|-------|
| Completude (Success Rate de ReAct loops) | N/A | 95% encerram antes do teto | Em prod |
| Hard limit triggers | Sem limite | Estoura limpo (Throw Error) nas iterações superadas (>MAX) | Imediato |

---

## 4. Non-Goals (Fora do Escopo)

- NG-01: Manter sessões abertas suspensas aguardando input do usuário no MEIO de um loop de Agent Loop ativo.
- NG-02: Executar Tools de forma paralela usando workers (as tool calls serão tratadas resolutivamente em cascata Promise-based Node sequencial no escopo da mesma iteração ReAct).

---

## 5. Usuários e Personas

**Módulo Cliente Primário:** Classes dentro de `TelegramBot` ou `SkillExecutor` que invocam o AgentLoop repassando o array de mensagens antigas e o System Prompt correspondente às ferramentas em registro ativo.

---

## 6. Requisitos Funcionais

### 6.1 Requisitos Principais

| ID | Requisito | Prioridade | Critério de Aceite |
|----|-----------|-----------|-------------------|
| RF-01 | O sistema deve suportar iterar sobre a classe `BaseTool` herdada para todas as features disponíveis usando o pattern Registry. | Must | Se as Tools não responderam JSON schema, falha ou pede pro LLM de novo. |
| RF-02 | O Agent Loop deve sempre instanciar uma iteração limitadora e parar a execução quando `current > MAX_ITERATIONS` for verificado. | Must | Uma chamada maliciosa não gera billing infinito. |
| RF-03 | A Observação do ambiente gerada por uma base de Tool (`result.output`) deve sempre retornar pro array de mensagens para a próxima dedução (Thought). | Must | LLM não deve se perder; e não pode pre-anunciar execução. |
| RF-04 | O Agent Loop deve registrar logs detalhados de cada etapa (Thought, Action, Observation) no console para monitoramento. | Must | O desenvolvedor deve conseguir acompanhar o raciocínio do agente em tempo real. |
| RF-05 | O Agent Loop deve suportar fallback automático de LLM — se o provider primário retornar erro (503/429/timeout), o loop deve tentar o próximo provider configurado no `ProviderFactory` sem consumir uma iteração do `MAX_ITERATIONS`. | Must | Um erro de provider não esgota iterações. Fallback é transparente e logado. Se todos os providers falharem, o loop encerra com mensagem de erro ao usuário. |
| RF-06 | Mensagens recebidas durante um loop ativo devem ser enfileiradas (FIFO) e processadas sequencialmente, evitando concorrência de contexto na mesma conversa. | Must | Duas mensagens rápidas não geram dois loops paralelos. A segunda aguarda o encerramento do primeiro antes de iniciar. |

### 6.2 Fluxo Principal (Happy Path)

1. Entrada invoca o método principal: `AgentLoop.run()`.
2. Appends de mensagens recentes do array formatado do banco para compilar com prompts das tools em `SystemPrompt`.
3. LLM infere no array atual e decide a chamada `ToolChoice`.
4. Uma skill retorna um tool call exigendo usar "criar_arquivo".
5. Iterator detecta chamada, Factory instancia e preenche com Args do JSON.
6. A Promise da Tool retorna "Arquivo Foo feito!".
7. Injeta resultado na variável observation array. Retorna ao (3) que gera a final response "Usuário, arquivo Foo foi construído!".

### 6.3 Fluxos Alternativos

**Fluxo Alternativo A — Max Iterations Reached:**
1. A IA acha que falta informação ou repete tool call incorreto seguidamente.
2. Contagem do loop alcança o `process.env.MAX_ITERATIONS` (5).
3. O Loop injeta break forçado.
4. Output final vira: "Desculpe, desisti ou deu timeout no processamento pois falhei nas chamadas em MAX iteracoes."

**Fluxo Alternativo B — Provider Primário Falha:**
1. O provider configurado (ex: Gemini) retorna erro 503/429/timeout.
2. O Agent Loop loga o erro e consulta o `ProviderFactory` para o próximo provider disponível na lista de fallback.
3. A iteração é refeita com o provider secundário (ex: DeepSeek) sem incrementar o contador de iterações.
4. Se todos os providers falharem, o loop encerra e envia ao usuário: "⚠️ Nenhum provedor de IA disponível no momento. Tente novamente em alguns minutos."

---

## 7. Requisitos Não-Funcionais

| ID | Requisito | Valor alvo | Observação |
|----|-----------|-----------|------------|
| RNF-01 | Timeout por interação unitária LLM | < 120s | Pra evitar socket hang do Node |
| RNF-02 | Timeout global do pipeline completo | Configurável (padrão: 300s) | Se o ciclo completo (router + loop × N + output) exceder o limite, abortar graciosamente e notificar o usuário com mensagem de timeout. |
| RNF-03 | Refresh de `sendChatAction('typing')` | A cada 4 segundos | Reenvio periódico durante o processamento para que o indicador de digitação no Telegram não expire (a action expira após ~5s sem refresh). |

---

## 8. Design e Interface

**Componentes afetados:** Terminal log-output, Repasse assíncrono pro Output de chat.
Interno apenas.

---

## 9. Modelo de Dados

Não gera tabelas SQL exclusivas, é stateful em RAM contendo arrays literais durante as interações. No fim, a resposta é entregue para salvar via MemoryManager.

---

## 10. Integrações e Dependências

| Dependência | Tipo | Impacto se indisponível |
|-------------|------|------------------------|
| ILlmProvider implementations | Obrigatória | Loop principal é interrompido. |
| ToolRegistry instanciado | Obrigatória | System prompt ficara vazio / não enxerga braços atuadores. |

---

## 11. Edge Cases e Tratamento de Erros

| Cenário | Trigger | Comportamento esperado |
|---------|---------|----------------------|
| EC-01: JSON Malformado de Argumento da IA | O LLM burla a formatação e entrega string malfeita em vez do schema no ToolCall | Catch no loop e gera Observation pro LLM dizendo: "JSON inválido, reenvie a estrutura corrigida por favor." |
| EC-02: Ferramenta retorna Throw (Error hard) | Tentou criar num path que não existe na máquina host do Node (`fs.writeFileSync` failure). | O catch manda: `{"error": "ENOENT path not exists..."}` como string de observação devolta pra IA corrigir caminho. |
| EC-03: Max Iteration Limits | Variável de MAX não foi lida do env (null). | Definir fallback pra 5 explicitamente pra não corromper infra. |
| EC-04: Provider primário indisponível | API do Gemini retorna 503 ou timeout de conexão. | O loop tenta fallback via `ProviderFactory` para o provider secundário configurado sem consumir iteração. Se todos falharem, encerra com mensagem de erro. |
| EC-05: Pipeline excede timeout global | Processamento total (router + N iterações + tools) ultrapassa `PIPELINE_TIMEOUT_MS`. | O loop é abortado via `AbortController`/timer. O usuário recebe: "⚠️ Processamento excedeu o tempo limite. Tente simplificar a solicitação." O estado parcial é descartado. |

---

## 12. Segurança e Privacidade

- As Tools são injetadas em prompt - nunca expõe secrets nem paths internos completos que dão base para jailbreak explícito sem sanilização (a Tool deve usar regex no parsing dos envios).

---

## 13. Plano de Rollout

- Big Bang via git push na branch core e deploy manual em dev.

---

## 14. Open Questions

N/A
