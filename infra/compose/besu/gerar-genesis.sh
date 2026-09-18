#!/usr/bin/env bash
# Gera a genesis QBFT e as chaves dos quatro validadores.
#
# As chaves NÃO são versionadas: chave de validador no repositório é chave
# comprometida. Rode isto uma vez por ambiente e guarde o resultado no cofre de
# segredos do ambiente, nunca aqui.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGEM="${IMAGEM_BESU:-hyperledger/besu:24.12.2}"

if [[ -d "$AQUI/rede" ]]; then
  echo "rede já gerada em $AQUI/rede — apague antes de gerar de novo" >&2
  exit 1
fi

docker run --rm -v "$AQUI:/cfg" "$IMAGEM" \
  operator generate-blockchain-config \
  --config-file=/cfg/qbft-config.json \
  --to=/cfg/rede-bruta \
  --private-key-file-name=chave

# O gerador cria um diretório por endereço; renomeamos para validador-N, que é
# o que o compose monta.
i=1
for dir in "$AQUI"/rede-bruta/keys/*/; do
  destino="$AQUI/rede/validador-$i"
  mkdir -p "$destino"
  cp "$dir/chave" "$destino/chave"
  cp "$dir/chave.pub" "$destino/chave.pub"
  cp "$AQUI/rede-bruta/genesis.json" "$destino/genesis.json"
  i=$((i + 1))
done
rm -rf "$AQUI/rede-bruta"

echo "rede gerada em $AQUI/rede"
echo
echo "Exporte o bootnode antes de subir o compose:"
echo "  export BOOTNODE=enode://\$(cat $AQUI/rede/validador-1/chave.pub | sed 's/^0x//')@besu-1:30303"
