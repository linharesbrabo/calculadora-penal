// Variáveis globais
let crimesData = null;
let regrasAtenuantesAgravantes = {}; // Armazenar regras carregadas
let crimesSelecionados = [];
let atenuantesAgravantesSelecionados = []; // Renomeado para clareza

// Elementos DOM
document.addEventListener("DOMContentLoaded", () => {
    // Carregar dados dos crimes e regras
    Promise.all([
        fetch("crimes_data.json").then(res => res.json()),
        fetch("regras_atenuantes_agravantes.json").then(res => res.json())
    ])
    .then(([crimes, regras]) => {
        crimesData = crimes;
        regrasAtenuantesAgravantes = regras;
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
        "mais", "por arma", "por vitima", "por pessoa"
    ];

    const obsLower = observacoes.toLowerCase();
    return termos.some(termo => obsLower.includes(termo));
}

// Extrair regra de quantidade do texto de observações
function extrairRegraQuantidade(observacoes) {
    if (!observacoes) return null;

    const obsLower = observacoes.toLowerCase();

    // Padrões comuns para extração de regras
    const padroes = [
        // Mais X para cada unidade
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:para cada|à cada|por|a cada)\s+(\d+)?\s*(?:unidade|unidades)?/i,
            processar: (matches) => {
                return {
                    acrescimo: parseInt(matches[1]) || 0,
                    porQuantidade: parseInt(matches[2]) || 1,
                    tipo: "unidade"
                };
            }
        },
        // Mais X meses por arma/vítima/pessoa
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:por|para cada|à cada)\s+(?:arma|vitima|pessoa|vítima|orgão|órgão)/i,
            processar: (matches) => {
                return {
                    acrescimo: parseInt(matches[1]) || 0,
                    porQuantidade: 1,
                    tipo: matches[0].includes("arma") ? "arma" :
                          matches[0].includes("vitima") || matches[0].includes("vítima") ? "vitima" :
                          matches[0].includes("orgão") || matches[0].includes("órgão") ? "orgao" : "pessoa"
                };
            }
        },
        // Mais X meses à cada Y unidades
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:à cada|a cada|para cada)\s+(\d+)\s+unidades/i,
            processar: (matches) => {
                return {
                    acrescimo: parseInt(matches[1]) || 0,
                    porQuantidade: parseInt(matches[2]) || 1,
                    tipo: "lote"
                };
            }
        },
        // Mais X mês para cada Y de dinheiro
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:para cada|à cada|por)\s+(\d+(?:\.\d+)?)\s+de\s+dinheiro/i,
            processar: (matches) => {
                return {
                    acrescimo: parseInt(matches[1]) || 0,
                    porQuantidade: parseInt(matches[2].replace(/\./g, "")) || 1,
                    tipo: "dinheiro"
                };
            }
        }
    ];

    // Tentar extrair regra usando os padrões
    for (const padrao of padroes) {
        const matches = obsLower.match(padrao.regex);
        if (matches) {
            return padrao.processar(matches);
        }
    }

    // Casos específicos conhecidos
    if (obsLower.includes("tráfico de drogas") && obsLower.includes("a partir de 6 unidades")) {
        return {
            acrescimo: 2,
            porQuantidade: 1,
            tipo: "unidade",
            quantidadeBase: 6
        };
    }

    if (obsLower.includes("mais 1 mês para cada 5.000 de dinheiro")) {
        return {
            acrescimo: 1,
            porQuantidade: 5000,
            tipo: "dinheiro"
        };
    }

    // Regra padrão se não conseguir extrair
    return {
        acrescimo: 1,
        porQuantidade: 1,
        tipo: "unidade"
    };
}

