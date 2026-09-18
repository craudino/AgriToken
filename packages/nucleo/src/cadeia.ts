import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, sha256 } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cliente da cadeia. Carrega ABIs e endereços produzidos por A1 — contrato de
 * fronteira entre os dois agentes, e o núcleo não conhece o código do contrato,
 * só a ABI congelada.
 */
const RAIZ = process.env.CPR_RAIZ ?? join(__dirname, '../../..');
const abi = (nome: string) =>
  JSON.parse(readFileSync(join(RAIZ, `artifacts/out/contracts/src/${nome}.sol/${nome}.json`), 'utf8')).abi;

export interface Enderecos {
  chainId: number;
  enderecos: Record<string, string>;
  contas: Record<string, string>;
  timelock_segundos: number;
}

export class Cadeia {
  readonly provider: JsonRpcProvider;
  readonly cfg: Enderecos;
  private readonly carteiras: Record<string, Wallet> = {};

  constructor() {
    const caminho = join(RAIZ, 'infra/enderecos.json');
    if (!existsSync(caminho)) throw new Error('infra/enderecos.json ausente: implante os contratos');
    this.cfg = JSON.parse(readFileSync(caminho, 'utf8'));
    this.provider = new JsonRpcProvider(process.env.RPC_URL ?? 'http://127.0.0.1:8545');
    // Chaves determinísticas do nó de desenvolvimento. Em produção, HSM.
    const chaves = [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    ];
    const papeis = ['admin', 'espelhador', 'conciliador', 'reconciliador', 'compliance'];
    papeis.forEach((p, i) => { this.carteiras[p] = new Wallet(chaves[i], this.provider); });
  }

  contrato(nome: keyof Enderecos['enderecos'] & string, arquivo: string, papel = 'admin'): Contract {
    return new Contract(this.cfg.enderecos[nome], abi(arquivo), this.carteiras[papel]);
  }

  espelho(papel = 'espelhador') { return this.contrato('espelhoCPR', 'EspelhoCPR', papel); }
  cofre(papel = 'compliance') { return this.contrato('cofreGarantias', 'CofreGarantias', papel); }
  participantes(papel = 'compliance') { return this.contrato('registroParticipantes', 'RegistroParticipantes', papel); }

  endereco(papel: string): string { return this.carteiras[papel].address; }
  enderecoCredor(n: 1 | 2): string { return this.cfg.contas[`credor${n}`]; }
}

/** Âncora: keccak não, sha256 — a mesma fórmula do núcleo e do banco (P6). */
export const ancoraDe = (entidade: string, registroId: string): string =>
  sha256(toUtf8Bytes(`${entidade}|${registroId}`));

export const hashDe = (s: string): string => sha256(toUtf8Bytes(s));
export const papel = (n: string): string => keccak256(toUtf8Bytes(n));
