# Pipeline, temperature e activity timeline

## Visao geral

Funil visual de vendas com etapas customizaveis, classificacao por temperatura do lead e historico de atividades.

## Tabelas novas

### `pipeline_stages`
Etapas do funil, criadas automaticamente na primeira vez que a org acessa `/pipeline`.

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | uuid | |
| `organization_id` | text (FK) | |
| `name` | text | "Novo", "Contatado", "Qualificado"... |
| `color` | text | Hex `#RRGGBB` |
| `position` | int | Ordem da coluna |
| `is_won` | boolean | Se true, etapa final positiva |
| `is_lost` | boolean | Se true, etapa final negativa |

Seeds default (`DEFAULT_PIPELINE_STAGES` em `src/db/schema/pipeline.ts`):
1. Novo (#64748b)
2. Contatado (#0ea5e9)
3. Qualificado (#8b5cf6)
4. Proposta (#f59e0b)
5. Fechado (#10b981) `isWon`
6. Perdido (#ef4444) `isLost`

### `activities`
Timeline de interacoes por lead.

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | uuid | |
| `organization_id` | text (FK) | |
| `lead_id` | uuid (FK) | |
| `type` | enum | `note`, `call`, `email`, `meeting`, `whatsapp`, `task` |
| `title` | text | |
| `description` | text | |
| `due_at` | timestamp | opcional |
| `completed_at` | timestamp | so para `task` |
| `created_by_user_id` | text | quem criou |

### `leads` (colunas novas)

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `temperature` | enum `lead_temperature` | `cold` / `warm` / `hot` |
| `pipeline_stage_id` | uuid (FK) | Etapa atual |

`temperature` e definida automaticamente no handler `qualify.batch`:
- `score >= 70` -> `hot`
- `score >= 40` -> `warm`
- caso contrario -> `cold`

Pode ser sobrescrita manualmente via `setLeadTemperature`.

## Rotas

### `/pipeline`
Kanban drag-and-drop (`@dnd-kit/core`). Mostra leads com status `qualified` ou `needs_review`, agrupados por `pipeline_stage_id` (ou "Sem etapa").

Arrastar um card dispara `moveLeadToStage` (server action) que atualiza `leads.pipeline_stage_id`. Rollback otimista em caso de erro.

### `/leads/[id]`
Detalhe do lead:
- Cabecalho com contato (email, tel, site, LinkedIn, localizacao)
- Badge de temperatura e status
- Coluna direita: select de etapa, fonte, campanha, justificativa da qualificacao
- Coluna principal: formulario para criar atividade + timeline

### Server actions (`src/app/(app)/pipeline/actions.ts`)

```ts
moveLeadToStage({ leadId, stageId })
setLeadTemperature({ leadId, temperature })
createActivity({ leadId, type, title, description, dueAt })
toggleActivityComplete({ activityId, leadId })
createPipelineStage({ name, color, position })
deletePipelineStage({ stageId })
```

## Componentes

- `src/components/temperature-badge.tsx` - badge colorida (cold/warm/hot)
- `src/components/pipeline/kanban-board.tsx` - Kanban com DnD
- `src/components/pipeline/activity-timeline.tsx` - form + lista

## Migration

`drizzle/0008_pipeline_and_activities.sql`:
- Cria enums `lead_temperature` e `activity_type`
- Cria tabelas `pipeline_stages` e `activities`
- Adiciona colunas `temperature` e `pipeline_stage_id` em `leads`
- Cria FK `leads.pipeline_stage_id -> pipeline_stages.id` (on delete set null)
- Cria indices apropriados