// Carregar crimes na lista principal
function carregarCrimes() {
    const crimesList = document.getElementById("crimes-list");
    crimesList.innerHTML = ""; // Limpar lista principal

    // Adicionar cabeçalho geral que será atualizado
    const generalHeader = document.createElement("div");
    generalHeader.className = "category-header general-header"; // Adicionar classe para identificar
    generalHeader.id = "general-crime-header";
    generalHeader.textContent = "Todos os Crimes"; // Texto inicial
    crimesList.appendChild(generalHeader);

    // Criar elementos para cada categoria
    Object.keys(crimesData.categorias).forEach(categoria => {
        const crimes = crimesData.crimes[categoria] || [];
        if (crimes.length === 0) return;

        // Adicionar crimes da categoria
        crimes.forEach(crime => {
            if (!crime.crime || crime.crime === "") return;

            const li = document.createElement("li");
            li.dataset.categoria = categoria;
            li.dataset.codigo = crime.codigo;
            li.dataset.numArtigo = crime.num_artigo;
            li.dataset.meses = crime.meses;
            li.dataset.fianca = String(crime.valor_fianca);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = `crime-${crime.num_artigo}`;
            checkbox.value = crime.num_artigo; // Usar num_artigo como identificador

            // Verificar se o crime requer campo de quantidade
            const requerQuantidade = verificarCrimeComQuantidade(crime.observacoes);
            if (requerQuantidade) {
                li.dataset.requerQuantidade = "true";
                const regra = extrairRegraQuantidade(crime.observacoes);
                if (regra) {
                    li.dataset.acrescimo = regra.acrescimo;
                    li.dataset.porQuantidade = regra.porQuantidade;
                    li.dataset.tipoQuantidade = regra.tipo;
                    if (regra.quantidadeBase) {
                        li.dataset.quantidadeBase = regra.quantidadeBase;
                    }
                }
            }

            // Event listener para seleção/deseleção na lista principal
            checkbox.addEventListener("change", () => {
                handleCrimeSelectionChange(crime, checkbox.checked, li);
            });

            const label = document.createElement("label");
            label.htmlFor = `crime-${crime.num_artigo}`;
            label.className = "crime-info";

            const title = document.createElement("div");
            title.className = "crime-title";
            title.textContent = `${crime.codigo} - ${crime.crime}`;

            const details = document.createElement("div");
            details.className = "crime-details";

            // Adicionar detalhes do crime
            let detailsText = `Pena Base: ${crime.meses} meses`; // Incluir meses base
            if (crime.tempo && crime.tempo !== "0" && crime.tempo !== "-") {
                detailsText += ` | Tempo: ${crime.tempo}`;
            }
            const fiancaDisplay = String(crime.valor_fianca);
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
            if (requerQuantidade) {
                const quantidadeInputDiv = document.createElement("div");
                quantidadeInputDiv.className = "quantidade-input";
                quantidadeInputDiv.style.display = "none"; // Escondido inicialmente

                const input = document.createElement("input");
                input.type = "number";
                input.min = "0";
                input.placeholder = "Quantidade";
                input.className = "quantidade";
                input.id = `quantidade-${crime.num_artigo}`;

                let labelText = "Quantidade:";
                const tipoQuantidade = li.dataset.tipoQuantidade;
                if (tipoQuantidade === "arma") labelText = "Qtd. armas:";
                else if (tipoQuantidade === "vitima") labelText = "Qtd. vítimas:";
                else if (tipoQuantidade === "pessoa") labelText = "Qtd. pessoas:";
                else if (tipoQuantidade === "dinheiro") labelText = "Qtd. dinheiro:";
                else if (tipoQuantidade === "orgao") labelText = "Qtd. órgãos:";
                else if (tipoQuantidade === "lote") labelText = `Qtd. (lotes de ${li.dataset.porQuantidade}):`;

                const inputLabel = document.createElement("label");
                inputLabel.htmlFor = `quantidade-${crime.num_artigo}`;
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

            crimesList.appendChild(li);
        });
    });

    // Inicializar filtro para mostrar todos
    filtrarPorCategoria("todos");
}

// Manipulador para mudança de seleção de crime (centralizado)
function handleCrimeSelectionChange(crime, isSelected, listItemElement) {
    const numArtigo = crime.num_artigo;
    const crimeIndex = crimesSelecionados.findIndex(c => c.numArtigo === numArtigo);

    if (isSelected && crimeIndex === -1) {
        // Adicionar crime
        const crimeSelecionado = {
            codigo: crime.codigo,
            crime: crime.crime,
            meses: crime.meses,
            fianca: String(crime.valor_fianca),
            numArtigo: numArtigo
        };

        if (listItemElement.dataset.requerQuantidade === "true") {
            const quantidadeInputDiv = listItemElement.querySelector(".quantidade-input");
            if (quantidadeInputDiv) {
                quantidadeInputDiv.style.display = "block";
                crimeSelecionado.requerQuantidade = true;
                crimeSelecionado.acrescimo = parseInt(listItemElement.dataset.acrescimo) || 0;
                crimeSelecionado.porQuantidade = parseInt(listItemElement.dataset.porQuantidade) || 1;
                crimeSelecionado.tipoQuantidade = listItemElement.dataset.tipoQuantidade;
                if (listItemElement.dataset.quantidadeBase) {
                    crimeSelecionado.quantidadeBase = parseInt(listItemElement.dataset.quantidadeBase);
                }
                // Ler valor inicial do input se já houver
                const inputField = quantidadeInputDiv.querySelector("input");
                if (inputField && inputField.value) {
                    crimeSelecionado.quantidade = parseInt(inputField.value) || 0;
                }
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
                if (inputField) inputField.value = ""; // Limpar campo
            }
        }
    }

    // Atualizar a lista de crimes selecionados na interface
    atualizarListaCrimesSelecionados();
}

// Atualizar a lista de crimes selecionados na interface
function atualizarListaCrimesSelecionados() {
    const selectedList = document.getElementById("crimes-selecionados-list");
    selectedList.innerHTML = ""; // Limpar lista

    if (crimesSelecionados.length === 0) {
        selectedList.innerHTML = `<li class="empty-selected-state">Nenhum crime selecionado.</li>`;
        return;
    }

    crimesSelecionados.forEach(crime => {
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

    // Nota sobre atenuantes/agravantes: São aplicados globalmente, não por crime individualmente.
    // A exibição deles aqui poderia ser confusa. Mantidos na seção principal.
}

// Carregar atenuantes e agravantes
function carregarAtenuantesAgravantes() {
    const atenuantesList = document.getElementById("atenuantes-list");
    atenuantesList.innerHTML = "";

    crimesData.atenuantes.forEach(item => {
        if (!item.descricao || item.descricao === "") return;

        const li = document.createElement("li");
        const codigoRegra = item.codigo;
        const regraTexto = regrasAtenuantesAgravantes[codigoRegra] || "Regra não encontrada";

        li.dataset.codigo = codigoRegra;
        li.dataset.regra = regraTexto;
        li.dataset.descricao = item.descricao;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `atenuante-${codigoRegra.replace(/\s+|º/g, "-").toLowerCase()}`;

        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                atenuantesAgravantesSelecionados.push({
                    codigo: codigoRegra,
                    descricao: item.descricao,
                    regra: regraTexto
                });
            } else {
                atenuantesAgravantesSelecionados = atenuantesAgravantesSelecionados.filter(a => a.codigo !== codigoRegra);
            }
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


// Filtrar crimes por texto de pesquisa
function filtrarCrimes() {
    const searchText = document.getElementById("pesquisar-crimes").value.toLowerCase();
    const crimeItems = document.querySelectorAll("#crimes-list li");
    const generalHeader = document.getElementById("general-crime-header");
    const activeCategory = document.querySelector(".tab-btn.active").dataset.category;

    // Filtrar itens
    let visibleItemsCount = 0;
    crimeItems.forEach(item => {
        const crimeInfo = item.querySelector(".crime-info").textContent.toLowerCase();
        const itemCategory = item.dataset.categoria;
        const isVisibleByCategory = (activeCategory === "todos" || itemCategory === activeCategory);

        if (isVisibleByCategory && crimeInfo.includes(searchText)) {
            item.style.display = "flex";
            visibleItemsCount++;
        } else {
            item.style.display = "none";
        }
    });

    // Mostrar/Ocultar cabeçalho geral
    if (visibleItemsCount > 0) {
        generalHeader.style.display = "block";
    } else {
        generalHeader.style.display = "none";
    }

    // Mostrar mensagem se não houver resultados
    const emptyState = document.querySelector(".empty-state");
    if (visibleItemsCount === 0 && (searchText || activeCategory !== "todos")) {
        if (!emptyState) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.innerHTML = 	`🔍<p>Nenhum crime encontrado para esta seleção.</p>`; // Emoji
            document.querySelector(".crimes-list-container.main-list").appendChild(empty);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

// Filtrar crimes por categoria e atualizar cabeçalho
function filtrarPorCategoria(categoria) {
    const crimeItems = document.querySelectorAll("#crimes-list li");
    const generalHeader = document.getElementById("general-crime-header");

    // Atualizar texto do cabeçalho geral
    if (categoria === "todos") {
        generalHeader.textContent = "Todos os Crimes";
        crimeItems.forEach(item => {
            item.style.display = "flex";
        });
    } else {
        generalHeader.textContent = crimesData.categorias[categoria] || "Categoria Desconhecida";
        crimeItems.forEach(item => {
            if (item.dataset.categoria === categoria) {
                item.style.display = "flex";
            } else {
                item.style.display = "none";
            }
        });
    }

    // Aplicar também o filtro de pesquisa
    filtrarCrimes();
}

// Função para extrair percentual da regra (positvo para aumento, negativo para redução)
function extrairPercentualRegra(regraTexto) {
    const textoLower = regraTexto.toLowerCase();
    const match = textoLower.match(/(\d+)%/);
    if (!match) return 0;

    const percentual = parseInt(match[1]);

    if (textoLower.includes("aumento")) {
        return percentual;
    } else if (textoLower.includes("redução") || textoLower.includes("diminuída") || textoLower.includes("reduz")) {
        return -percentual;
    } else {
        return 0; // Se não especifica aumento/redução, não aplicar percentual direto
    }
}

// Função auxiliar para calcular pena base de uma lista de crimes
function calcularPenaBase(listaCrimes) {
    let mesesBase = 0;
    listaCrimes.forEach(crime => {
        let mesesCrime = parseInt(crime.meses) || 0;
        if (crime.requerQuantidade && crime.quantidade) {
            let quantidade = parseInt(crime.quantidade) || 0;
            let acrescimo = parseInt(crime.acrescimo) || 0;
            let porQuantidade = parseInt(crime.porQuantidade) || 1;
            let acrescimoTotal = 0;
            if (crime.quantidadeBase) {
                if (quantidade > crime.quantidadeBase) {
                    const excedente = quantidade - crime.quantidadeBase;
                    acrescimoTotal = Math.floor(excedente / porQuantidade) * acrescimo;
                }
            } else {
                acrescimoTotal = Math.floor(quantidade / porQuantidade) * acrescimo;
            }
            mesesCrime += acrescimoTotal;
        }
        mesesBase += mesesCrime;
    });
    return mesesBase;
}

// Calcular a pena (Refatorado para lógica de fiança mista)
function calcularPena() {
    // Validar campos obrigatórios
    const nomeAcusado = document.getElementById("nome-acusado").value;
    const idAcusado = document.getElementById("id-acusado").value;
    const nomeResponsavel = document.getElementById("nome-responsavel").value;
    const idResponsavel = document.getElementById("id-responsavel").value;
    const auxiliares = document.getElementById("auxiliares").value || "Não informado";

    if (!nomeAcusado || !idAcusado || !nomeResponsavel || !idResponsavel) {
        mostrarToast("Preencha os campos obrigatórios: Nome e ID do Acusado, Nome e ID do Responsável.", "error");
        return;
    }

    if (crimesSelecionados.length === 0) {
        mostrarToast("Selecione pelo menos um crime.", "error");
        return;
    }

    // Separar crimes afiançáveis e inafiançáveis
    const crimesAfiancaveis = [];
    const crimesInafiancaveis = [];
    let totalFiancaAfiancaveis = 0;
    let crimesAfiancaveisTexto = "";
    let crimesInafiancaveisTexto = "";

    crimesSelecionados.forEach(crime => {
        const fiancaValorStr = crime.fianca;
        const fiancaNumerica = parseInt(fiancaValorStr);
        const isAfiancavel = !(fiancaValorStr === "N/T" || fiancaValorStr === "0" || fiancaNumerica === 0 || !fiancaValorStr);

        let crimeTexto = `${crime.codigo} - ${crime.crime}`;
        if (crime.requerQuantidade && crime.quantidade) {
            let quantidade = parseInt(crime.quantidade) || 0;
            let acrescimo = parseInt(crime.acrescimo) || 0;
            let porQuantidade = parseInt(crime.porQuantidade) || 1;
            let acrescimoTotal = 0;
            if (crime.quantidadeBase) {
                if (quantidade > crime.quantidadeBase) {
                    const excedente = quantidade - crime.quantidadeBase;
                    acrescimoTotal = Math.floor(excedente / porQuantidade) * acrescimo;
                }
            } else {
                acrescimoTotal = Math.floor(quantidade / porQuantidade) * acrescimo;
            }
            crimeTexto += ` (${quantidade} ${crime.tipoQuantidade || "unidades"}, +${acrescimoTotal} meses)`;
        }

        if (isAfiancavel) {
            crimesAfiancaveis.push(crime);
            totalFiancaAfiancaveis += fiancaNumerica;
            crimesAfiancaveisTexto += crimeTexto + ", ";
        } else {
            crimesInafiancaveis.push(crime);
            crimesInafiancaveisTexto += crimeTexto + ", ";
        }
    });

    // Remover vírgulas finais
    crimesAfiancaveisTexto = crimesAfiancaveisTexto.slice(0, -2);
    crimesInafiancaveisTexto = crimesInafiancaveisTexto.slice(0, -2);

    // Calcular penas base separadas
    const totalMesesBaseAfiancaveis = calcularPenaBase(crimesAfiancaveis);
    const totalMesesBaseInafiancaveis = calcularPenaBase(crimesInafiancaveis);
    const totalMesesBaseGeral = totalMesesBaseAfiancaveis + totalMesesBaseInafiancaveis;

    // --- Lógica de Atenuantes e Agravantes --- 
    let modificadorPercentualTotal = 0;
    let motivosModificacao = [];
    let isReuPrimario = atenuantesAgravantesSelecionados.some(a => a.codigo === "RAA Nº03");
    let isReincidente = atenuantesAgravantesSelecionados.some(a => a.codigo === "RAA Nº04" || a.codigo === "RAA Nº05");
    const desacatoSelecionado = atenuantesAgravantesSelecionados.some(a => a.codigo === "RAA Nº08");
    let textoDesacato = "";

    if (!desacatoSelecionado) {
        atenuantesAgravantesSelecionados.forEach(item => {
            const codigo = item.codigo;
            const regra = item.regra;
            let percentual = 0;
            if (codigo === "RAA Nº06") {
                motivosModificacao.push(`${codigo} - ${item.descricao}: ${regra}`);
                return;
            }
            if (codigo === "RAA Nº01") {
                if (isReuPrimario) percentual = -50;
                else if (isReincidente) percentual = -30;
                else percentual = 0;
            } else {
                percentual = extrairPercentualRegra(regra);
            }
            modificadorPercentualTotal += percentual;
            motivosModificacao.push(`${codigo} - ${item.descricao}: ${regra}`);
        });
    } else {
        const desacatoItem = atenuantesAgravantesSelecionados.find(a => a.codigo === "RAA Nº08");
        motivosModificacao.push(`${desacatoItem.codigo} - ${desacatoItem.descricao}: ${desacatoItem.regra}`);
        textoDesacato = "🚨 Atenuantes perdidos devido ao Desacato (RAA Nº08). Pena máxima aplicada.";
        modificadorPercentualTotal = 0;
    }

    // Calcular pena modificada (aplicando modificador)
    function calcularPenaModificada(mesesBase, modificador) {
        let mesesModificados = mesesBase;
        if (!desacatoSelecionado && modificador !== 0) {
            mesesModificados = Math.round(mesesBase * (1 + modificador / 100));
        }
        if (mesesModificados < 0) mesesModificados = 0;
        return mesesModificados;
    }

    const totalMesesModificadosGeral = calcularPenaModificada(totalMesesBaseGeral, modificadorPercentualTotal);
    const totalMesesModificadosInafiancaveis = calcularPenaModificada(totalMesesBaseInafiancaveis, modificadorPercentualTotal);

    // Aplicar limite máximo de 120 meses OU pena máxima por desacato
    const limiteMaximoPena = 120;
    let penaFinalExibida;
    let textoPenaFinal = "📅 Pena Final Aplicada:";

    const fiancaPagaCheckbox = document.getElementById("fianca-paga");
    const fiancaPaga = fiancaPagaCheckbox.checked;
    const fiancaPagaTexto = fiancaPaga ? "Sim" : "Não";

    // Determinar a pena final baseada na fiança paga e tipos de crime
    if (fiancaPaga && crimesAfiancaveis.length > 0) {
        // Fiança paga e há crimes afiançáveis -> Pena final = pena dos inafiançáveis
        penaFinalExibida = totalMesesModificadosInafiancaveis;
        if (desacatoSelecionado) {
            penaFinalExibida = limiteMaximoPena;
        } else if (penaFinalExibida > limiteMaximoPena) {
            penaFinalExibida = limiteMaximoPena;
        }
        textoPenaFinal = "📅 Pena Final Aplicada (apenas crimes inafiançáveis devido à fiança paga):";
    } else {
        // Fiança não paga OU não há crimes afiançáveis -> Pena final = pena geral
        penaFinalExibida = totalMesesModificadosGeral;
        if (desacatoSelecionado) {
            penaFinalExibida = limiteMaximoPena;
        } else if (penaFinalExibida > limiteMaximoPena) {
            penaFinalExibida = limiteMaximoPena;
        }
    }

    // Formatar motivos
    const motivosTexto = motivosModificacao.length > 0 ? motivosModificacao.join("; ") : "Nenhum";

    // Obter descrição QRU
    const descricaoQru = document.getElementById("descricao-qru").value || "Não informado";

    // --- Montar Ficha Criminal --- 
    let fichaHTML = `
        <li>👤 Nome do Acusado: ${nomeAcusado}</li>
        <li>🆔 ID do Acusado: ${idAcusado}</li>
        <li>👮 Responsável pela Prisão: ${nomeResponsavel} (ID: ${idResponsavel})</li>
        <li>👥 Auxiliares: ${auxiliares}</li>
        <li>📝 Descrição QRU: ${descricaoQru}</li>
    `;

    // Listar crimes separados
    if (crimesAfiancaveisTexto) {
        fichaHTML += `<li>⚖️ Crimes Afiançáveis: ${crimesAfiancaveisTexto}</li>`;
    }
    if (crimesInafiancaveisTexto) {
        fichaHTML += `<li>⚖️ Crimes Inafiançáveis: ${crimesInafiancaveisTexto}</li>`;
    }

    fichaHTML += `<li>⏰ Pena Base Total (Geral): ${totalMesesBaseGeral} meses</li>`;
    fichaHTML += `<li>ℹ️ Atenuantes/Agravantes Aplicados: ${motivosTexto}</li>`;

    if (!desacatoSelecionado) {
        fichaHTML += `<li>🧮 Modificador Total: ${modificadorPercentualTotal}%</li>`;
    }

    // Pena Final
    fichaHTML += `<li>${textoPenaFinal} ${penaFinalExibida} meses</li>`;

    if (textoDesacato) {
        fichaHTML += `<li>${textoDesacato}</li>`;
    }

    // Informações de Fiança
    if (crimesAfiancaveis.length > 0) {
        fichaHTML += `<li>💰 Valor da Fiança (Crimes Afiançáveis): R$ ${totalFiancaAfiancaveis.toLocaleString("pt-BR")}</li>`;
        fichaHTML += `<li>${fiancaPaga ? "✅" : "❌"} Fiança Paga: ${fiancaPagaTexto}</li>`;
        if (fiancaPaga) {
             fichaHTML += `<li>🔓 <strong>Status:</strong> Liberado sob fiança de R$ ${totalFiancaAfiancaveis.toLocaleString("pt-BR")} (referente aos crimes afiançáveis). Pena final acima considera apenas crimes inafiançáveis.</li>`;
        }
    }
    if (crimesInafiancaveis.length > 0 && crimesAfiancaveis.length === 0) {
        // Só inafiançáveis
        fichaHTML += `<li>🚫 Fiança: Não aplicável (Todos os crimes selecionados são inafiançáveis). Suspeito deve ser preso.</li>`;
    } else if (crimesInafiancaveis.length > 0 && crimesAfiancaveis.length > 0 && !fiancaPaga) {
        // Mistos, fiança não paga
         fichaHTML += `<li>⚠️ Atenção: Há crimes inafiançáveis. Mesmo pagando a fiança dos crimes afiançáveis, o suspeito permanecerá preso pelos inafiançáveis.</li>`;
    }

    document.getElementById("detalhes-ficha").innerHTML = fichaHTML;

    mostrarToast("Pena calculada com sucesso!", "success");
    document.querySelector(".resultado-section").scrollIntoView({ behavior: "smooth" });
}


// Copiar resultado para a área de transferência com emojis
function copiarResultado() {
    const resultado = document.getElementById("detalhes-ficha");
    let textoResultado = "";

    resultado.querySelectorAll("li").forEach(item => {
        // Pega o texto completo do item, que já inclui o emoji
        textoResultado += item.textContent.trim() + "\n";
    });

    navigator.clipboard.writeText(textoResultado.trim())
        .then(() => {
            mostrarToast("Resultado copiado! Campos limpos.", "success");
            limparResultado(); // Limpar campos após copiar com sucesso
        })
        .catch(err => {
            console.error("Erro ao copiar texto: ", err);
            mostrarToast("Erro ao copiar resultado.", "error");
        });
}

// Limpar resultado e formulário
function limparResultado(mostrarMsg = true) { // Adicionado parâmetro para controlar toast
    // Limpar campos do formulário
    document.getElementById("nome-acusado").value = "";
    document.getElementById("id-acusado").value = "";
    document.getElementById("nome-responsavel").value = "";
    document.getElementById("id-responsavel").value = "";
    document.getElementById("auxiliares").value = "";
    document.getElementById("descricao-qru").value = "";
    document.getElementById("fianca-paga").checked = false;
    document.getElementById("char-count").textContent = "0";
    document.getElementById("pesquisar-crimes").value = "";

    // Desmarcar todos os crimes na lista principal
    document.querySelectorAll("#crimes-list input[type=\"checkbox\"]").forEach(checkbox => {
        checkbox.checked = false;
        const li = checkbox.closest("li");
        if (li) {
            li.classList.remove("selected");
            const quantidadeInput = li.querySelector(".quantidade-input");
            if (quantidadeInput) {
                quantidadeInput.style.display = "none";
                const input = quantidadeInput.querySelector("input");
                if (input) input.value = "";
            }
        }
    });
    
    // Limpar array de crimes selecionados e atualizar lista visual
    crimesSelecionados = [];
    atualizarListaCrimesSelecionados();

    // Resetar filtro para "todos" e atualizar cabeçalho
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(".tab-btn[data-category=\"todos\"]").classList.add("active");
    filtrarPorCategoria("todos"); 

    // Desmarcar todos os atenuantes/agravantes
    document.querySelectorAll("#atenuantes-list input[type=\"checkbox\"]").forEach(checkbox => {
        checkbox.checked = false;
    });

    // Limpar array de atenuantes/agravantes
    atenuantesAgravantesSelecionados = [];

    // Resetar resultado com emojis e estrutura inicial
    document.getElementById("detalhes-ficha").innerHTML = `
        <li>👤 Nome do Acusado: Não informado</li>
        <li>🆔 ID do Acusado: Não informado</li>
        <li>👮 Responsável pela Prisão: Não informado</li>
        <li>👥 Auxiliares: Não informado</li>
        <li>📝 Descrição QRU: Não informado</li>
        <li>⚖️ Crimes Cometidos: Nenhum</li>
        <li>⏰ Pena Base Total (Geral): 0 meses</li>
        <li>ℹ️ Atenuantes/Agravantes Aplicados: Nenhum</li>
        <li>🧮 Modificador Total: 0%</li>
        <li>📅 Pena Final Aplicada: 0 meses</li>
        <li>💰 Valor da Fiança (Crimes Afiançáveis): R$ 0</li>
        <li>❌ Fiança Paga: Não</li>
    `;

    // Mostrar notificação se solicitado
    if (mostrarMsg) {
        mostrarToast("Formulário e resultado limpos com sucesso!", "success");
    }
}

// Mostrar notificação toast
function mostrarToast(mensagem, tipo) {
    // Remover toast existente
    const toastExistente = document.querySelector(".toast");
    if (toastExistente) {
        toastExistente.remove();
    }

    // Criar novo toast
    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;

    document.body.appendChild(toast);

    // Mostrar toast
    setTimeout(() => {
        toast.classList.add("show");
    }, 10);

    // Ocultar toast após 3 segundos
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

