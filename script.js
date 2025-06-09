// Funções de segurança
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>]/g, '');
}

function validateInput(input, maxLength = 100) {
    if (!input || typeof input !== 'string') return false;
    if (input.length > maxLength) return false;
    return /^[a-zA-Z0-9\s\-_.,#]+$/.test(input);
}

function validateNumber(input) {
    if (!input || typeof input !== 'string') return false;
    return /^\d+$/.test(input);
}

// Função para validar dados JSON
function validateJSON(data) {
    try {
        if (typeof data !== 'object' || data === null) return false;
        return true;
    } catch (e) {
        return false;
    }
}

// Variáveis globais
let crimesData = null;
let regrasAtenuantesAgravantes = {}; // Armazenar regras carregadas
let crimesSelecionados = [];
let atenuantesAgravantesSelecionados = []; // Renomeado para clareza

// Elementos DOM
document.addEventListener("DOMContentLoaded", () => {
    // Carregar dados dos crimes e regras com validação
    Promise.all([
        fetch("crimes_data.json")
            .then(res => res.json())
            .then(data => {
                if (!validateJSON(data)) throw new Error("Dados de crimes inválidos");
                return data;
            }),
        fetch("regras_atenuantes_agravantes.json")
            .then(res => res.json())
            .then(data => {
                if (!validateJSON(data)) throw new Error("Dados de regras inválidos");
                return data;
            })
    ])
    .then(([crimes, regras]) => {
        crimesData = crimes;
        regrasAtenuantesAgravantes = regras;
        console.log("Dados carregados:", crimesData);
        console.log("Regras carregadas:", regrasAtenuantesAgravantes); // Log para depuração
        inicializarCalculadora();
    })
    .catch(error => {
        console.error("Erro ao carregar dados iniciais:", error);
        mostrarToast("Erro ao carregar dados. Tente recarregar a página.", "error");
    });

    // Inicializar contagem de caracteres para descrição QRU
    const descricaoQru = document.getElementById("descricao-qru");
    const charCount = document.getElementById("char-count");

    descricaoQru.addEventListener("input", () => {
        const count = descricaoQru.value.length;
        charCount.textContent = count;

        if (count >= 2000) {
            charCount.style.color = "red";
        } else {
            charCount.style.color = "";
        }
    });

    // Botões de ação
    document.getElementById("calcular-pena").addEventListener("click", calcularPena);
    document.getElementById("copiar-resultado").addEventListener("click", copiarResultado);
    document.getElementById("limpar-resultado").addEventListener("click", limparResultado);

    // Pesquisa de crimes
    document.getElementById("pesquisar-crimes").addEventListener("input", filtrarCrimes);

    // Tabs de categorias
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            filtrarPorCategoria(btn.dataset.category);
        });
    });

    // Inicializar ficha com emojis
    limparResultado(false); // Chamar limpar sem toast inicial
});

// Inicializar a calculadora
function inicializarCalculadora() {
    carregarCrimes();
    carregarAtenuantesAgravantes(); // Renomeado
    atualizarListaCrimesSelecionados(); // Inicializar lista de selecionados
}

// Verificar se o crime requer campo de quantidade
function verificarCrimeComQuantidade(observacoes) {
    if (!observacoes) return false;

    const termos = [
        "unidade", "cada", "por", "à cada", "para cada", "acima",
        "mais", "por arma", "por vitima", "por pessoa", "de multa", "de dinheiro"
    ];

    const obsLower = observacoes.toLowerCase();
    return termos.some(termo => obsLower.includes(termo));
}

// Extrair regra de quantidade do texto de observações (REVISADO)
function extrairRegraQuantidade(observacoes) {
    if (!observacoes) return null;

    const obsLower = observacoes.toLowerCase();

    // Padrões comuns para extração de regras (prioridade maior para padrões mais específicos)
    const padroes = [
        // Mais X mês(es) para cada Y de dinheiro/multa
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:para cada|à cada|por)\s+(\d+(?:\.\d+)?)\s+de\s+(?:dinheiro|multa)/i,
            processar: (matches) => ({
                acrescimo: parseInt(matches[1]) || 0,
                porQuantidade: parseInt(matches[2].replace(/\./g, "")) || 1,
                tipo: "dinheiro"
            })
        },
        // Mais X mês(es) à cada Y unidades (com base inicial)
        {
            regex: /tráfico de drogas \(a partir de (\d+) unidades\).*mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:à cada|a cada|para cada|por)\s+(\d+)?\s*unidade/i,
            processar: (matches) => ({
                acrescimo: parseInt(matches[2]) || 0,
                porQuantidade: parseInt(matches[3]) || 1,
                tipo: "unidade",
                quantidadeBase: parseInt(matches[1]) || 0
            })
        },
        // Mais X mês(es) à cada Y unidades
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:à cada|a cada|para cada)\s+(\d+)\s+unidades/i,
            processar: (matches) => ({
                acrescimo: parseInt(matches[1]) || 0,
                porQuantidade: parseInt(matches[2]) || 1,
                tipo: "lote" // Pode ser "lote" ou "unidade" dependendo do contexto, mas "lote" é mais seguro
            })
        },
        // Mais X mês(es) por arma/vítima/pessoa/órgão
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:por|para cada|à cada)\s+(arma|vitima|pessoa|vítima|orgão|órgão)/i,
            processar: (matches) => ({
                acrescimo: parseInt(matches[1]) || 0,
                porQuantidade: 1,
                tipo: matches[2].includes("arma") ? "arma" :
                      matches[2].includes("vitima") || matches[2].includes("vítima") ? "vitima" :
                      matches[2].includes("orgão") || matches[2].includes("órgão") ? "orgao" : "pessoa"
            })
        },
         // Mais X mês(es) para cada unidade (genérico, menor prioridade)
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:para cada|à cada|por|a cada)\s+(\d+)?\s*(?:unidade|unidades)?/i,
            processar: (matches) => ({
                acrescimo: parseInt(matches[1]) || 0,
                porQuantidade: parseInt(matches[2]) || 1,
                tipo: "unidade"
            })
        }
    ];

    // Tentar extrair regra usando os padrões
    for (const padrao of padroes) {
        const matches = obsLower.match(padrao.regex);
        if (matches) {
            console.log(`Regra extraída para "${observacoes}":`, padrao.processar(matches));
            return padrao.processar(matches);
        }
    }

    console.warn(`Não foi possível extrair regra de quantidade para: "${observacoes}"`);
    // Se nenhuma regra for encontrada, retornar null para evitar cálculos incorretos
    return null;
}

