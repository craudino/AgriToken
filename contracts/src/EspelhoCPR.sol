// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IEspelhoCPR} from "../interfaces/IEspelhoCPR.sol";
import {ControleAcesso} from "./ControleAcesso.sol";
import {RegistroParticipantes} from "./RegistroParticipantes.sol";
import {AncoraRegistro} from "./AncoraRegistro.sol";

/// @title Espelho on-chain da CPR registrada
/// @notice O token é representação, nunca fonte de verdade (P1). Não existe
///         aqui função que altere o título registrado — a ausência é parte do
///         contrato, não esquecimento.
/// @dev    Atualizável por UUPS com timelock (ADR-0004). A âncora, não: vive em
///         contrato imutável e separado, porque a unicidade do colateral não
///         pode depender de quem controla o proxy.
contract EspelhoCPR is IEspelhoCPR {
    /// @dev Slot ERC-1967 da implementação.
    bytes32 private constant _SLOT_IMPL = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    uint8 private constant _DECIMAIS = 4;

    ControleAcesso private _acesso;
    RegistroParticipantes private _participantes;
    AncoraRegistro private _ancora;
    bool private _inicializado;
    bool private _pausado;

    uint256 private _proximoToken;
    mapping(uint256 => address) private _proprietario;
    mapping(uint256 => uint256) private _slot;
    mapping(uint256 => uint256) private _saldo;
    mapping(uint256 => EstadoEspelho) private _estado;
    mapping(uint256 => bytes32) private _hashDocumental;
    mapping(uint256 => mapping(address => uint256)) private _permissao;
    mapping(uint256 => uint256) private _emitidoDoSlot;
    mapping(uint256 => uint256) private _circulanteDoSlot;
    mapping(address => uint256) private _propostaAtualizacao;

    /// @dev Espaço reservado para variáveis futuras sem colidir com o storage
    ///      de quem já está em produção — armadilha clássica do UUPS.
    uint256[40] private __vazio;

    /// @notice Titularidade mudou on-chain. A conciliação usa este evento para
    ///         detectar TRANSFERENCIA_SEM_CESSAO e FRACIONAMENTO_NAO_REFLETIDO
    ///         (SMC-004): sem ele, a fração circularia fora do registro e o
    ///         sistema seria cego a isso.
    event TitularidadeAlterada(
        uint256 indexed tokenId, address indexed de, address indexed para, uint256 valor, uint256 novoTokenId
    );
    event AtualizacaoProposta(address indexed nova, uint256 executavelEm);
    event AtualizacaoExecutada(address indexed nova);
    event Pausado(bool pausado, address autor);

    error ValorNaoAceito();
    error JaInicializado();
    error Pausa();

    /// @dev Toda função payable herdada do ERC-3525 recusa valor. A rede não
    ///      tem moeda nativa em circulação; ether enviado aqui seria valor
    ///      preso para sempre (invariante I6).
    modifier semValor() {
        if (msg.value != 0) revert ValorNaoAceito();
        _;
    }

    modifier ativo() {
        if (_pausado) revert Pausa();
        _;
    }

    function inicializar(
        ControleAcesso acesso,
        RegistroParticipantes participantes,
        AncoraRegistro ancora
    ) external {
        if (_inicializado) revert JaInicializado();
        _inicializado = true;
        _acesso = acesso;
        _participantes = participantes;
        _ancora = ancora;
        _proximoToken = 1;
    }

    // ---------------------------------------------------------------- emissão
    function emitirEspelho(
        bytes32 ancora_,
        address titular,
        uint256 slot_,
        uint256 valor,
        bytes32 hashDocumental_
    ) external ativo returns (uint256 tokenId) {
        _acesso.exigirPapel(_acesso.PAPEL_ESPELHADOR(), msg.sender);
        if (!_participantes.estaHabilitado(titular)) revert TitularNaoHabilitado(titular);
        require(valor > 0, "valor zero");

        tokenId = _proximoToken++;
        // A âncora reverte se já estiver em uso. A ordem importa: vincular
        // antes de escrever estado deixa a emissão atômica em P3.
        _ancora.vincular(ancora_, tokenId);

        _proprietario[tokenId] = titular;
        _slot[tokenId] = slot_;
        _saldo[tokenId] = valor;
        _estado[tokenId] = EstadoEspelho.ATIVO;
        _hashDocumental[tokenId] = hashDocumental_;
        _emitidoDoSlot[slot_] += valor;
        _circulanteDoSlot[slot_] += valor;

        emit EspelhoEmitido(tokenId, ancora_, slot_, titular, valor, hashDocumental_);
    }

    function atualizarHashDocumental(uint256 tokenId, bytes32 novoHash, bytes32 origemHash) external ativo {
        _acesso.exigirPapel(_acesso.PAPEL_ESPELHADOR(), msg.sender);
        _exigirEstado(tokenId, EstadoEspelho.ATIVO);
        bytes32 anterior = _hashDocumental[tokenId];
        _hashDocumental[tokenId] = novoHash;
        // Não move valor, não altera slot, não altera titular: o espelho segue
        // o registro, jamais o contrário (P1).
        emit HashDocumentalAtualizado(tokenId, anterior, novoHash, origemHash);
    }

    // ----------------------------------------------------------- congelamento
    function congelar(uint256 tokenId, bytes32 divergenciaHash, Severidade severidade) external {
        _acesso.exigirPapel(_acesso.PAPEL_CONCILIADOR(), msg.sender);
        _exigirEstado(tokenId, EstadoEspelho.ATIVO);
        _estado[tokenId] = EstadoEspelho.CONGELADO;
        emit EspelhoCongelado(tokenId, divergenciaHash, severidade);
    }

    /// @dev Só o papel humano de reconciliação descongela. Nenhuma chave de
    ///      serviço o detém, e não há caminho automático (P1, ADR-0007).
    function descongelar(uint256 tokenId, bytes32 reconciliacaoHash) external {
        _acesso.exigirPapel(_acesso.PAPEL_RECONCILIADOR_HUMANO(), msg.sender);
        _exigirEstado(tokenId, EstadoEspelho.CONGELADO);
        _estado[tokenId] = EstadoEspelho.ATIVO;
        emit EspelhoDescongelado(tokenId, reconciliacaoHash, msg.sender);
    }

    function baixar(uint256 tokenId, bytes32 comprovanteBaixaHash) external ativo {
        _acesso.exigirPapel(_acesso.PAPEL_ESPELHADOR(), msg.sender);
        _exigirEstado(tokenId, EstadoEspelho.ATIVO);
        _estado[tokenId] = EstadoEspelho.BAIXADO;
        _circulanteDoSlot[_slot[tokenId]] -= _saldo[tokenId];
        _saldo[tokenId] = 0;
        _ancora.baixar(_ancora.ancoraDoToken(tokenId), comprovanteBaixaHash);
        emit EspelhoBaixado(tokenId, comprovanteBaixaHash);
    }

    function executar(uint256 tokenId, bytes32 decisaoHash) external ativo {
        _acesso.exigirPapel(_acesso.PAPEL_CONCILIADOR(), msg.sender);
        require(
            _estado[tokenId] == EstadoEspelho.ATIVO || _estado[tokenId] == EstadoEspelho.CONGELADO,
            "estado nao permite execucao"
        );
        _estado[tokenId] = EstadoEspelho.EXECUTADO;
        emit EspelhoExecutado(tokenId, decisaoHash);
    }

    // ------------------------------------------------------------- ERC-3525
    function valueDecimals() external pure returns (uint8) { return _DECIMAIS; }
    function balanceOf(uint256 tokenId) external view returns (uint256) { return _saldo[tokenId]; }
    function slotOf(uint256 tokenId) external view returns (uint256) { return _slot[tokenId]; }
    function allowance(uint256 tokenId, address operador) external view returns (uint256) {
        return _permissao[tokenId][operador];
    }

    function approve(uint256 tokenId, address operador, uint256 valor) external payable semValor ativo {
        require(msg.sender == _proprietario[tokenId], "somente o titular aprova");
        _exigirNaoCongelado(tokenId);
        _permissao[tokenId][operador] = valor;
        emit ApprovalValue(tokenId, operador, valor);
    }

    /// @notice Transfere valor entre dois tokens do mesmo slot.
    function transferFrom(uint256 deTokenId, uint256 paraTokenId, uint256 valor)
        external payable semValor ativo
    {
        require(_slot[deTokenId] == _slot[paraTokenId], "slots distintos");
        _consumirPermissao(deTokenId, valor);
        _exigirNaoCongelado(deTokenId);
        _exigirNaoCongelado(paraTokenId);
        _participantes.exigirHabilitado(_proprietario[paraTokenId]);
        if (_saldo[deTokenId] < valor) revert ValorExcedeTotal(deTokenId, valor, _saldo[deTokenId]);

        _saldo[deTokenId] -= valor;
        _saldo[paraTokenId] += valor;
        emit TransferValue(deTokenId, paraTokenId, valor);
        emit TitularidadeAlterada(deTokenId, _proprietario[deTokenId], _proprietario[paraTokenId], valor, paraTokenId);
    }

    /// @notice Fraciona: cria novo token com parte do valor, para outro titular.
    function transferFrom(uint256 deTokenId, address para, uint256 valor)
        external payable semValor ativo returns (uint256 novoTokenId)
    {
        _consumirPermissao(deTokenId, valor);
        _exigirNaoCongelado(deTokenId);
        // Circulação fechada (ADR-0005): o espelho não vai para quem a
        // plataforma não habilitou, e habilitação vencida não habilita.
        if (!_participantes.estaHabilitado(para)) revert TitularNaoHabilitado(para);
        if (_saldo[deTokenId] < valor) revert ValorExcedeTotal(deTokenId, valor, _saldo[deTokenId]);

        novoTokenId = _proximoToken++;
        _saldo[deTokenId] -= valor;
        _proprietario[novoTokenId] = para;
        _slot[novoTokenId] = _slot[deTokenId];
        _saldo[novoTokenId] = valor;
        _estado[novoTokenId] = EstadoEspelho.ATIVO;
        _hashDocumental[novoTokenId] = _hashDocumental[deTokenId];

        emit TransferValue(deTokenId, novoTokenId, valor);
        emit TitularidadeAlterada(deTokenId, _proprietario[deTokenId], para, valor, novoTokenId);
    }

    // --------------------------------------------------------------- consultas
    function estadoDo(uint256 tokenId) external view returns (EstadoEspelho) { return _estado[tokenId]; }
    function estaCongelado(uint256 tokenId) external view returns (bool) {
        return _estado[tokenId] == EstadoEspelho.CONGELADO;
    }
    function hashDocumentalDe(uint256 tokenId) external view returns (bytes32) { return _hashDocumental[tokenId]; }
    function valorEmitidoDoSlot(uint256 slot_) external view returns (uint256) { return _emitidoDoSlot[slot_]; }
    function valorCirculanteDoSlot(uint256 slot_) external view returns (uint256) { return _circulanteDoSlot[slot_]; }
    function proprietarioDe(uint256 tokenId) external view returns (address) { return _proprietario[tokenId]; }
    function pausado() external view returns (bool) { return _pausado; }

    // Âncora: o espelho expõe as consultas, o estado vive no contrato imutável.
    function tokenDaAncora(bytes32 a) external view returns (uint256) { return _ancora.tokenDaAncora(a); }
    function ancoraDoToken(uint256 t) external view returns (bytes32) { return _ancora.ancoraDoToken(t); }
    function ancoraDisponivel(bytes32 a) external view returns (bool) { return _ancora.ancoraDisponivel(a); }
    function totalAncoras() external view returns (uint256) { return _ancora.totalAncoras(); }

    // ------------------------------------------------------------------ pausa
    /// @dev Pausa congela movimentação. Não altera estado, não descongela
    ///      contrato congelado por divergência e não muda lógica — uma pausa
    ///      que pudesse fazer isso seria upgrade sem timelock com outro nome.
    function pausar(bool valor) external {
        _acesso.exigirPapel(_acesso.PAPEL_PAUSA(), msg.sender);
        _pausado = valor;
        emit Pausado(valor, msg.sender);
    }

    // ------------------------------------------------------------ atualização
    function proporAtualizacao(address nova) external returns (uint256 executavelEm) {
        _acesso.exigirPapel(_acesso.PAPEL_ADMIN(), msg.sender);
        executavelEm = block.timestamp + _acesso.atrasoTimelock();
        _propostaAtualizacao[nova] = executavelEm;
        emit AtualizacaoProposta(nova, executavelEm);
    }

    function executarAtualizacao(address nova) external {
        _acesso.exigirPapel(_acesso.PAPEL_ADMIN(), msg.sender);
        uint256 quando = _propostaAtualizacao[nova];
        require(quando != 0, "proposta inexistente");
        require(block.timestamp >= quando, "timelock pendente");
        require(nova.code.length > 0, "implementacao sem codigo");
        delete _propostaAtualizacao[nova];
        assembly { sstore(_SLOT_IMPL, nova) }
        emit AtualizacaoExecutada(nova);
    }

    function implementacao() external view returns (address impl) {
        assembly { impl := sload(_SLOT_IMPL) }
    }

    // ----------------------------------------------------------------- interno
    /// @dev O valor zero do enum é ATIVO, de modo que um tokenId inexistente
    ///      pareceria ativo. A guarda evita que a operação avance por engano e
    ///      só falhe lá adiante, com erro que não explica a causa.
    function _exigirExistente(uint256 tokenId) private view {
        require(_proprietario[tokenId] != address(0), "token inexistente");
    }

    function _exigirEstado(uint256 tokenId, EstadoEspelho exigido) private view {
        _exigirExistente(tokenId);
        if (_estado[tokenId] != exigido) revert EstadoInvalido(tokenId, _estado[tokenId], exigido);
    }

    function _exigirNaoCongelado(uint256 tokenId) private view {
        _exigirExistente(tokenId);
        if (_estado[tokenId] == EstadoEspelho.CONGELADO) revert EspelhoCongeladoErro(tokenId);
        if (_estado[tokenId] != EstadoEspelho.ATIVO) {
            revert EstadoInvalido(tokenId, _estado[tokenId], EstadoEspelho.ATIVO);
        }
    }

    function _consumirPermissao(uint256 tokenId, uint256 valor) private {
        if (msg.sender == _proprietario[tokenId]) return;
        uint256 permitido = _permissao[tokenId][msg.sender];
        require(permitido >= valor, "sem permissao suficiente");
        _permissao[tokenId][msg.sender] = permitido - valor;
    }
}
