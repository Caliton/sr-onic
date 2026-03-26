# Skills Directory

Esta pasta contém as **Skills** (habilidades) do SrOnic.

## Como adicionar uma nova Skill

1. Crie uma pasta com o nome da skill (ex: `minha-skill/`)
2. Dentro da pasta, crie um arquivo `SKILL.md` com o seguinte formato:

```markdown
---
name: minha-skill
description: Descrição curta do que a skill faz
triggers:
  - /minhaskill
  - palavra-chave
---

# Instruções detalhadas da Skill

Aqui você coloca as instruções completas que o LLM deve seguir
quando esta skill for ativada...
```

## Campos do Frontmatter (YAML)

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `name` | ✅ Sim | Identificador único da skill |
| `description` | ✅ Sim | Descrição curta (usada no Router) |
| `triggers` | Opcional | Lista de comandos ou keywords para ativação rápida (fast-path) |

## Como funciona

1. **SkillLoader** lê todas as subpastas e seus `SKILL.md`
2. **SkillRouter** decide qual skill ativar (fast-path por trigger ou via LLM)
3. **SkillExecutor** injeta o conteúdo completo no prompt do Agent Loop
4. A skill é descartada após a resposta (não polui conversas futuras)

## Exemplo

```
.agents/skills/
├── duda/
│   └── SKILL.md
├── prof-lina/
│   └── SKILL.md
└── README.md
```