// Função auxiliar para ordenar crimes por número do artigo
function ordenarCrimes(crimes) {
    return crimes.sort((a, b) => {
        // Extrair apenas os números do artigo para comparação numérica
        const numA = parseInt(String(a.num_artigo).replace(/[^0-9]/g, ''), 10);
        const numB = parseInt(String(b.num_artigo).replace(/[^0-9]/g, ''), 10);

        if (isNaN(numA) && isNaN(numB)) return 0;
        if (isNaN(numA)) return 1; // Colocar não numéricos no final
        if (isNaN(numB)) return -1; // Colocar não numéricos no final

        return numA - numB;
    });
}

// Carregar crimes na lista principal (REVISADO PARA ORDENAÇÃO)
function carregarCrimes() {
    const crimesList = document.getElementById("crimes-list");
    crimesList.innerHTML = ""; // Limpar lista principal

    // Adicionar cabeçalho geral que será atualizado
    const generalHeader = document.createElement("div");
    generalHeader.className = "category-header general-header"; // Adicionar classe para identificar
    generalHeader.id = "general-crime-header";
    generalHeader.textContent = "Todos os Crimes"; // Texto inicial
    crimesList.appendChild(generalHeader);

    // Criar um array com todos os crimes para a categoria "Todos"
    let todosOsCrimes = [];
    Object.keys(crimesData.crimes).forEach(categoria => {
        todosOsCrimes = todosOsCrimes.concat(crimesData.crimes[categoria] || []);
    });

    // Remover duplicados (caso um crime esteja em múltiplas categorias)
    todosOsCrimes = Array.from(new Map(todosOsCrimes.map(crime => [crime.num_artigo, crime])).values());

    // Ordenar todos os crimes numericamente
    todosOsCrimes = ordenarCrimes(todosOsCrimes);
    console.log("Todos os crimes ordenados:", todosOsCrimes.map(c => c.num_artigo)); // Log para depuração

    // Adicionar todos os crimes ordenados à lista
    todosOsCrimes.forEach(crime => {
        if (!crime || !crime.crime || crime.crime === "") return;
        criarElementoCrime(crime, crimesList, true); // true indica que é para a lista principal
    });

    // Inicializar filtro para mostrar todos
    filtrarPorCategoria("todos");
}

// Função para criar o elemento LI de um crime (REUTILIZÁVEL)
function criarElementoCrime(crime, listaDestino, isListaPrincipal) {
    if (!crime || !validateJSON(crime)) return;
    
    const li = document.createElement("li");
    // Encontrar a(s) categoria(s) originais do crime
    let categoriasOriginais = [];
    for (const catKey in crimesData.crimes) {
        if (crimesData.crimes[catKey].some(c => c.num_artigo === crime.num_artigo)) {
            categoriasOriginais.push(catKey);
        }
    }
    li.dataset.categorias = JSON.stringify(categoriasOriginais);
    li.dataset.codigo = crime.codigo;
    li.dataset.numArtigo = crime.num_artigo;
    li.dataset.meses = crime.meses;
    li.dataset.fianca = String(crime.valor_fianca);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `crime-${crime.num_artigo}`;
    checkbox.value = crime.num_artigo;

    // Verificar se o crime requer campo de quantidade
    const requerQuantidade = verificarCrimeComQuantidade(crime.observacoes);
    if (requerQuantidade) {
        li.dataset.requerQuantidade = "true";
        const regra = extrairRegraQuantidade(crime.observacoes);
        if (regra) {
            li.dataset.acrescimo = regra.acrescimo;
            li.dataset.porQuantidade = regra.porQuantidade;
            li.dataset.tipoQuantidade = regra.tipo;
            if (regra.quantidadeBase !== undefined) {
                li.dataset.quantidadeBase = regra.quantidadeBase;
            }
        }
    }

    // Event listener para seleção/deseleção
    checkbox.addEventListener("change", () => {
        handleCrimeSelectionChange(crime, checkbox.checked, li);
    });

    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.className = "crime-info";

    const title = document.createElement("div");
    title.className = "crime-title";
    title.textContent = `${crime.codigo} - ${crime.crime}`;

    const details = document.createElement("div");
    details.className = "crime-details";

    // Adicionar detalhes do crime
    let detailsText = `Pena Base: ${crime.meses} meses`;
    if (crime.tempo && crime.tempo !== "0" && crime.tempo !== "-") {
        detailsText += ` | Tempo: ${crime.tempo}`;
    }
    const fiancaValor = parseInt(crime.valor_fianca);
    const fiancaDisplay = isNaN(fiancaValor) || fiancaValor === 0 ? crime.valor_fianca : `R$ ${fiancaValor.toLocaleString("pt-BR")}`;

    if (fiancaDisplay && fiancaDisplay !== "0" && fiancaDisplay !== "N/T") {
        if (detailsText) detailsText += " | ";
        detailsText += `Fiança: ${fiancaDisplay}`;
    } else if (fiancaDisplay === "N/T") {
        if (detailsText) detailsText += " | ";
        detailsText += `Fiança: Inafiançável`;
    }
    if (crime.observacoes && crime.observacoes !== "-") {
        if (detailsText) detailsText += " | ";
        detailsText += `Obs: ${crime.observacoes}`;
    }
    details.textContent = detailsText || "Sem detalhes adicionais";

    label.appendChild(title);
    label.appendChild(details);

    li.appendChild(checkbox);
    li.appendChild(label);

    // Adicionar campo de quantidade se necessário
    if (requerQuantidade && li.dataset.acrescimo !== undefined) {
        const quantidadeInputDiv = document.createElement("div");
        quantidadeInputDiv.className = "quantidade-input";
        quantidadeInputDiv.style.display = "none";

        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.placeholder = "Qtd.";
        input.className = "quantidade";
        input.id = `quantidade-${crime.num_artigo}`;

        let labelText = "Quantidade:";
        const tipoQuantidade = li.dataset.tipoQuantidade;
        if (tipoQuantidade === "arma") labelText = "Qtd. armas:";
        else if (tipoQuantidade === "vitima") labelText = "Qtd. vítimas:";
        else if (tipoQuantidade === "pessoa") labelText = "Qtd. pessoas:";
        else if (tipoQuantidade === "dinheiro") labelText = "Valor (R$):";
        else if (tipoQuantidade === "orgao") labelText = "Qtd. órgãos:";
        else if (tipoQuantidade === "lote") labelText = `Qtd. (lotes de ${li.dataset.porQuantidade}):`;

        const inputLabel = document.createElement("label");
        inputLabel.htmlFor = input.id;
        inputLabel.textContent = labelText;

        input.addEventListener("input", () => {
            const quantidade = parseInt(input.value) || 0;
            const crimeSelecionado = crimesSelecionados.find(c => c.numArtigo === crime.num_artigo);
            if (crimeSelecionado) {
                crimeSelecionado.quantidade = quantidade;
            }
        });

        quantidadeInputDiv.appendChild(inputLabel);
        quantidadeInputDiv.appendChild(input);
        li.appendChild(quantidadeInputDiv);
    }

    listaDestino.appendChild(li);
}

