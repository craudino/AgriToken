import { createHash } from 'node:crypto';

export type Restricao =
  | 'LISTA_RESTRITIVA' | 'PEP_SEM_APROVACAO' | 'EMBARGO_AMBIENTAL'
  | 'TRABALHO_ANALOGO_ESCRAVO' | 'CAR_INVALIDO' | 'KYC_EXPIRADO';

export interface ResultadoListas {
  restricoes: Restricao[];
  listasConsultadas: string[];
  tarifaCentavos: number;
  evidenciaHash: string;
}

/**
 * Consulta às listas restritivas. No MVP as fontes são simuladas, e a
 * simulação é **determinística pelo documento** — não aleatória: um resultado
 * de KYC que muda entre execuções impede reproduzir qualquer demonstração (P6).
 *
 * As tarifas abaixo são valores de referência do simulador, não preços reais de
 * mercado; servem para instrumentar a lacuna F1 (custo de verificação por
 * produtor) com ordem de grandeza plausível, e precisam ser substituídas por
 * preço contratado antes de qualquer conclusão sobre viabilidade. [#REF]
 */
const LISTAS: Array<{ nome: string; tarifa: number; detecta: Restricao; fatia: number }> = [
  { nome: 'SANCOES_INTERNACIONAIS', tarifa: 120, detecta: 'LISTA_RESTRITIVA', fatia: 0.02 },
  { nome: 'PEP', tarifa: 80, detecta: 'PEP_SEM_APROVACAO', fatia: 0.03 },
  { nome: 'EMBARGOS_AMBIENTAIS', tarifa: 150, detecta: 'EMBARGO_AMBIENTAL', fatia: 0.04 },
  { nome: 'TRABALHO_ANALOGO_ESCRAVO', tarifa: 90, detecta: 'TRABALHO_ANALOGO_ESCRAVO', fatia: 0.01 },
];

export const consultarListas = (documento: string, forcar?: Restricao | null): ResultadoListas => {
  const digest = createHash('sha256').update(documento.replace(/\D/g, '')).digest();
  const restricoes: Restricao[] = [];
  LISTAS.forEach((lista, i) => {
    const posicao = digest[i] / 255;
    if (posicao < lista.fatia) restricoes.push(lista.detecta);
  });
  if (forcar && !restricoes.includes(forcar)) restricoes.push(forcar);

  return {
    restricoes,
    listasConsultadas: LISTAS.map((l) => l.nome),
    tarifaCentavos: LISTAS.reduce((s, l) => s + l.tarifa, 0),
    evidenciaHash: '0x' + digest.toString('hex'),
  };
};

/** Verificação de CAR no SICAR. Simulada, determinística e tarifada. */
export const verificarCar = (numeroCar: string): { valido: boolean; tarifaCentavos: number; evidenciaHash: string } => {
  const digest = createHash('sha256').update(numeroCar).digest();
  return {
    valido: /^MG-\d{7}-[0-9A-F]+$/.test(numeroCar) && digest[0] > 12,
    tarifaCentavos: 60,
    evidenciaHash: '0x' + digest.toString('hex'),
  };
};
