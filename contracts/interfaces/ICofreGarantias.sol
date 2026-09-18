// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

/// @title Cofre de garantias e waterfall de cinco níveis
/// @notice Registra vínculo, nível e estado de excussão das garantias de um
///         espelho, e simula o percurso de absorção de perda.
/// @dev    FRONTEIRA REGULATÓRIA (P7): este contrato NÃO recebe, NÃO guarda e
///         NÃO transfere valor. Não há função payable, não há receive nem
///         fallback, e nenhuma função movimenta token de terceiro. "Cofre" é
///         nome de registro de vínculos, não de custódia — a ausência de
///         custódia é verificada em CI sobre a ABI.
interface ICofreGarantias {
    enum EstadoExcussao {
        NAO_ACIONADA,
        NOTIFICADA,
        EM_EXCUSSAO,
        EXCUTIDA,
        FRUSTRADA
    }

    /// @param nivel                Posição no waterfall, de 1 a 5.
    /// @param rotuloHash           Hash do rótulo do nível (o texto vive off-chain).
    /// @param capBps               Teto de absorção do nível, em pontos-base da exposição.
    /// @param haircutBps           Deságio esperado na excussão, em pontos-base.
    /// @param prazoRecuperacaoDias Tempo estimado até caixa. Garantia lenta é garantia cara.
    struct Nivel {
        uint8 nivel;
        bytes32 rotuloHash;
        uint16 capBps;
        uint16 haircutBps;
        uint32 prazoRecuperacaoDias;
    }

    /// @param nivel     Nível que absorveu.
    /// @param absorvido Valor absorvido, na unidade do espelho.
    /// @param esgotado  Verdadeiro se o nível foi exaurido.
    struct Absorcao {
        uint8 nivel;
        uint256 absorvido;
        bool esgotado;
    }

    event PoliticaConfigurada(bytes32 indexed politicaHash, uint8 niveis, address autor);
    event GarantiaVinculada(uint256 indexed tokenId, bytes32 indexed garantiaRef, uint8 nivel, uint256 valor);
    event GarantiaLiberada(bytes32 indexed garantiaRef, bytes32 motivoHash);
    event ExcussaoRegistrada(bytes32 indexed garantiaRef, EstadoExcussao estado, uint256 recuperado, bytes32 evidenciaHash);

    error NivelInvalido(uint8 nivel);
    error GarantiaJaVinculada(bytes32 garantiaRef, uint256 tokenIdExistente);
    error PoliticaInexistente(bytes32 politicaHash);
    error EspelhoCongelado(uint256 tokenId);

    /// @notice Registra a política de waterfall vigente.
    /// @dev    A política é imutável depois de referenciada por um vínculo:
    ///         recalibrar cria nova versão, para que uma simulação antiga
    ///         permaneça reproduzível (P6).
    function configurarPolitica(bytes32 politicaHash, Nivel[] calldata niveis) external;

    /// @notice Vincula uma garantia a um espelho.
    /// @param garantiaRef Referência opaca da garantia. Nunca a matrícula em
    ///        claro, nunca o nome do bem ou do titular (P2).
    function vincularGarantia(uint256 tokenId, bytes32 garantiaRef, uint8 nivel, uint256 valor) external;

    /// @notice Libera a garantia após liquidação ou substituição.
    function liberarGarantia(bytes32 garantiaRef, bytes32 motivoHash) external;

    /// @notice Registra avanço da excussão, com evidência off-chain.
    function registrarExcussao(
        bytes32 garantiaRef,
        EstadoExcussao estado,
        uint256 recuperado,
        bytes32 evidenciaHash
    ) external;

    /// @notice Percorre os cinco níveis para uma perda hipotética.
    /// @dev    Função de visão, determinística e sem efeito colateral (P6):
    ///         o mesmo estado e a mesma perda devolvem o mesmo vetor. É o
    ///         mecanismo que permite ao comprador de risco verificar, por
    ///         conta própria, o que a plataforma afirma na simulação.
    function percorrerWaterfall(uint256 tokenId, uint256 perda)
        external
        view
        returns (Absorcao[] memory absorcoes, uint256 perdaResidual);

    function garantiasDo(uint256 tokenId) external view returns (bytes32[] memory);

    function nivelDaGarantia(bytes32 garantiaRef) external view returns (uint8);

    function estadoDaExcussao(bytes32 garantiaRef) external view returns (EstadoExcussao);

    function politicaDo(uint256 tokenId) external view returns (bytes32 politicaHash);
}
