import { TipoDivergencia } from '@cpr/nucleo';

export interface Titulo {
  entidade: string;
  registro_id: string;
  estado: 'VIGENTE' | 'BAIXADO' | 'CANCELADO' | 'PROTESTADO' | 'BLOQUEADO_JUDICIALMENTE';
  titular_ref: string;
  emitente_ref: string;
  commodity: string;
  quantidade: string;
  valor_face: { valor: string; moeda: 'BRL' };
  vencimento: string;
  garantias: Array<{ tipo: string; referencia: string; valor: { valor: string; moeda: 'BRL' } }>;
  onus: Array<{ tipo: string; averbado_em: string; referencia: string }>;
  cessoes: Array<{ cessionario_ref: string; registrada_em: string }>;
  conteudo_hash: string;
  atualizado_em: string;
}

/**
 * Onde cada tipo de divergência é injetado. Distinguir os dois lados importa:
 * injetar no registro testa se o sistema **observa** a fonte de verdade;
 * injetar no token testa se ele observa o próprio espelho. Um sistema que só
 * olha para um lado é cego para metade das divergências — foi o achado A1 de E1
 * em G1.
 */
export const LADO: Record<TipoDivergencia, 'REGISTRO' | 'TOKEN' | 'AMBOS'> = {
  TITULO_BAIXADO_NO_REGISTRO: 'REGISTRO',
  CESSAO_NAO_REFLETIDA: 'REGISTRO',
  VALOR_FACE_ALTERADO: 'REGISTRO',
  QUANTIDADE_ALTERADA: 'REGISTRO',
  VENCIMENTO_ALTERADO: 'REGISTRO',
  GARANTIA_ALTERADA: 'REGISTRO',
  ONUS_OU_GRAVAME_NAO_REFLETIDO: 'REGISTRO',
  TITULO_INEXISTENTE_NO_REGISTRO: 'REGISTRO',
  TOKEN_AUSENTE_PARA_REGISTRO: 'REGISTRO',
  HASH_DOCUMENTAL_DIVERGENTE: 'REGISTRO',
  ESTADO_DIVERGENTE: 'REGISTRO',
  DUPLICIDADE_DE_ANCORA: 'TOKEN',
  TRANSFERENCIA_SEM_CESSAO: 'TOKEN',
  FRACIONAMENTO_NAO_REFLETIDO: 'TOKEN',
};

/** Aplica a injeção sobre o título registrado. Devolve null quando o efeito é remoção. */
export const aplicar = (
  t: Titulo,
  tipo: TipoDivergencia,
  parametros: Record<string, unknown> = {},
): Titulo | null => {
  const agora = new Date().toISOString();
  const copia: Titulo = JSON.parse(JSON.stringify(t));
  copia.atualizado_em = agora;

  switch (tipo) {
    case 'TITULO_BAIXADO_NO_REGISTRO':
      copia.estado = 'BAIXADO';
      return copia;
    case 'CESSAO_NAO_REFLETIDA':
      copia.cessoes.push({
        cessionario_ref: (parametros.cessionario_ref as string) ?? 'f'.repeat(32),
        registrada_em: agora,
      });
      copia.titular_ref = (parametros.cessionario_ref as string) ?? 'f'.repeat(32);
      return copia;
    case 'VALOR_FACE_ALTERADO':
      copia.valor_face = { valor: (parametros.valor as string) ?? '700000.00', moeda: 'BRL' };
      return copia;
    case 'QUANTIDADE_ALTERADA':
      copia.quantidade = (parametros.quantidade as string) ?? '450.0000';
      return copia;
    case 'VENCIMENTO_ALTERADO':
      copia.vencimento = (parametros.vencimento as string) ?? '2027-09-30';
      return copia;
    case 'GARANTIA_ALTERADA':
      copia.garantias = copia.garantias.slice(0, Math.max(0, copia.garantias.length - 1));
      return copia;
    case 'ONUS_OU_GRAVAME_NAO_REFLETIDO':
      copia.onus.push({
        tipo: (parametros.tipo_onus as string) ?? 'PENHORA',
        averbado_em: agora.slice(0, 10),
        referencia: (parametros.referencia as string) ?? 'PROC-0001',
      });
      return copia;
    case 'HASH_DOCUMENTAL_DIVERGENTE':
      copia.conteudo_hash = (parametros.hash as string) ?? '0x' + 'de'.repeat(32);
      return copia;
    case 'ESTADO_DIVERGENTE':
      copia.estado = (parametros.estado as Titulo['estado']) ?? 'BLOQUEADO_JUDICIALMENTE';
      return copia;
    case 'TITULO_INEXISTENTE_NO_REGISTRO':
      return null;                       // o registro deixa de conhecer o título
    case 'TOKEN_AUSENTE_PARA_REGISTRO':
      return copia;                      // título novo, criado sem espelho
    default:
      // Divergências do lado do token não se injetam aqui. O simulador não
      // finge tê-las aplicado: quem as executa é o roteiro, na cadeia.
      return copia;
  }
};
