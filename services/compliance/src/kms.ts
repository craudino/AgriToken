import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

/**
 * KMS local — simulação do serviço de chaves (ADR-0008).
 *
 * O ponto que importa não é o algoritmo: é que a chave **não vive no banco de
 * PII**. Se vivesse, comprometer a base entregaria dado e chave juntos, e o
 * crypto-shredding viraria teatro. Aqui a chave vive fora, e a base guarda só
 * a referência.
 *
 * Uma chave por titular. Chave compartilhada tornaria a eliminação individual
 * impossível — e a impossibilidade só apareceria no dia do pedido.
 */
export class KmsLocal {
  constructor(private readonly diretorio = process.env.KMS_DIR ?? '/var/lib/cpr-kms') {
    mkdirSync(this.diretorio, { recursive: true, mode: 0o700 });
  }

  private caminho(ref: string): string {
    return join(this.diretorio, `${ref}.chave`);
  }

  criarChave(): string {
    const ref = `kms-${randomBytes(8).toString('hex')}`;
    writeFileSync(this.caminho(ref), randomBytes(32), { mode: 0o600 });
    return ref;
  }

  private chave(ref: string): Buffer {
    const c = this.caminho(ref);
    if (!existsSync(c)) throw new Error(`chave ${ref} destruída ou inexistente`);
    return readFileSync(c);
  }

  cifrar(ref: string, claro: string): Buffer {
    const iv = randomBytes(12);
    const cifra = createCipheriv('aes-256-gcm', this.chave(ref), iv);
    const dados = Buffer.concat([cifra.update(claro, 'utf8'), cifra.final()]);
    return Buffer.concat([iv, cifra.getAuthTag(), dados]);
  }

  decifrar(ref: string, pacote: Buffer): string {
    const iv = pacote.subarray(0, 12);
    const tag = pacote.subarray(12, 28);
    const decifra = createDecipheriv('aes-256-gcm', this.chave(ref), iv);
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(pacote.subarray(28)), decifra.final()]).toString('utf8');
  }

  /**
   * Destrói a chave e devolve o comprovante. É isto que torna a eliminação
   * irreversível: o texto cifrado remanescente vira ruído, e a cadeia não
   * precisa ser tocada porque nunca soube quem era a pessoa (ADR-0002).
   */
  destruir(ref: string): string {
    const material = this.chave(ref);
    const comprovante = 'destroy-' + createHash('sha256')
      .update(ref).update(material).update(new Date().toISOString()).digest('hex').slice(0, 24);
    rmSync(this.caminho(ref), { force: true });
    return comprovante;
  }

  existe(ref: string): boolean {
    return existsSync(this.caminho(ref));
  }
}