// Manipulador para mudança de seleção de crime (REVISADO)
function handleCrimeSelectionChange(crime, isSelected, listItemElement) {
    const numArtigo = crime.num_artigo;
    const crimeIndex = crimesSelecionados.findIndex(c => c.numArtigo === numArtigo);

    if (isSelected && crimeIndex === -1) {
        // Adicionar crime
        const crimeSelecionado = {
            codigo: crime.codigo,
            crime: crime.crime,
            meses: parseInt(crime.meses) || 0,
            fianca: String(crime.valor_fianca),
            numArtigo: numArtigo,
            observacoes: crime.observacoes
        };

        if (listItemElement.dataset.requerQuantidade === "true" && listItemElement.dataset.acrescimo !== undefined) {
            const quantidadeInputDiv = listItemElement.querySelector(".quantidade-input");
            if (quantidadeInputDiv) {
                quantidadeInputDiv.style.display = "block";
                crimeSelecionado.requerQuantidade = true;
                crimeSelecionado.acrescimo = parseInt(listItemElement.dataset.acrescimo);
                crimeSelecionado.porQuantidade = parseInt(listItemElement.dataset.porQuantidade);
                crimeSelecionado.tipoQuantidade = listItemElement.dataset.tipoQuantidade;
                if (listItemElement.dataset.quantidadeBase !== undefined) {
                    crimeSelecionado.quantidadeBase = parseInt(listItemElement.dataset.quantidadeBase);
                }
                const inputField = quantidadeInputDiv.querySelector("input");
                crimeSelecionado.quantidade = inputField && inputField.value ? parseInt(inputField.value) : 0;
            }
        }
        crimesSelecionados.push(crimeSelecionado);
        listItemElement.classList.add("selected");

    } else if (!isSelected && crimeIndex > -1) {
        // Remover crime
        crimesSelecionados.splice(crimeIndex, 1);
        listItemElement.classList.remove("selected");
        if (listItemElement.dataset.requerQuantidade === "true") {
            const quantidadeInputDiv = listItemElement.querySelector(".quantidade-input");
            if (quantidadeInputDiv) {
                quantidadeInputDiv.style.display = "none";
                const inputField = quantidadeInputDiv.querySelector("input");
                if (inputField) inputField.value = "";
            }
        }
    }

    atualizarListaCrimesSelecionados();
}

// Atualizar a lista de atenuantes/agravantes selecionados na interface (REVISADO)
function atualizarListaAtenuantesSelecionados() {
    const selectedList = document.getElementById("atenuantes-selecionados-list");
    selectedList.innerHTML = ""; // Limpar lista

    if (atenuantesAgravantesSelecionados.length === 0) {
        selectedList.innerHTML = `<li class="empty-selected-state">Nenhum atenuante/agravante selecionado.</li>`;
        return;
    }

    atenuantesAgravantesSelecionados.forEach(atenuante => {
        const li = document.createElement("li");
        li.dataset.codigo = atenuante.codigo;

        const atenuanteInfoDiv = document.createElement("div");
        atenuanteInfoDiv.className = "crime-info"; // Reutilizar classe

        const title = document.createElement("div");
        title.className = "crime-title"; // Reutilizar classe
        
        // Lógica especial para RAA Nº08
        if (atenuante.codigo === "RAA Nº08") {
            title.textContent = `${atenuante.codigo} - ${atenuante.descricao} (PENA MÁXIMA)`;
        } else {
            title.textContent = `${atenuante.codigo} - ${atenuante.descricao}`;
        }

        // Botão para remover (desmarcar)
        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-crime-btn"; // Reutilizar classe
        removeBtn.innerHTML = "&times;"; // Ícone 'x'
        removeBtn.title = "Remover atenuante/agravante";
        removeBtn.onclick = () => {
            // Encontrar o checkbox correspondente na lista principal e desmarcá-lo
            const mainCheckbox = document.getElementById(`atenuante-${atenuante.codigo.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`);
            if (mainCheckbox) {
                mainCheckbox.checked = false;
                // Disparar o evento change manualmente para atualizar tudo
                mainCheckbox.dispatchEvent(new Event('change'));
            }
        };

        atenuanteInfoDiv.appendChild(title);
        atenuanteInfoDiv.appendChild(removeBtn);
        li.appendChild(atenuanteInfoDiv);
        selectedList.appendChild(li);
    });
}

