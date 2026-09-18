// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IERC3525} from "./IERC3525.sol";
import {IAncoraRegistro} from "./IAncoraRegistro.sol";

/// @title Espelho on-chain da CPR registrada
/// @notice O token é representação, nunca fonte de verdade (P1). Não existe
///         nesta interface função que altere o título registrado, e a
///         ausência é parte do contrato: a correção desce sempre do registro
///         para o espelho.
/// @dev    Toda entrada é identificador opaco, hash ou valor numérico. Não há
///         parâmetro do tipo string em função mutante — a restrição é
///         verificada em CI sobre a ABI, porque um campo de texto livre é a
///         porta pela qual PII entra na cadeia (P2).
interface IEspelhoCPR is IERC3525, IAncoraRegistro {
    /// @notice Severidade da divergência que motivou o congelamento.
    /// @dev    Espelha ops.severidade; a ordem dos membros é contrato.
    enum Severidade {
        INFORMATIVA,
        BAIXA,
        MEDIA,
        ALTA,
        CRITICA
    }

    /// @notice Estado do espelho. Subconjunto on-chain do ciclo de vida do
    ///         domínio: a cadeia guarda o que precisa ser inegável.
    enum EstadoEspelho {
        ATIVO,
        CONGELADO,
        BAIXADO,
        EXECUTADO
    }

    event EspelhoEmitido(
        uint256 indexed tokenId,
        bytes32 indexed ancora,
        uint256 indexed slot,
        address titular,
        uint256 valor,
        bytes32 hashDocumental
    );
    event HashDocumentalAtualizado(uint256 indexed tokenId, bytes32 anterior, bytes32 novo, bytes32 origemHash);
    event EspelhoCongelado(uint256 indexed tokenId, bytes32 indexed divergenciaHash, Severidade severidade);
    event EspelhoDescongelado(uint256 indexed tokenId, bytes32 indexed reconciliacaoHash, address reconciliador);
    event EspelhoBaixado(uint256 indexed tokenId, bytes32 comprovanteBaixaHash);
    event EspelhoExecutado(uint256 indexed tokenId, bytes32 decisaoHash);

    error EspelhoCongeladoErro(uint256 tokenId);
    error EstadoInvalido(uint256 tokenId, EstadoEspelho atual, EstadoEspelho exigido);
    error TitularNaoHabilitado(address titular);
    error ValorExcedeTotal(uint256 tokenId, uint256 solicitado, uint256 disponivel);

    /// @notice Emite o espelho de um título registrado.
    /// @dev    Idempotente por âncora: a segunda chamada para a mesma âncora
    ///         reverte com AncoraJaUtilizada (P3). O titular precisa estar
    ///         habilitado no registro de participantes — a cadeia é
    ///         permissionada e o espelho não circula para desconhecidos (P7).
    /// @param ancora        keccak256 do identificador de registro.
    /// @param titular       Endereço do titular inicial, participante habilitado.
    /// @param slot          Slot do título (agrupa as frações de um mesmo título).
    /// @param valor         Total de unidades emitidas.
    /// @param hashDocumental Hash do título registrado, para detectar alteração documental.
    /// @return tokenId Identificador do token emitido.
    function emitirEspelho(
        bytes32 ancora,
        address titular,
        uint256 slot,
        uint256 valor,
        bytes32 hashDocumental
    ) external returns (uint256 tokenId);

    /// @notice Atualiza o hash documental após alteração confirmada no registro.
    /// @dev    Só o papel de espelhamento pode chamar, e apenas com evidência
    ///         do registro. Não altera termos econômicos: o espelho segue o
    ///         registro, jamais o contrário (P1).
    function atualizarHashDocumental(uint256 tokenId, bytes32 novoHash, bytes32 origemHash) external;

    /// @notice Congela o token diante de divergência de conciliação (P1).
    /// @dev    Enquanto congelado, toda transferência de valor reverte.
    function congelar(uint256 tokenId, bytes32 divergenciaHash, Severidade severidade) external;

    /// @notice Descongela após reconciliação humana registrada.
    /// @dev    Exige papel de reconciliador humano, que é multiassinatura por
    ///         política. Não existe caminho de descongelamento automático.
    function descongelar(uint256 tokenId, bytes32 reconciliacaoHash) external;

    /// @notice Baixa o espelho após liquidação e baixa no registro (F8).
    function baixar(uint256 tokenId, bytes32 comprovanteBaixaHash) external;

    /// @notice Marca o espelho como executado ao fim do percurso de garantias.
    function executar(uint256 tokenId, bytes32 decisaoHash) external;

    function estadoDo(uint256 tokenId) external view returns (EstadoEspelho);

    function estaCongelado(uint256 tokenId) external view returns (bool);

    function hashDocumentalDe(uint256 tokenId) external view returns (bytes32);

    /// @notice Soma das frações vivas de um slot.
    /// @dev    Invariante de W1: nunca excede o total emitido para o slot.
    function valorEmitidoDoSlot(uint256 slot) external view returns (uint256);

    function valorCirculanteDoSlot(uint256 slot) external view returns (uint256);
}
