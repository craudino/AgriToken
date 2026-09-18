// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

/// @title Subconjunto do ERC-3525 usado pelo espelho da CPR
/// @notice Declaração mínima do padrão semi-fungível. A implementação de A1
///         adere ao padrão completo; esta interface fixa apenas o que o resto
///         da plataforma consome, de modo que o contrato de fronteira seja
///         pequeno e estável.
/// @dev    Artefato congelado da Fase 0. Nenhum parâmetro admite texto livre:
///         tudo o que entra é identificador, hash ou valor (P2).
interface IERC3525 {
    /// @notice Transferência de valor entre dois tokens do mesmo slot.
    event TransferValue(uint256 indexed deTokenId, uint256 indexed paraTokenId, uint256 valor);
    /// @notice Aprovação de valor sobre um token específico.
    event ApprovalValue(uint256 indexed tokenId, address indexed operador, uint256 valor);
    /// @notice Alteração de slot de um token.
    event SlotChanged(uint256 indexed tokenId, uint256 indexed slotAnterior, uint256 indexed slotNovo);

    /// @return Casas decimais da unidade de valor do token.
    function valueDecimals() external view returns (uint8);

    /// @param tokenId Identificador do token.
    /// @return Valor (fração) detido pelo token.
    function balanceOf(uint256 tokenId) external view returns (uint256);

    /// @param tokenId Identificador do token.
    /// @return Slot ao qual o token pertence. No espelho da CPR, o slot
    ///         agrupa frações de um mesmo título registrado.
    function slotOf(uint256 tokenId) external view returns (uint256);

    /// @dev O padrão declara estas funções como payable. A rede do MVP é
    ///      permissionada e não tem moeda nativa em circulação, de modo que
    ///      qualquer msg.value seria valor preso para sempre. A implementação
    ///      de A1 DEVE reverter quando msg.value != 0, e o teste de invariante
    ///      correspondente é obrigatório em W1. Mantemos a assinatura payable
    ///      apenas para não quebrar a compatibilidade de interface do padrão.
    function approve(uint256 tokenId, address operador, uint256 valor) external payable;

    function allowance(uint256 tokenId, address operador) external view returns (uint256);

    function transferFrom(uint256 deTokenId, uint256 paraTokenId, uint256 valor) external payable;

    function transferFrom(uint256 deTokenId, address para, uint256 valor)
        external
        payable
        returns (uint256 novoTokenId);
}