// Atualizar a lista de crimes selecionados na interface (REVISADO)
function atualizarListaCrimesSelecionados() {
    const selectedList = document.getElementById("crimes-selecionados-list");
    selectedList.innerHTML = ""; // Limpar lista

    if (crimesSelecionados.length === 0) {
        selectedList.innerHTML = `<li class="empty-selected-state">Nenhum crime selecionado.</li>`;
        return;
    }

    // Ordenar crimes selecionados para exibição (opcional, mas bom para consistência)
    const crimesOrdenadosParaExibicao = ordenarCrimes([...crimesSelecionados]);

    crimesOrdenadosParaExibicao.forEach(crime => {
        const li = document.createElement("li");
        li.dataset.numArtigo = crime.numArtigo;

        const crimeInfoDiv = document.createElement("div");
        crimeInfoDiv.className = "crime-info";

        const title = document.createElement("div");
        title.className = "crime-title";
        // Adicionar meses base ao título
        title.textContent = `${crime.codigo} - ${crime.crime} (${crime.meses} meses)`;

        // Botão para remover (desmarcar)
        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-crime-btn";
        removeBtn.innerHTML = "&times;"; // Ícone 'x'
        removeBtn.title = "Remover crime";
        removeBtn.onclick = () => {
            // Encontrar o checkbox correspondente na lista principal e desmarcá-lo
            const mainCheckbox = document.getElementById(`crime-${crime.numArtigo}`);
            if (mainCheckbox) {
                mainCheckbox.checked = false;
                // Disparar o evento change manualmente para atualizar tudo
                mainCheckbox.dispatchEvent(new Event('change'));
            }
        };

        crimeInfoDiv.appendChild(title);
        crimeInfoDiv.appendChild(removeBtn);
        li.appendChild(crimeInfoDiv);
        selectedList.appendChild(li);
    });
}

