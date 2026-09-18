# Esquema de dados — artefato congelado da Fase 0

Três bases **fisicamente separadas**, com credenciais, instâncias e ciclos de
backup distintos. A separação não é lógica (schemas dentro de um mesmo banco):
é física, porque o modelo de ameaça inclui comprometimento da base operacional.

| Base | Diretório | Conteúdo | Quem escreve |
|---|---|---|---|
| `cpr_ops` | `ops/` | Domínio, conciliação, oráculos, EUDR, garantias. **Zero PII.** | A2, A3, A4 |
| `cpr_pii` | `pii/` | Cofre de identificação, chaves por titular, ROPA, eliminação. | A5 (exclusivo) |
| `cpr_audit` | `audit/` | Trilha append-only encadeada por hash. | Todos, só INSERT |

## Regras estruturais

1. **Nenhuma FK atravessa bases.** A ligação entre `cpr_ops.produtor` e
   `cpr_pii.titular` existe apenas como `pii_ref uuid` opaco, resolvível
   somente por `services/compliance` mediante autorização registrada.
2. **`ref_opaca` é pseudônimo aleatório, nunca derivado de PII.** Um hash de
   CPF seria reversível por dicionário (10^11 candidatos). Ver ADR-0002.
3. **Domínio `texto_sem_pii`** rejeita, por CHECK, padrões de CPF, CNPJ e
   e-mail em todo campo textual livre de `cpr_ops`. É um controle preventivo
   verificável, não uma recomendação (P2).
4. **`cpr_audit` é append-only por construção**: `REVOKE UPDATE/DELETE` e
   gatilho que levanta exceção, mais encadeamento de hash que torna qualquer
   supressão detectável (P5).
5. **Geometria bruta vive apenas em `cpr_ops.geo`**, com papel próprio
   (`cpr_geo`) e sem exposição por API pública. On-chain circula apenas o
   hash do polígono canonicalizado (P2).

## Ordem de carga

```bash
psql "$OPS_URL"   -f ops/000_papeis_e_schemas.sql   # ... na ordem numérica
psql "$PII_URL"   -f pii/000_papeis_e_schemas.sql
psql "$AUDIT_URL" -f audit/000_papeis_e_schemas.sql
```

`infra/db/aplicar.sh` faz isso de forma idempotente e é o único caminho
suportado. Alterações neste diretório exigem solicitação de mudança de
contrato (ver `CLAUDE.md`).
