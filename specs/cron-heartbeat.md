# Spec: Cron Scheduler & Heartbeat Service

**Versão:** 1.0
**Status:** Aprovada
**Autor:** Antigravity (IA)
**Data:** 2026-03-25

---

## 1. Resumo

O sistema de Cron e Heartbeat adiciona duas capacidades fundamentais ao SrOnic: **(1) tarefas agendadas** que rodam automaticamente em horários definidos, e **(2) monitoramento contínuo de saúde** com alertas pro-ativos. Ambos os sistemas são extensíveis — cada skill pode definir seus próprios crons via frontmatter YAML, e agentes futuros podem registrar watchers customizados no heartbeat (ex: monitorar emails, agenda, APIs).

---

## 2. Contexto e Motivação

**Problema:**
O SrOnic é reativo — só age quando recebe uma mensagem do Telegram. Não existe forma de executar ações automaticamente (relatórios diários, lembretes) nem de monitorar a saúde do sistema em runtime.

**Evidências:**
Para um agente rodando em servidor 24/7, é essencial saber se o polling morreu, se o DB corrompeu, ou se a RAM estourou — sem depender do usuário perceber que algo parou de funcionar.

**Por que agora:**
A migração para servidor Linux torna o monitoramento automático obrigatório. E a capacidade de cron por skill abre a porta para proatividade do agente.

---

## 3. Goals (Objetivos)

- [ ] G-01: Prover um `CronScheduler` que executa tarefas agendadas via expressões cron (sistema + por skill).
- [ ] G-02: Cada skill pode definir `cron` no frontmatter YAML do `SKILL.md` com schedule + action.
- [ ] G-03: Jobs do sistema (cleanup tmp, backup DB) rodam automaticamente sem configuração do usuário.
- [ ] G-04: Prover um `HeartbeatService` extensível com padrão Watcher para monitoramento contínuo.
- [ ] G-05: Watchers customizados podem ser registrados por skills/agentes futuros (email, agenda, APIs).
- [ ] G-06: Alertas são enviados via Telegram com rate-limiting (evita spam).

**Métricas de sucesso:**
| Métrica | Baseline atual | Target | Prazo |
|---------|---------------|--------|-------|
| Uptime awareness | 0% (sem monitoramento) | Alerta em < 5 min após falha | MVP |
| Auto-recovery de cron após restart | N/A | 100% jobs re-registrados automaticamente | MVP |

---

## 4. Non-Goals (Fora do Escopo)

- NG-01: Interface visual de gerenciamento de crons (apenas comando `/crons` no Telegram).
- NG-02: Persistência de estado de crons no SQLite (jobs são re-registrados do frontmatter a cada startup).
- NG-03: Execução distribuída de crons (single-instance Node.js).

---

## 5. Usuários e Personas

**Módulo Cliente do CronScheduler:** O frontmatter YAML das skills e o bootstrap do sistema.
**Módulo Cliente do HeartbeatService:** Qualquer skill/agente que queira registrar um watcher customizado.

---

## 6. Requisitos Funcionais

### 6.1 Requisitos Principais

| ID | Requisito | Prioridade | Critério de Aceite |
|----|-----------|-----------|-------------------|
| RF-01 | O `CronScheduler` deve registrar e executar jobs do sistema (cleanup tmp a cada 6h, backup DB às 3h). | Must | Jobs disparam no horário correto e são visíveis via `/crons`. |
| RF-02 | O `CronScheduler` deve ler o campo `cron` do frontmatter de cada skill e registrar os jobs correspondentes. | Must | Skill com `cron: [{schedule: "*/5 * * * *", action: "teste"}]` dispara a cada 5 minutos. |
| RF-03 | Jobs de skill disparam simulando uma mensagem do owner para o `AgentController`. | Must | A mensagem é processada pelo pipeline completo (router → skill → loop → output). |
| RF-04 | O `HeartbeatService` deve verificar DB, providers LLM e uso de RAM periodicamente. | Must | Falha em qualquer check dispara alerta no Telegram do owner. |
| RF-05 | O `HeartbeatService` deve suportar registro de watchers customizados com interface `HeartbeatWatcher`. | Must | Chamada `heartbeat.registerWatcher({...})` adiciona nova verificação ao loop. |
| RF-06 | Alertas devem ter rate-limiting (15 min cooldown por tipo). | Must | Mesmo que o DB fique inacessível, só 1 alerta a cada 15 min é enviado. |
| RF-07 | O comando `/crons` deve listar todos os jobs ativos com fonte, descrição e schedule. | Should | Resposta mostra lista formatada no chat. |