// Carregar atenuantes e agravantes (REVISADO)
function carregarAtenuantesAgravantes() {
    const atenuantesList = document.getElementById("atenuantes-list");
    atenuantesList.innerHTML = "";

    if (!regrasAtenuantesAgravantes || !regrasAtenuantesAgravantes.atenuantes) {
        console.error("Dados de atenuantes/agravantes não carregados corretamente.");
        return;
    }

    regrasAtenuantesAgravantes.atenuantes.forEach(item => {
        if (!item || !item.descricao || item.descricao === "") return;

        const li = document.createElement("li");
        const codigoRegra = item.codigo;
        const regraTexto = item.reducao || item.aumento || "Regra não especificada"; // Usar reducao ou aumento

        li.dataset.codigo = codigoRegra;
        li.dataset.regra = regraTexto;
        li.dataset.descricao = item.descricao;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        // Gerar ID único e seguro para o DOM
        const checkboxId = `atenuante-${codigoRegra.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;
        checkbox.id = checkboxId;
        checkbox.dataset.codigo = codigoRegra; // Adicionar data-codigo para fácil acesso

        checkbox.addEventListener("change", () => {
            const isChecked = checkbox.checked;
            const atenuanteIndex = atenuantesAgravantesSelecionados.findIndex(a => a.codigo === codigoRegra);

            if (isChecked && atenuanteIndex === -1) {
                atenuantesAgravantesSelecionados.push({
                    codigo: codigoRegra,
                    descricao: item.descricao,
                    regra: regraTexto
                });
                console.log("Atenuante/Agravante adicionado:", codigoRegra);

                // Lógica especial para AC Nº02
                if (codigoRegra === "AC Nº02") {
                    adicionarCrimeAutomatico("022", "AC Nº02");
                }
                // Lógica especial para AC Nº03
                else if (codigoRegra === "AC Nº03") {
                    adicionarCrimeAutomatico("028", "AC Nº03");
                }
                // Lógica especial para RAA Nº08
                else if (codigoRegra === "RAA Nº08") {
                    adicionarCrimeAutomatico("057", "RAA Nº08");
                }

            } else if (!isChecked && atenuanteIndex > -1) {
                atenuantesAgravantesSelecionados.splice(atenuanteIndex, 1);
                console.log("Atenuante/Agravante removido:", codigoRegra);

                // Lógica especial para AC Nº02
                if (codigoRegra === "AC Nº02") {
                    removerCrimeAutomatico("022", "AC Nº02");
                }
                // Lógica especial para AC Nº03
                else if (codigoRegra === "AC Nº03") {
                    removerCrimeAutomatico("028", "AC Nº03");
                }
                // Lógica especial para RAA Nº08
                else if (codigoRegra === "RAA Nº08") {
                    removerCrimeAutomatico("057", "RAA Nº08");
                }
            }

            atualizarListaAtenuantesSelecionados();
            console.log("Atenuantes/Agravantes Selecionados:", atenuantesAgravantesSelecionados);
        });

        const label = document.createElement("label");
        label.htmlFor = checkbox.id;
        label.innerHTML = `<strong>${codigoRegra}</strong> - ${item.descricao} <br><small><em>(${regraTexto})</em></small>`;

        li.appendChild(checkbox);
        li.appendChild(label);
        atenuantesList.appendChild(li);
    });
}

// Função auxiliar para adicionar crime automaticamente
function adicionarCrimeAutomatico(numArtigo, motivoRegra) {
    const crime = findCrimeByArtigo(numArtigo);
    if (crime) {
        const jaSelecionado = crimesSelecionados.some(c => c.numArtigo === numArtigo);
        if (!jaSelecionado) {
            const mainCheckbox = document.getElementById(`crime-${numArtigo}`);
            if (mainCheckbox) {
                mainCheckbox.checked = true;
                mainCheckbox.dispatchEvent(new Event('change'));
                mostrarToast(`Artigo ${numArtigo} adicionado automaticamente devido à seleção de ${motivoRegra}.`, "info");
            } else {
                console.warn(`Checkbox para crime ${numArtigo} não encontrado para adição automática.`);
            }
        }
    } else {
        console.warn(`Crime com Artigo ${numArtigo} não encontrado para adicionar automaticamente.`);
    }
}

// Função auxiliar para remover crime automaticamente (se foi adicionado por regra)
function removerCrimeAutomatico(numArtigo, motivoRegra) {
    // Verifica se o crime ainda está selecionado
    const crimeIndex = crimesSelecionados.findIndex(c => c.numArtigo === numArtigo);
    if (crimeIndex > -1) {
        // Verifica se alguma outra regra que adiciona este crime ainda está ativa
        let outraRegraAtiva = false;
        if (numArtigo === "022" && atenuantesAgravantesSelecionados.some(a => a.codigo === "AC Nº02")) {
            // Se AC Nº02 ainda está ativo, não remover 022
            outraRegraAtiva = true;
        }
        if (numArtigo === "028" && atenuantesAgravantesSelecionados.some(a => a.codigo === "AC Nº03")) {
            // Se AC Nº03 ainda está ativo, não remover 028
            outraRegraAtiva = true;
        }
        if (numArtigo === "057" && atenuantesAgravantesSelecionados.some(a => a.codigo === "RAA Nº08")) {
            // Se RAA Nº08 ainda está ativo, não remover 057
            outraRegraAtiva = true;
        }

        // Remove o crime apenas se nenhuma outra regra que o adiciona estiver ativa
        if (!outraRegraAtiva) {
            const mainCheckbox = document.getElementById(`crime-${numArtigo}`);
            if (mainCheckbox) {
                mainCheckbox.checked = false;
                mainCheckbox.dispatchEvent(new Event('change'));
                mostrarToast(`Artigo ${numArtigo} removido automaticamente pois ${motivoRegra} foi desmarcado.`, "info");
            } else {
                 console.warn(`Checkbox para crime ${numArtigo} não encontrado para remoção automática.`);
            }
        }
    }
}

// Função auxiliar para encontrar um crime pelo número do artigo (REVISADO)
function findCrimeByArtigo(numArtigo) {
    if (!crimesData || !crimesData.crimes) return null;
    for (const categoria in crimesData.crimes) {
        const crime = crimesData.crimes[categoria].find(c => c.num_artigo === numArtigo);
        if (crime) return crime;
    }
    return null;
}

// Filtrar crimes por texto de pesquisa (REVISADO)
function filtrarCrimes() {
    const searchText = document.getElementById("pesquisar-crimes").value.toLowerCase().trim();
    const crimeItems = document.querySelectorAll("#crimes-list li");
    const generalHeader = document.getElementById("general-crime-header");
    const activeCategory = document.querySelector(".tab-btn.active").dataset.category;

    // Filtrar itens
    let visibleItemsCount = 0;
    crimeItems.forEach(item => {
        const crimeText = item.textContent.toLowerCase();
        const itemCategorias = JSON.parse(item.dataset.categorias || '[]');
        const isVisibleByCategory = (activeCategory === "todos" || itemCategorias.includes(activeCategory));
        const matchesSearch = !searchText || crimeText.includes(searchText);

        if (isVisibleByCategory && matchesSearch) {
            item.style.display = "flex";
            visibleItemsCount++;
        } else {
            item.style.display = "none";
        }
    });

    // Mostrar/Ocultar cabeçalho geral
    generalHeader.style.display = visibleItemsCount > 0 ? "block" : "none";

    // Mostrar mensagem se não houver resultados
    const container = document.querySelector(".crimes-list-container.main-list");
    let emptyState = container.querySelector(".empty-state");
    if (visibleItemsCount === 0 && (searchText || activeCategory !== "todos")) {
        if (!emptyState) {
            emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.innerHTML = `🔍<p>Nenhum crime encontrado para "${searchText}" na categoria selecionada.</p>`;
            container.appendChild(emptyState);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

// Filtrar crimes por categoria e atualizar cabeçalho (REVISADO)
function filtrarPorCategoria(categoria) {
    const crimeItems = document.querySelectorAll("#crimes-list li");
    const generalHeader = document.getElementById("general-crime-header");

    // Atualizar texto do cabeçalho geral
    generalHeader.textContent = categoria === "todos" ? "Todos os Crimes" : (crimesData.categorias[categoria] || "Categoria Desconhecida");

    // A lógica de exibição agora é controlada principalmente por filtrarCrimes
    // Apenas reativamos o filtro de texto
    filtrarCrimes();
}

// Função para extrair percentual da regra (REVISADO)
function extrairPercentualRegra(regraTexto) {
    if (!regraTexto) return 0;
    const textoLower = regraTexto.toLowerCase();
    const match = textoLower.match(/(\d+)%/);
    if (!match) return 0;

    const percentual = parseInt(match[1]);

    if (textoLower.includes("aumento") || textoLower.includes("aumentada")) {
        return percentual;
    } else if (textoLower.includes("redução") || textoLower.includes("diminuída") || textoLower.includes("reduz")) {
        return -percentual;
    } else {
        console.warn(`Não foi possível determinar aumento/redução para a regra: "${regraTexto}"`);
        return 0; // Não aplicar se não for claro
    }
}

// Função auxiliar para calcular pena base de uma lista de crimes (REVISADO)
function calcularPenaBase(listaCrimes) {
    let mesesBase = 0;
    listaCrimes.forEach(crime => {
        let mesesCrime = parseInt(crime.meses) || 0;
        // Aplicar cálculo de quantidade apenas se os dados necessários existirem
        if (crime.requerQuantidade && crime.quantidade !== undefined && crime.acrescimo !== undefined && crime.porQuantidade !== undefined) {
            let quantidade = parseInt(crime.quantidade) || 0;
            let acrescimo = parseInt(crime.acrescimo);
            let porQuantidade = parseInt(crime.porQuantidade);
            let acrescimoTotal = 0;

            if (porQuantidade <= 0) {
                console.error(`Divisão por zero evitada para o crime ${crime.codigo}. porQuantidade é ${porQuantidade}`);
                porQuantidade = 1; // Evitar divisão por zero
            }

            if (crime.quantidadeBase !== undefined) {
                let quantidadeBase = parseInt(crime.quantidadeBase);
                if (quantidade > quantidadeBase) {
                    const excedente = quantidade - quantidadeBase;
                    acrescimoTotal = Math.floor(excedente / porQuantidade) * acrescimo;
                    console.log(`Crime ${crime.codigo}: Qtd=${quantidade}, Base=${quantidadeBase}, Excedente=${excedente}, Acrescimo=${acrescimo}, PorQtd=${porQuantidade}, AcrTotal=${acrescimoTotal}`);
                }
            } else {
                acrescimoTotal = Math.floor(quantidade / porQuantidade) * acrescimo;
                 console.log(`Crime ${crime.codigo}: Qtd=${quantidade}, Acrescimo=${acrescimo}, PorQtd=${porQuantidade}, AcrTotal=${acrescimoTotal}`);
            }
            mesesCrime += acrescimoTotal;
        }
        mesesBase += mesesCrime;
    });
    console.log("Pena Base Calculada (antes de atenuantes):", mesesBase);
    return mesesBase;
}

// Calcular a pena (REVISADO E SIMPLIFICADO)
function calcularPena() {
    const nomeAcusado = document.getElementById("nome-acusado").value;
    const idAcusado = document.getElementById("id-acusado").value;
    const nomeResponsavel = document.getElementById("nome-responsavel").value;
    const idResponsavel = document.getElementById("id-responsavel").value;
    const auxiliares = document.getElementById("auxiliares").value;
    const descricaoQru = document.getElementById("descricao-qru").value;
    const fiancaPaga = document.getElementById("fianca-paga").checked;

    // Validação de entrada
    if (!validateInput(nomeAcusado) || !validateInput(idAcusado) || 
        !validateInput(nomeResponsavel) || !validateInput(idResponsavel)) {
        mostrarToast("Por favor, preencha todos os campos obrigatórios corretamente.", "error");
        return;
    }

    if (auxiliares && !validateInput(auxiliares, 500)) {
        mostrarToast("O campo de auxiliares contém caracteres inválidos.", "error");
        return;
    }

    if (descricaoQru && !validateInput(descricaoQru, 2000)) {
        mostrarToast("A descrição da QRU contém caracteres inválidos.", "error");
        return;
    }

    if (crimesSelecionados.length === 0) {
        mostrarToast("Selecione pelo menos um crime.", "error");
        return;
    }

    let penaFinal = 0;
    let totalFiancaAfiancaveis = 0;
    let crimesAfiancaveisTexto = "";
    let crimesInafiancaveisTexto = "";
    let modificadorTotalPercentual = 0;
    let atenuantesAplicadosTexto = "";
    let valorFiancaCalculado = 0;
    let penaCumplice = null;
    let crimesParaCalculo = [...crimesSelecionados]; // Usar cópia

    // *** Regra Especial Desacato ART 57 ***
    const desacatoArt57Presente = crimesParaCalculo.some(crime => crime.numArtigo === "057");
    
    // Separar crimes e calcular fiança base
    crimesParaCalculo.forEach(crime => {
        const fiancaValorStr = crime.fianca;
        const fiancaNumerica = parseInt(fiancaValorStr);
        // Considera afiançável se fianca for número > 0
        const isAfiancavel = !isNaN(fiancaNumerica) && fiancaNumerica > 0;

        let crimeTexto = `${crime.codigo} - ${crime.crime}`;
        // Adicionar detalhes de quantidade ao texto se aplicável
        if (crime.requerQuantidade && crime.quantidade !== undefined && crime.acrescimo !== undefined && crime.porQuantidade !== undefined) {
            let quantidade = parseInt(crime.quantidade) || 0;
            let acrescimo = parseInt(crime.acrescimo);
            let porQuantidade = parseInt(crime.porQuantidade);
            let acrescimoTotalMeses = 0;
            if (porQuantidade <= 0) porQuantidade = 1;

            if (crime.quantidadeBase !== undefined) {
                let quantidadeBase = parseInt(crime.quantidadeBase);
                if (quantidade > quantidadeBase) {
                    const excedente = quantidade - quantidadeBase;
                    acrescimoTotalMeses = Math.floor(excedente / porQuantidade) * acrescimo;
                }
            } else {
                acrescimoTotalMeses = Math.floor(quantidade / porQuantidade) * acrescimo;
            }
            if (acrescimoTotalMeses > 0) {
                crimeTexto += ` (${quantidade} ${crime.tipoQuantidade || 'unid.'}, +${acrescimoTotalMeses} meses)`;
            }
        }

        if (isAfiancavel) {
            crimesAfiancaveisTexto += `${crimeTexto}; `;
            totalFiancaAfiancaveis += fiancaNumerica;
        } else {
            crimesInafiancaveisTexto += `${crimeTexto}; `;
        }
    });

    // Remover ponto e vírgula final
    crimesAfiancaveisTexto = crimesAfiancaveisTexto.replace(/;\s*$/, "");
    crimesInafiancaveisTexto = crimesInafiancaveisTexto.replace(/;\s*$/, "");

    if (desacatoArt57Presente) {
        penaFinal = 120; // Pena máxima fixa para ART. 057
        console.log("Aplicando Regra Especial Desacato ART 57");
    } else {
        // Calcular pena base total
        const penaBaseTotal = calcularPenaBase(crimesParaCalculo);
        penaFinal = penaBaseTotal;

        // Se a fiança foi paga, remover a pena dos crimes afiançáveis
        if (fiancaPaga) {
            let penaCrimesInafiancaveis = 0;
            crimesParaCalculo.forEach(crime => {
                const fiancaValorStr = crime.fianca;
                const fiancaNumerica = parseInt(fiancaValorStr);
                const isAfiancavel = !isNaN(fiancaNumerica) && fiancaNumerica > 0;
                
                if (!isAfiancavel) {
                    let mesesCrime = parseInt(crime.meses) || 0;
                    // Aplicar cálculo de quantidade apenas se os dados necessários existirem
                    if (crime.requerQuantidade && crime.quantidade !== undefined && crime.acrescimo !== undefined && crime.porQuantidade !== undefined) {
                        let quantidade = parseInt(crime.quantidade) || 0;
                        let acrescimo = parseInt(crime.acrescimo);
                        let porQuantidade = parseInt(crime.porQuantidade);
                        let acrescimoTotal = 0;

                        if (porQuantidade <= 0) {
                            porQuantidade = 1;
                        }

                        if (crime.quantidadeBase !== undefined) {
                            let quantidadeBase = parseInt(crime.quantidadeBase);
                            if (quantidade > quantidadeBase) {
                                const excedente = quantidade - quantidadeBase;
                                acrescimoTotal = Math.floor(excedente / porQuantidade) * acrescimo;
                            }
                        } else {
                            acrescimoTotal = Math.floor(quantidade / porQuantidade) * acrescimo;
                        }
                        mesesCrime += acrescimoTotal;
                    }
                    penaCrimesInafiancaveis += mesesCrime;
                }
            });
            penaFinal = penaCrimesInafiancaveis;
        }
    }

    // Calcular modificadores de atenuantes/agravantes
    atenuantesAgravantesSelecionados.forEach(atenuante => {
        const percentual = extrairPercentualRegra(atenuante.regra);
        modificadorTotalPercentual += percentual;
        atenuantesAplicadosTexto += `${atenuante.codigo} (${percentual > 0 ? '+' : ''}${percentual}%); `;
    });
    atenuantesAplicadosTexto = atenuantesAplicadosTexto.replace(/;\s*$/, "");
    if (!atenuantesAplicadosTexto) atenuantesAplicadosTexto = "Nenhum";

    // Aplicar modificadores apenas se não for ART. 057
    if (!desacatoArt57Presente && modificadorTotalPercentual !== 0) {
        penaFinal = Math.max(0, Math.round(penaFinal * (1 + modificadorTotalPercentual / 100)));
        console.log(`Pena após modificadores (${modificadorTotalPercentual}%): ${penaFinal}`);
    }

    // Verificar se AC Nº02 está selecionado e se ART. 022 está presente
    const acN02Selecionado = atenuantesAgravantesSelecionados.some(atenuante => atenuante.codigo === "AC Nº02");
    const art022Presente = crimesParaCalculo.some(crime => crime.numArtigo === "022");
    
    if (acN02Selecionado && art022Presente) {
        penaFinal = 120; // Pena máxima para ART. 022 quando AC Nº02 está selecionado
        console.log("Aplicando regra AC Nº02 com ART. 022: Pena máxima definida para 120 meses.");
    } else if (!desacatoArt57Presente) {
        // Garantir que a pena final não exceda 120 meses (exceto se AC Nº02 com ART. 022 aplicado ou ART. 057)
        penaFinal = Math.min(penaFinal, 120);
    }

    // Calcular valor da fiança (50% do valor total para crimes afiançáveis)
    valorFiancaCalculado = Math.round(totalFiancaAfiancaveis * 0.5);

    // Calcular pena do cúmplice se RAA Nº06 estiver selecionado
    const raa06Selecionado = atenuantesAgravantesSelecionados.some(atenuante => atenuante.codigo === "RAA Nº06");
    if (raa06Selecionado) {
        penaCumplice = Math.round(penaFinal * 0.5);
        console.log("Calculando pena do cúmplice (RAA Nº06):", penaCumplice);
    }

    // Gerar texto de crimes cometidos baseado na opção de fiança paga
    let crimesCometidosTexto = "";
    if (fiancaPaga) {
        if (crimesAfiancaveisTexto && crimesInafiancaveisTexto) {
            // Se houver mistura de crimes com e sem fiança
            crimesCometidosTexto = `Inafiançáveis: ${crimesInafiancaveisTexto}.`;
        } else if (crimesAfiancaveisTexto) {
            // Se todos os crimes tiverem fiança
            crimesCometidosTexto = "Todos os crimes são afiançáveis e a fiança foi paga.";
        } else if (crimesInafiancaveisTexto) {
            // Se todos os crimes forem inafiançáveis
            crimesCometidosTexto = `Inafiançáveis: ${crimesInafiancaveisTexto}.`;
        }
    } else {
        // Se a fiança não foi paga, mostrar todos os crimes
        if (crimesAfiancaveisTexto && crimesInafiancaveisTexto) {
            crimesCometidosTexto = `Afiançáveis: ${crimesAfiancaveisTexto}. Inafiançáveis: ${crimesInafiancaveisTexto}.`;
        } else if (crimesAfiancaveisTexto) {
            crimesCometidosTexto = `Afiançáveis: ${crimesAfiancaveisTexto}.`;
        } else if (crimesInafiancaveisTexto) {
            crimesCometidosTexto = `Inafiançáveis: ${crimesInafiancaveisTexto}.`;
        }
    }

    // Atualizar ficha criminal
    const detalhesFicha = document.getElementById("detalhes-ficha");
    detalhesFicha.innerHTML = `
        <li>👤 Nome do Acusado: ${nomeAcusado}</li>
        <li>🆔 ID do Acusado: ${idAcusado}</li>
        <li>👮 Responsável pela Prisão: ${nomeResponsavel} #${idResponsavel}</li>
        <li>👥 Auxiliares: ${auxiliares}</li>
        <li>📝 Descrição QRU: ${descricaoQru}</li>
        <hr>
        <li>⚖️ Crimes Cometidos: ${crimesCometidosTexto}</li>
        <li>ℹ️ Atenuantes/Agravantes Aplicados: ${atenuantesAplicadosTexto}</li>
        <li>🧮 Modificador Total Aplicado: ${modificadorTotalPercentual}%</li>
        <hr>
        <li>📅 Pena Final Aplicada: ${penaFinal} meses</li>
        ${penaCumplice !== null ? `<li>🤝 Pena para Cúmplice (RAA Nº06): ${penaCumplice} meses (50% da Pena Final)</li>` : ''}
        ${fiancaPaga ? 
            (crimesAfiancaveisTexto ? 
                `<li>💰 Valor da Fiança Paga: R$ ${valorFiancaCalculado.toLocaleString("pt-BR")}</li>` : 
                '') : 
            `<li>💰 Valor da Fiança (Base): R$ ${valorFiancaCalculado.toLocaleString("pt-BR")}</li>`
        }
        <li>${fiancaPaga ? '✅' : '❌'} Fiança Paga: ${fiancaPaga ? "Sim" : "Não"}</li>`;

    mostrarToast("Pena calculada com sucesso!", "success");
}

// Proteção contra XSS
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Proteção contra CSRF
function getCSRFToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

// Função para fazer requisições seguras
async function secureFetch(url, options = {}) {
    const defaultOptions = {
        headers: {
            'X-CSRF-Token': getCSRFToken(),
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin'
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response;
}

// Função para copiar resultado com segurança
function copiarResultado() {
    const resultado = document.getElementById("resultado-ficha");
    if (!resultado) return;

    const texto = resultado.innerText;
    if (!texto) return;

    // Sanitizar o texto antes de copiar
    const textoSanitizado = escapeHTML(texto);

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textoSanitizado)
            .then(() => mostrarToast("Texto copiado com sucesso!", "success"))
            .catch(() => copiarResultadoFallback(textoSanitizado));
    } else {
        copiarResultadoFallback(textoSanitizado);
    }
}

// Função para mostrar toast com segurança
function mostrarToast(mensagem, tipo = "info") {
    if (!mensagem) return;
    
    const mensagemSanitizada = escapeHTML(mensagem);
    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagemSanitizada;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Fallback para copiar resultado
function copiarResultadoFallback(resultado) {
    const textarea = document.createElement('textarea');
    textarea.value = resultado;
    // Estilizar para não ser visível
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, 99999); // Para dispositivos móveis

    try {
        document.execCommand('copy');
        mostrarToast("Ficha criminal copiada para a área de transferência!", "success");
    } catch (err) {
        console.error('Erro ao copiar (fallback): ', err);
        mostrarToast("Erro ao copiar. Por favor, copie manualmente.", "error");
    }

    document.body.removeChild(textarea);
}

// Limpar resultado e seleções (REVISADO)
function limparResultado(showToast = true) {
    // Limpar crimes selecionados
    crimesSelecionados = [];
    document.querySelectorAll('#crimes-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        // Resetar estado visual do item da lista
        const listItem = checkbox.closest('li');
        if (listItem) {
            listItem.classList.remove("selected");
            const quantidadeInputDiv = listItem.querySelector(".quantidade-input");
            if (quantidadeInputDiv) {
                quantidadeInputDiv.style.display = "none";
                const inputField = quantidadeInputDiv.querySelector("input");
                if (inputField) inputField.value = "";
            }
        }
    });

    // Limpar atenuantes/agravantes selecionados
    atenuantesAgravantesSelecionados = [];
    document.querySelectorAll('#atenuantes-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });

    // Atualizar listas na interface
    atualizarListaCrimesSelecionados();
    atualizarListaAtenuantesSelecionados();

    // Limpar campos de formulário
    document.getElementById("nome-acusado").value = "";
    document.getElementById("id-acusado").value = "";
    document.getElementById("nome-responsavel").value = "";
    document.getElementById("id-responsavel").value = "";
    document.getElementById("auxiliares").value = "";
    document.getElementById("descricao-qru").value = "";
    document.getElementById("fianca-paga").checked = false;
    document.getElementById("char-count").textContent = "0";
    document.getElementById("pesquisar-crimes").value = ""; // Limpar pesquisa

    // Resetar ficha criminal
    const detalhesFicha = document.getElementById("detalhes-ficha");
    detalhesFicha.innerHTML = `
        <li>👤 Nome do Acusado: Não informado</li>
        <li>🆔 ID do Acusado: Não informado</li>
        <li>👮 Responsável pela Prisão: Não informado</li>
        <li>👥 Auxiliares: Não informado</li>
        <li>📝 Descrição QRU: Não informado</li>
        <hr>
        <li>⚖️ Crimes Cometidos: Nenhum</li>
        <li>ℹ️ Atenuantes/Agravantes Aplicados: Nenhum</li>
        <li>🧮 Modificador Total Aplicado: 0%</li>
        <hr>
        <li>📅 Pena Final Aplicada: 0 meses</li>
        <li>💰 Valor da Fiança (Base): R$ 0</li>
        <li>❌ Fiança Paga: Não</li>`;

    // Resetar filtro para "Todos"
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const todosTab = document.querySelector('.tab-btn[data-category="todos"]');
    if (todosTab) todosTab.classList.add("active");
    filtrarPorCategoria("todos");

    if (showToast) {
        mostrarToast("Todos os campos foram limpos!", "success");
    }
}

