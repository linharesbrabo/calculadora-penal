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

// Atualizar a lista de atenuantes/agravantes selecionados na interface
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
        atenuanteInfoDiv.className = "crime-info";

        const title = document.createElement("div");
        title.className = "crime-title";
        title.textContent = `${atenuante.codigo} - ${atenuante.descricao}`;

        // Botão para remover (desmarcar)
        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-crime-btn";
        removeBtn.innerHTML = "&times;"; // Ícone 'x'
        removeBtn.title = "Remover atenuante/agravante";
        removeBtn.onclick = () => {
            // Encontrar o checkbox correspondente na lista principal e desmarcá-lo
            const mainCheckbox = document.querySelector(`#atenuante-${atenuante.codigo.replace(/\s+|º|\./g, "-").toLowerCase()}`); // CORRIGIDO: Adicionado \. para corresponder à geração de ID
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
        const regraTexto = item.reducao || "Regra não encontrada"; // Usar 'reducao' como texto da regra

        li.dataset.codigo = codigoRegra;
        li.dataset.regra = regraTexto;
        li.dataset.descricao = item.descricao;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `atenuante-${codigoRegra.replace(/\s+|º|\./g, "-").toLowerCase()}`;
        checkbox.dataset.codigo = codigoRegra; // Adicionar data-codigo para fácil acesso

        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                atenuantesAgravantesSelecionados.push({
                    codigo: codigoRegra,
                    descricao: item.descricao,
                    regra: regraTexto
                });

                // Lógica especial para AC Nº03 - Adicionar automaticamente o crime ART. 028
                if (codigoRegra === "AC Nº03") {
                    const crimeDesobediencia = findCrimeByArtigo("028");
                    if (crimeDesobediencia) {
                        const jaSelecionado = crimesSelecionados.some(c => c.numArtigo === "028");
                        if (!jaSelecionado) {
                            const mainCheckbox = document.getElementById(`crime-028`);
                            if (mainCheckbox) {
                                mainCheckbox.checked = true;
                                mainCheckbox.dispatchEvent(new Event('change'));
                            }
                        }
                    }
                }
                // *** NEW LOGIC FOR RAA Nº08 ***
                else if (codigoRegra === "RAA Nº08") {
                    const crimeArt57 = findCrimeByArtigo("057"); // Use existing helper function
                    if (crimeArt57) {
                        const crimeCheckbox = document.getElementById(`crime-${crimeArt57.num_artigo}`); // Should be crime-057
                        if (crimeCheckbox && !crimeCheckbox.checked) {
                            crimeCheckbox.checked = true;
                            // Dispatch change event to add crime 057 to selected list and update UI
                            crimeCheckbox.dispatchEvent(new Event('change'));
                            mostrarToast("Artigo 57 (Desacato) adicionado automaticamente devido à seleção do RAA Nº08.", "info");
                        }
                    } else {
                         console.warn("Crime com Artigo 057 não encontrado para adicionar automaticamente.");
                    }
                }

            } else {
                atenuantesAgravantesSelecionados = atenuantesAgravantesSelecionados.filter(a => a.codigo !== codigoRegra);

                // Lógica especial para AC Nº03 - Remover automaticamente o crime ART. 028
                if (codigoRegra === "AC Nº03") {
                    const crimeIndex = crimesSelecionados.findIndex(c => c.numArtigo === "028");
                    if (crimeIndex > -1) {
                        const mainCheckbox = document.getElementById(`crime-028`);
                        if (mainCheckbox) {
                            mainCheckbox.checked = false;
                            mainCheckbox.dispatchEvent(new Event('change'));
                        }
                    }
                }
                // *** NO ACTION NEEDED FOR RAA Nº08 UNCHECK ***
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

// Função auxiliar para encontrar um crime pelo número do artigo
function findCrimeByArtigo(numArtigo) {
    for (const categoria in crimesData.crimes) {
        const crime = crimesData.crimes[categoria].find(c => c.num_artigo === numArtigo);
        if (crime) return crime;
    }
    return null;
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

// Calcular a pena (Refatorado para lógica de fiança mista e regra especial Desacato)
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

    // *** INÍCIO: Regra Especial Desacato ART 57 ***
    const desacatoArt57Presente = crimesSelecionados.some(crime => crime.numArtigo === "057");
    let crimesParaCalculo = [...crimesSelecionados]; // Copia para não modificar o original diretamente
    let penaFinal = 0;
    let totalFiancaAfiancaveis = 0;
    let crimesAfiancaveisTexto = "";
    let crimesInafiancaveisTexto = "";
    let modificadorTotal = 0;
    let atenuantesAplicadosTexto = "";
    let valorFianca = 0;
    let fiancaPaga = false;

    if (desacatoArt57Presente) {
        // Filtrar para manter apenas o Desacato ART 57
        const crimeDesacato = crimesSelecionados.find(crime => crime.numArtigo === "057");
        crimesParaCalculo = [crimeDesacato]; // Apenas o desacato será considerado

        penaFinal = 120; // Pena máxima fixa
        totalFiancaAfiancaveis = 0; // Ignorar fiança
        crimesAfiancaveisTexto = ""; // Nenhum crime afiançável
        crimesInafiancaveisTexto = `${crimeDesacato.codigo} - ${crimeDesacato.crime}`; // Apenas o desacato
        modificadorTotal = 0; // Ignorar modificadores
        atenuantesAplicadosTexto = "Nenhum (Regra Especial Desacato ART 57)"; // Indicar regra especial
        valorFianca = 0; // Fiança não aplicável
        fiancaPaga = false; // Fiança não aplicável

    } else {
        // *** Lógica Normal (sem Desacato ART 57 ou se ele não estiver selecionado) ***

        // Separar crimes afiançáveis e inafiançáveis
        const crimesAfiancaveis = [];
        const crimesInafiancaveis = [];

        crimesParaCalculo.forEach(crime => {
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
                crimeTexto += ` (${quantidade} unidades, +${acrescimoTotal} meses)`;
            }

            if (isAfiancavel) {
                crimesAfiancaveis.push(crime);
                totalFiancaAfiancaveis += fiancaNumerica;
                crimesAfiancaveisTexto += `${crimeTexto}, `;
            } else {
                crimesInafiancaveis.push(crime);
                crimesInafiancaveisTexto += `${crimeTexto}, `;
            }
        });

        // Remover vírgula final
        crimesAfiancaveisTexto = crimesAfiancaveisTexto.replace(/,\s*$/, "");
        crimesInafiancaveisTexto = crimesInafiancaveisTexto.replace(/,\s*$/, "");

        // Calcular pena base total
        const penaBaseTotal = calcularPenaBase(crimesParaCalculo);

        // Calcular modificadores de atenuantes/agravantes
        atenuantesAgravantesSelecionados.forEach(atenuante => {
            const percentual = extrairPercentualRegra(atenuante.regra);
            modificadorTotal += percentual;
            atenuantesAplicadosTexto += `${atenuante.codigo} - ${atenuante.descricao}, `;
        });

        // Remover vírgula final
        atenuantesAplicadosTexto = atenuantesAplicadosTexto.replace(/,\s*$/, "");
        if (!atenuantesAplicadosTexto) atenuantesAplicadosTexto = "Nenhum";

        // Calcular pena final com modificadores
        penaFinal = penaBaseTotal;

        // Verificar se AC Nº02 está selecionado para aplicar pena máxima de 120 meses
        const acN02Selecionado = atenuantesAgravantesSelecionados.some(atenuante => atenuante.codigo === "AC Nº02");

        if (acN02Selecionado) {
            // Se AC Nº02 está selecionado, definir pena final como 120 meses independentemente de outros cálculos
            penaFinal = 120;
        } else if (modificadorTotal !== 0) {
            // Caso contrário, aplicar os modificadores normalmente
            penaFinal = Math.max(0, Math.round(penaBaseTotal * (1 + modificadorTotal / 100)));
        }

        // Garantir que a pena final não exceda 120 meses
        penaFinal = Math.min(penaFinal, 120);

        // Verificar se a fiança foi paga
        fiancaPaga = document.getElementById("fianca-paga").checked;

        // Calcular valor da fiança (50% do valor total para crimes afiançáveis)
        valorFianca = Math.round(totalFiancaAfiancaveis * 0.5);
    }
    // *** FIM: Regra Especial Desacato ART 57 e Lógica Normal ***

    // Gerar texto de crimes cometidos (usando os textos já definidos acima)
    let crimesCometidosTexto = "";
    if (crimesAfiancaveisTexto && crimesInafiancaveisTexto) {
        crimesCometidosTexto = `Afiançáveis: ${crimesAfiancaveisTexto}; Inafiançáveis: ${crimesInafiancaveisTexto}`;
    } else if (crimesAfiancaveisTexto) {
        crimesCometidosTexto = `Afiançáveis: ${crimesAfiancaveisTexto}`;
    } else if (crimesInafiancaveisTexto) {
        crimesCometidosTexto = `Inafiançáveis: ${crimesInafiancaveisTexto}`;
    } else {
        // Caso especial: Apenas Desacato foi selecionado
        if (desacatoArt57Presente) {
             const crimeDesacato = crimesSelecionados.find(crime => crime.numArtigo === "057");
             crimesCometidosTexto = `Inafiançável: ${crimeDesacato.codigo} - ${crimeDesacato.crime}`;
        } else {
            crimesCometidosTexto = "Nenhum";
        }
    }

    // *** NEW: Calculate Accomplice Penalty if RAA Nº06 is selected ***
    let penaCumplice = null;
    const raa06Selecionado = atenuantesAgravantesSelecionados.some(atenuante => atenuante.codigo === "RAA Nº06");
    if (raa06Selecionado) {
        penaCumplice = Math.round(penaFinal * 0.5);
    }

    // Obter descrição da QRU
    const descricaoQru = document.getElementById("descricao-qru").value || "Não informado";

    // Atualizar ficha criminal
    const detalhesFicha = document.getElementById("detalhes-ficha");
    detalhesFicha.innerHTML = `
        <li>👤 Nome do Acusado: ${nomeAcusado}</li>
        <li>🆔 ID do Acusado: ${idAcusado}</li>
        <li>👮 Responsável pela Prisão: ${nomeResponsavel} #${idResponsavel}</li>
        <li>👥 Auxiliares: ${auxiliares}</li>
        <li>📝 Descrição QRU: ${descricaoQru}</li>
        <li>⚖️ Crimes Cometidos: ${crimesCometidosTexto}</li>
        <li>ℹ️ Atenuantes/Agravantes Aplicados: ${atenuantesAplicadosTexto}</li>
        <li>🧮 Modificador Total: ${modificadorTotal}%</li>
        <li>📅 Pena Final Aplicada: ${penaFinal} meses</li>
        ${penaCumplice !== null ? `<li>🤝 Pena para Cúmplice (RAA Nº06): ${penaCumplice} meses (50% da Pena Final)</li>` : ''}
        <li>💰 Valor da Fiança (Base): R$ ${valorFianca}</li>
        <li>❌ Fiança Paga: ${fiancaPaga ? "Sim" : "Não"}</li>
    `;

    mostrarToast("Pena calculada com sucesso!", "success");
}