### 6.2 Fluxo Principal — Cron Job de Skill

1. Skill `pdf-generator` define `cron: [{schedule: "0 9 * * 1-5", action: "Gera relatório diário"}]`.
2. No startup, `CronScheduler.registerSkillCrons()` lê e registra o job.
3. Seg-Sex às 9h, o job dispara e chama o `messageHandler`.
4. O handler simula a mensagem do owner → AgentController processa → bot responde no Telegram.

---

## 7. Requisitos Não-Funcionais

| ID | Requisito | Valor alvo | Observação |
|----|-----------|-----------|------------|
| RNF-01 | Intervalo do heartbeat | Configurável (padrão: 5 min) | Via `HEARTBEAT_INTERVAL_MS` |
| RNF-02 | Overhead do scheduler | Desprezível | `node-cron` usa timers nativos do Node.js, sem polling |

---

## 8. Design e Interface

Comando `/crons` no Telegram lista os jobs ativos. Alertas do heartbeat chegam como mensagens diretas ao owner.

---

## 9. Modelo de Dados

Não gera tabelas SQLite. Crons são definidos em frontmatter YAML e re-registrados a cada startup.

**Extensão do frontmatter do `SKILL.md`:**
```yaml
cron:
  - schedule: "0 9 * * 1-5"
    action: "Texto que será processado como mensagem do usuário"
    description: "Descrição legível"
```

---

## 10. Integrações e Dependências

| Dependência | Tipo | Impacto se indisponível |
|-------------|------|------------------------|
| `node-cron` | Obrigatória | Scheduler não funciona. Sistema opera normalmente sem crons. |
| `AgentController` | Obrigatória | Crons de skill não disparam mensagens. |
| `Telegram Bot API` | Obrigatória | Alertas de heartbeat não são enviados (apenas logados). |

---

## 11. Edge Cases e Tratamento de Erros

| Cenário | Trigger | Comportamento esperado |
|---------|---------|----------------------|
| EC-01: Expressão cron inválida | Skill define `schedule: "invalid"` | `cron.validate()` retorna false, job é ignorado com warning no log. |
| EC-02: Cron job falha na execução | AgentController lança exceção durante processamento | Erro capturado no catch, logado, jobs seguintes não são afetados. |
| EC-03: Múltiplos heartbeat alerts simultâneos | DB e LLM falham ao mesmo tempo | Cada watcher é verificado independentemente, rate-limit é por tipo. |
| EC-04: Scheduler desabilitado | `SCHEDULER_ENABLED=false` no .env | Nenhum cron é iniciado. Heartbeat continua funcionando. |

---

## 12. Segurança e Privacidade

- Crons de skill executam no contexto do owner (primeiro ID da whitelist). Nenhum acesso externo é criado.
- Alertas contêm apenas informações técnicas (uso de RAM, status de provider), sem dados do usuário.

---

## 13. Plano de Rollout

Disponível após restart do `npm run dev`. Scheduler e heartbeat são iniciados automaticamente no bootstrap.

---

## 14. Open Questions

- Avaliar se crons de skill deveriam ter a opção de ser desabilitados individualmente via comando no chat.
- Considerar persistência de execuções de cron (log de "última execução") para debug.
