/** RFC 9457. O campo `principio_violado` torna a fronteira visível ao consumidor. */
export type Principio = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

export class ProblemaCpr extends Error {
  constructor(
    readonly status: number,
    readonly tipo: string,
    readonly titulo: string,
    readonly detalhe?: string,
    readonly principio?: Principio,
  ) {
    super(titulo);
  }

  corpo(correlacaoId?: string) {
    return {
      type: `https://cpr.digital/erros/${this.tipo}`,
      title: this.titulo,
      status: this.status,
      detail: this.detalhe,
      correlacao_id: correlacaoId,
      principio_violado: this.principio,
    };
  }
}

export const congelado = (contratoId: string) =>
  new ProblemaCpr(409, 'contrato-congelado', 'Contrato congelado por divergência de conciliação',
    `Contrato ${contratoId} tem divergência aberta; a saída exige reconciliação humana.`, 'P1');

export const semQuorum = (tipo: string, detalhe: string) =>
  new ProblemaCpr(503, 'sem-quorum', 'Quórum de oráculo não atingido',
    `Leitura de ${tipo}: ${detalhe}`, 'P4');

export const ancoraEmUso = (ancora: string) =>
  new ProblemaCpr(409, 'ancora-em-uso', 'Registro já possui espelho',
    `A âncora ${ancora} já está vinculada a um token ativo.`, 'P3');

export const naoEncontrado = (o: string) => new ProblemaCpr(404, 'nao-encontrado', `${o} não encontrado`);
export const invalido = (d: string) => new ProblemaCpr(422, 'entrada-invalida', 'Entrada inválida', d);