// Copiar resultado para a área de transferência
function copiarResultado() {
    const resultado = document.getElementById("resultado-ficha").innerText;

    // Usar a API de clipboard moderna
    if (navigator.clipboard) {
        navigator.clipboard.writeText(resultado)
            .then(() => {
                mostrarToast("Ficha criminal copiada para a área de transferência!", "success");
            })
            .catch(err => {
                console.error('Erro ao copiar: ', err);
                mostrarToast("Erro ao copiar. Tente novamente.", "error");
            });
    } else {
        // Fallback para método mais antigo
        const textarea = document.createElement('textarea');
        textarea.value = resultado;
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
            mostrarToast("Ficha criminal copiada para a área de transferência!", "success");
        } catch (err) {
            console.error('Erro ao copiar: ', err);
            mostrarToast("Erro ao copiar. Tente novamente.", "error");
        }

        document.body.removeChild(textarea);
    }
}

// Limpar resultado e seleções
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

    // Resetar ficha criminal
    const detalhesFicha = document.getElementById("detalhes-ficha");
    detalhesFicha.innerHTML = `
        <li>👤 Nome do Acusado: Não informado</li>
        <li>🆔 ID do Acusado: Não informado</li>
        <li>👮 Responsável pela Prisão: Não informado</li>
        <li>👥 Auxiliares: Não informado</li>
        <li>📝 Descrição QRU: Não informado</li>
        <li>⚖️ Crimes Cometidos: Nenhum</li>
        <li>ℹ️ Atenuantes/Agravantes Aplicados: Nenhum</li>
        <li>🧮 Modificador Total: 0%</li>
        <li>📅 Pena Final Aplicada: 0 meses</li>
        <li>💰 Valor da Fiança (Base): R$ 0</li>
        <li>❌ Fiança Paga: Não</li>
    `;

    if (showToast) {
        mostrarToast("Todos os campos foram limpos!", "success");
    }
}

// Exibir toast de notificação
function mostrarToast(mensagem, tipo) {
    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;

    document.body.appendChild(toast);

    // Forçar reflow para garantir que a transição funcione
    toast.offsetHeight;

    // Mostrar toast
    toast.classList.add("show");

    // Remover após 3 segundos
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300); // Tempo da transição
    }, 3000);
}

