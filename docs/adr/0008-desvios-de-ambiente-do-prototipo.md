# ADR-0008 — Registrar os desvios de stack do protótipo antes de usá-los

- **Estado:** Aceito para a construção do protótipo
- **Data:** 2026-09-18
- **Decisores:** orquestrador; revisão de E8 em G4
- **Portão:** —

## Contexto

O ambiente de construção não dispõe de Docker. A stack do briefing (Seção 5)
pressupõe quatro validadores Besu/QBFT em Docker Compose e bases fisicamente
separadas. Construir assim mesmo, sem registrar, criaria a pior categoria de
dívida: aquela que ninguém sabe que existe até o piloto.

## Decisão

Dois desvios, **de ambiente de desenvolvimento, não de arquitetura**:

1. **Nó EVM local, em processo, no lugar de quatro validadores Besu/QBFT.** A
   camada de contrato é idêntica — mesma EVM, mesmo bytecode, mesmas ABIs
   congeladas. O que o protótipo **deixa de demonstrar**: comportamento sob
   consenso multi-nó, finalidade do QBFT, tolerância a falha bizantina, custo
   de propagação e — relevante para o ADR-0001 — a privacidade da rede, que é
   justamente o ponto em que o Besu foi descontinuado no piloto do Drex.
2. **Três bases em um cluster PostgreSQL local, em bancos e papéis distintos.**
   A separação exigida pelo ADR-0002 fica demonstrada na configuração (usuários
   distintos, sem rota entre serviços) e não na topologia. O que o protótipo
   **deixa de demonstrar**: que o comprometimento da base operacional não
   alcança o cofre de PII.

## Consequências

O protótipo prova lógica de domínio, conciliação, quórum, conformidade e
interface. Não prova operação distribuída nem isolamento físico. Qualquer
afirmação sobre esses dois pontos, em dossiê de portão ou em material para
investidor, é falsa até que o ambiente completo exista.

## Critérios de revisão

Disponibilidade de Docker ou de ambiente equivalente; ou decisão de piloto
assistido, que exige a topologia real antes de qualquer dado verdadeiro.

## Fontes

Verificação direta do ambiente desta sessão: `docker` presente como cliente,
sem daemon acessível.
