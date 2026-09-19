// Reprodução isolada do achado: audit.fn_encadeia lê a ponta da cadeia sem
// travar, então dois INSERTs concorrentes leem a MESMA ponta e ambos encadeiam
// nela. A cadeia vira árvore.
import { createRequire } from 'node:module';
const { Pool } = createRequire('/home/user/AgriToken/package.json')('pg');
const pool = new Pool({ connectionString: 'postgres://cpr_audit_svc:dev_audit@127.0.0.1:5440/cpr_audit', max: 12 });

const antes = (await pool.query('SELECT count(*) n FROM audit.registro')).rows[0].n;
const inserir = (i) => pool.query(
  `INSERT INTO audit.registro (id,tipo,sujeito_tipo,sujeito_id,origem,ocorrido_em,payload)
   VALUES (gen_random_uuid(),'repro.g2','PLATAFORMA',$1,'repro@0.0.1',now(),$2)`,
  [`repro-${i}`, JSON.stringify({ i })]);

// 10 inserções SIMULTÂNEAS — é o que acontece quando o oráculo coleta várias
// fontes ou duas réplicas gravam ao mesmo tempo.
await Promise.all(Array.from({ length: 10 }, (_, i) => inserir(i)));

const r = await pool.query(`
  SELECT count(*) FILTER (WHERE NOT ok) AS reprovados FROM audit.verifica_cadeia()`);
const bif = await pool.query(`
  SELECT count(*) AS n FROM (SELECT hash_anterior FROM audit.registro
    GROUP BY hash_anterior HAVING count(*) > 1) x`);
const orf = await pool.query(`
  SELECT count(*) AS n FROM audit.registro r
   WHERE NOT EXISTS (SELECT 1 FROM audit.registro s WHERE s.hash_anterior = r.hash)`);

console.log(`registros antes: ${antes}, inseridos concorrentemente: 10`);
console.log(`verifica_cadeia() reprova:        ${r.rows[0].reprovados}`);
console.log(`pontos de bifurcação da cadeia:   ${bif.rows[0].n}`);
console.log(`registros órfãos (nada encadeia): ${orf.rows[0].n}`);
console.log('\nUm registro órfão pode ser suprimido sem quebrar elo nenhum:');
const alvo = await pool.query(`
  SELECT r.seq, r.tipo FROM audit.registro r
   WHERE NOT EXISTS (SELECT 1 FROM audit.registro s WHERE s.hash_anterior = r.hash)
     AND r.seq < (SELECT max(seq) FROM audit.registro) ORDER BY r.seq LIMIT 5`);
console.table(alvo.rows);
await pool.end();
