// Variáveis globais
let crimesData = null;
let crimesSelecionados = [];
let atenuantesSelecionados = [];

// Elementos DOM
document.addEventListener('DOMContentLoaded', () => {
    // Carregar dados dos crimes
    fetch('crimes_data.json')
        .then(response => response.json())
        .then(data => {
            crimesData = data;
            inicializarCalculadora();
        })
        .catch(error => {
            console.error('Erro ao carregar dados dos crimes:', error);
            mostrarToast('Erro ao carregar dados dos crimes. Tente novamente.', 'error');
        });

    // Inicializar contagem de caracteres para descrição QRU
    const descricaoQru = document.getElementById('descricao-qru');
    const charCount = document.getElementById('char-count');
    
    descricaoQru.addEventListener('input', () => {
        const count = descricaoQru.value.length;
        charCount.textContent = count;
        
        if (count >= 1000) {
            charCount.style.color = 'red';
        } else {
            charCount.style.color = '';
        }
    });

    // Botões de ação
    document.getElementById('calcular-pena').addEventListener('click', calcularPena);
    document.getElementById('copiar-resultado').addEventListener('click', copiarResultado);
    document.getElementById('limpar-resultado').addEventListener('click', limparResultado);
    
    // Pesquisa de crimes
    document.getElementById('pesquisar-crimes').addEventListener('input', filtrarCrimes);
    
    // Tabs de categorias
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtrarPorCategoria(btn.dataset.category);
        });
    });
});

// Inicializar a calculadora
function inicializarCalculadora() {
    carregarCrimes();
    carregarAtenuantes();
}

// Verificar se o crime requer campo de quantidade
function verificarCrimeComQuantidade(observacoes) {
    if (!observacoes) return false;
    
    const termos = [
        'unidade', 'cada', 'por', 'à cada', 'para cada', 'acima', 
        'mais', 'por arma', 'por vitima', 'por pessoa'
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
                    tipo: 'unidade'
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
                    tipo: matches[0].includes('arma') ? 'arma' : 
                          matches[0].includes('vitima') || matches[0].includes('vítima') ? 'vitima' : 
                          matches[0].includes('orgão') || matches[0].includes('órgão') ? 'orgao' : 'pessoa'
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
                    tipo: 'lote'
                };
            }
        },
        // Mais X mês para cada Y de dinheiro
        {
            regex: /mais\s+(\d+)(?:\s+mês|\s+meses)?\s+(?:para cada|à cada|por)\s+(\d+(?:\.\d+)?)\s+de\s+dinheiro/i,
            processar: (matches) => {
                return {
                    acrescimo: parseInt(matches[1]) || 0,
                    porQuantidade: parseInt(matches[2].replace(/\./g, '')) || 1,
                    tipo: 'dinheiro'
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
    if (obsLower.includes('tráfico de drogas') && obsLower.includes('a partir de 6 unidades')) {
        return {
            acrescimo: 2,
            porQuantidade: 1,
            tipo: 'unidade',
            quantidadeBase: 6
        };
    }
    
    if (obsLower.includes('mais 1 mês para cada 5.000 de dinheiro')) {
        return {
            acrescimo: 1,
            porQuantidade: 5000,
            tipo: 'dinheiro'
        };
    }
    
    // Regra padrão se não conseguir extrair
    return {
        acrescimo: 1,
        porQuantidade: 1,
        tipo: 'unidade'
    };
}

// Carregar crimes na lista
function carregarCrimes() {
    const crimesList = document.getElementById('crimes-list');
    crimesList.innerHTML = '';
    
    // Criar elementos para cada categoria
    Object.keys(crimesData.categorias).forEach(categoria => {
        const crimes = crimesData.crimes[categoria] || [];
        if (crimes.length === 0) return;
        
        // Adicionar cabeçalho da categoria
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.textContent = crimesData.categorias[categoria];
        categoryHeader.dataset.category = categoria;
        crimesList.appendChild(categoryHeader);
        
        // Adicionar crimes da categoria
        crimes.forEach(crime => {
            if (!crime.crime || crime.crime === '') return;
            
            const li = document.createElement('li');
            li.dataset.categoria = categoria;
            li.dataset.codigo = crime.codigo;
            li.dataset.numArtigo = crime.num_artigo;
            li.dataset.meses = crime.meses;
            li.dataset.fianca = crime.valor_fianca;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `crime-${crime.num_artigo}`;
            
            // Verificar se o crime requer campo de quantidade
            const requerQuantidade = verificarCrimeComQuantidade(crime.observacoes);
            if (requerQuantidade) {
                li.dataset.requerQuantidade = 'true';
                
                // Extrair regra de quantidade
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
            
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    li.classList.add('selected');
                    
                    // Adicionar crime aos selecionados
                    const crimeSelecionado = {
                        codigo: crime.codigo,
                        crime: crime.crime,
                        meses: crime.meses,
                        fianca: crime.valor_fianca,
                        numArtigo: crime.num_artigo
                    };
                    
                    // Se requer quantidade, mostrar o campo
                    if (requerQuantidade) {
                        const quantidadeInput = li.querySelector('.quantidade-input');
                        if (quantidadeInput) {
                            quantidadeInput.style.display = 'block';
                            crimeSelecionado.requerQuantidade = true;
                            crimeSelecionado.acrescimo = parseInt(li.dataset.acrescimo) || 0;
                            crimeSelecionado.porQuantidade = parseInt(li.dataset.porQuantidade) || 1;
                            crimeSelecionado.tipoQuantidade = li.dataset.tipoQuantidade;
                            if (li.dataset.quantidadeBase) {
                                crimeSelecionado.quantidadeBase = parseInt(li.dataset.quantidadeBase);
                            }
                        }
                    }
                    
                    crimesSelecionados.push(crimeSelecionado);
                } else {
                    li.classList.remove('selected');
                    
                    // Se requer quantidade, esconder o campo
                    if (requerQuantidade) {
                        const quantidadeInput = li.querySelector('.quantidade-input');
                        if (quantidadeInput) {
                            quantidadeInput.style.display = 'none';
                            quantidadeInput.querySelector('input').value = '';
                        }
                    }
                    
                    crimesSelecionados = crimesSelecionados.filter(c => c.codigo !== crime.codigo);
                }
            });
            
            const label = document.createElement('label');
            label.htmlFor = `crime-${crime.num_artigo}`;
            label.className = 'crime-info';
            
            const title = document.createElement('div');
            title.className = 'crime-title';
            title.textContent = `${crime.codigo} - ${crime.crime}`;
            
            const details = document.createElement('div');
            details.className = 'crime-details';
            
            // Adicionar detalhes do crime
            let detailsText = '';
            if (crime.tempo && crime.tempo !== '0' && crime.tempo !== '-') {
                detailsText += `Tempo: ${crime.tempo}`;
            }
            if (crime.fianca && crime.fianca !== '0' && crime.fianca !== 'N/T') {
                if (detailsText) detailsText += ' | ';
                detailsText += `Fiança: ${crime.fianca}`;
            }
            if (crime.observacoes && crime.observacoes !== '-') {
                if (detailsText) detailsText += ' | ';
                detailsText += `Obs: ${crime.observacoes}`;
            }
            
            details.textContent = detailsText || 'Sem detalhes adicionais';
            
            label.appendChild(title);
            label.appendChild(details);
            
            li.appendChild(checkbox);
            li.appendChild(label);
            
            // Adicionar campo de quantidade se necessário
            if (requerQuantidade) {
                const quantidadeInput = document.createElement('div');
                quantidadeInput.className = 'quantidade-input';
                quantidadeInput.style.display = 'none';
                
                const input = document.createElement('input');
                input.type = 'number';
                input.min = '0';
                input.placeholder = 'Quantidade';
                input.className = 'quantidade';
                input.id = `quantidade-${crime.num_artigo}`;
                
                // Determinar o texto do label baseado no tipo
                let labelText = 'Quantidade:';
                const tipoQuantidade = li.dataset.tipoQuantidade;
                if (tipoQuantidade === 'arma') {
                    labelText = 'Quantidade de armas:';
                } else if (tipoQuantidade === 'vitima') {
                    labelText = 'Quantidade de vítimas:';
                } else if (tipoQuantidade === 'pessoa') {
                    labelText = 'Quantidade de pessoas:';
                } else if (tipoQuantidade === 'dinheiro') {
                    labelText = 'Quantidade de dinheiro:';
                } else if (tipoQuantidade === 'orgao') {
                    labelText = 'Quantidade de órgãos:';
                } else if (tipoQuantidade === 'lote') {
                    labelText = `Quantidade (lotes de ${li.dataset.porQuantidade}):`;
                }
                
                const inputLabel = document.createElement('label');
                inputLabel.htmlFor = `quantidade-${crime.num_artigo}`;
                inputLabel.textContent = labelText;
                
                // Adicionar evento para atualizar o crime selecionado quando a quantidade mudar
                input.addEventListener('input', () => {
                    const quantidade = parseInt(input.value) || 0;
                    const crimeSelecionado = crimesSelecionados.find(c => c.codigo === crime.codigo);
                    if (crimeSelecionado) {
                        crimeSelecionado.quantidade = quantidade;
                    }
                });
                
                quantidadeInput.appendChild(inputLabel);
                quantidadeInput.appendChild(input);
                li.appendChild(quantidadeInput);
            }
            
            crimesList.appendChild(li);
        });
    });
}

// Carregar atenuantes
function carregarAtenuantes() {
    const atenuantesList = document.getElementById('atenuantes-list');
    atenuantesList.innerHTML = '';
    
    crimesData.atenuantes.forEach(atenuante => {
        if (!atenuante.descricao || atenuante.descricao === '') return;
        
        const li = document.createElement('li');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `atenuante-${atenuante.codigo.replace(/\s+/g, '-').toLowerCase()}`;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                atenuantesSelecionados.push({
                    codigo: atenuante.codigo,
                    descricao: atenuante.descricao,
                    reducao: atenuante.reducao
                });
            } else {
                atenuantesSelecionados = atenuantesSelecionados.filter(a => a.codigo !== atenuante.codigo);
            }
        });
        
        const label = document.createElement('label');
        label.htmlFor = `atenuante-${atenuante.codigo.replace(/\s+/g, '-').toLowerCase()}`;
        label.textContent = `${atenuante.codigo} ${atenuante.descricao}`;
        
        li.appendChild(checkbox);
        li.appendChild(label);
        atenuantesList.appendChild(li);
    });
}

// Filtrar crimes por texto de pesquisa
function filtrarCrimes() {
    const searchText = document.getElementById('pesquisar-crimes').value.toLowerCase();
    const crimeItems = document.querySelectorAll('#crimes-list li');
    const categoryHeaders = document.querySelectorAll('.category-header');
    
    // Resetar visibilidade das categorias
    categoryHeaders.forEach(header => {
        header.style.display = 'block';
    });
    
    // Filtrar itens
    let visibleItemsCount = 0;
    crimeItems.forEach(item => {
        const crimeInfo = item.querySelector('.crime-info').textContent.toLowerCase();
        if (crimeInfo.includes(searchText)) {
            item.style.display = 'flex';
            visibleItemsCount++;
        } else {
            item.style.display = 'none';
        }
    });
    
    // Ocultar cabeçalhos de categorias sem itens visíveis
    categoryHeaders.forEach(header => {
        const categoria = header.dataset.category;
        const categoryItems = document.querySelectorAll(`#crimes-list li[data-categoria="${categoria}"]`);
        
        let hasVisibleItems = false;
        categoryItems.forEach(item => {
            if (item.style.display !== 'none') {
                hasVisibleItems = true;
            }
        });
        
        if (!hasVisibleItems) {
            header.style.display = 'none';
        }
    });
    
    // Mostrar mensagem se não houver resultados
    const emptyState = document.querySelector('.empty-state');
    if (visibleItemsCount === 0 && searchText) {
        if (!emptyState) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<i class="fas fa-search"></i><p>Nenhum crime encontrado para esta pesquisa.</p>';
            document.querySelector('.crimes-list-container').appendChild(empty);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

// Filtrar crimes por categoria
function filtrarPorCategoria(categoria) {
    const crimeItems = document.querySelectorAll('#crimes-list li');
    const categoryHeaders = document.querySelectorAll('.category-header');
    
    if (categoria === 'todos') {
        crimeItems.forEach(item => {
            item.style.display = 'flex';
        });
        categoryHeaders.forEach(header => {
            header.style.display = 'block';
        });
    } else {
        crimeItems.forEach(item => {
            if (item.dataset.categoria === categoria) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
        
        categoryHeaders.forEach(header => {
            if (header.dataset.category === categoria) {
                header.style.display = 'block';
            } else {
                header.style.display = 'none';
            }
        });
    }
    
    // Aplicar também o filtro de pesquisa
    const searchText = document.getElementById('pesquisar-crimes').value;
    if (searchText) {
        filtrarCrimes();
    }
}

// Calcular a pena
function calcularPena() {
    // Validar campos obrigatórios
    const nomeAcusado = document.getElementById('nome-acusado').value;
    const idAcusado = document.getElementById('id-acusado').value;
    const nomeResponsavel = document.getElementById('nome-responsavel').value;
    const idResponsavel = document.getElementById('id-responsavel').value;
    const auxiliares = document.getElementById('auxiliares').value;
    
    if (!nomeAcusado || !idAcusado || !nomeResponsavel || !idResponsavel || !auxiliares) {
        mostrarToast('Preencha todos os campos obrigatórios.', 'error');
        return;
    }
    
    // Verificar se há crimes selecionados
    if (crimesSelecionados.length === 0) {
        mostrarToast('Selecione pelo menos um crime.', 'error');
        return;
    }
    
    // Calcular totais
    let totalMeses = 0;
    let totalFianca = 0;
    let crimesList = '';
    
    crimesSelecionados.forEach(crime => {
        let mesesCrime = parseInt(crime.meses) || 0;
        
        // Calcular acréscimo por quantidade, se aplicável
        if (crime.requerQuantidade && crime.quantidade) {
            let quantidade = parseInt(crime.quantidade) || 0;
            let acrescimo = parseInt(crime.acrescimo) || 0;
            let porQuantidade = parseInt(crime.porQuantidade) || 1;
            
            // Se tem quantidade base, considerar apenas o excedente
            if (crime.quantidadeBase) {
                if (quantidade > crime.quantidadeBase) {
                    const excedente = quantidade - crime.quantidadeBase;
                    const acrescimoTotal = Math.floor(excedente / porQuantidade) * acrescimo;
                    mesesCrime += acrescimoTotal;
                    crimesList += `${crime.codigo} - ${crime.crime} (${quantidade} unidades, +${acrescimoTotal} meses), `;
                } else {
                    crimesList += `${crime.codigo} - ${crime.crime} (${quantidade} unidades), `;
                }
            } else {
                // Cálculo padrão: quantidade / porQuantidade * acrescimo
                const acrescimoTotal = Math.floor(quantidade / porQuantidade) * acrescimo;
                mesesCrime += acrescimoTotal;
                crimesList += `${crime.codigo} - ${crime.crime} (${quantidade} ${crime.tipoQuantidade || 'unidades'}, +${acrescimoTotal} meses), `;
            }
        } else {
            crimesList += `${crime.codigo} - ${crime.crime}, `;
        }
        
        totalMeses += mesesCrime;
        totalFianca += parseInt(crime.fianca) || 0;
    });
    
    // Remover a última vírgula
    crimesList = crimesList.slice(0, -2);
    
    // Calcular redução por atenuantes
    let percentualReducao = 0;
    let motivosReducao = '';
    
    atenuantesSelecionados.forEach(atenuante => {
        let reducao = 0;
        if (atenuante.reducao.includes('%')) {
            reducao = parseInt(atenuante.reducao) || 0;
        } else {
            // Tentar extrair percentual
            const match = atenuante.reducao.match(/(\d+)/);
            if (match) {
                reducao = parseInt(match[1]) || 0;
            }
        }
        
        percentualReducao += reducao;
        motivosReducao += `${atenuante.codigo} ${atenuante.descricao}, `;
    });
    
    // Limitar redução máxima a 70%
    if (percentualReducao > 70) {
        percentualReducao = 70;
    }
    
    // Remover a última vírgula dos motivos
    motivosReducao = motivosReducao ? motivosReducao.slice(0, -2) : 'Nenhum';
    
    // Calcular pena reduzida
    const totalMesesReduzidos = Math.round(totalMeses * (1 - percentualReducao / 100));
    
    // Verificar se a fiança foi paga
    const fiancaPaga = document.getElementById('fianca-paga').checked ? 'Sim' : 'Não';
    
    // Obter descrição QRU
    const descricaoQru = document.getElementById('descricao-qru').value || 'Não informado';
    
    // Atualizar ficha criminal
    document.getElementById('detalhes-ficha').innerHTML = `
        <li><i class="fas fa-user"></i> Nome do Acusado: ${nomeAcusado}</li>
        <li><i class="fas fa-id-card"></i> ID do Acusado: ${idAcusado}</li>
        <li><i class="fas fa-user-shield"></i> Responsável pela Prisão: ${nomeResponsavel} (ID: ${idResponsavel})</li>
        <li><i class="fas fa-clock"></i> Total da Pena: ${totalMeses} meses</li>
        <li><i class="fas fa-chart-line"></i> Redução Aplicada: ${percentualReducao}%</li>
        <li><i class="fas fa-calendar-alt"></i> Total da Pena Reduzida: ${totalMesesReduzidos} meses</li>
        <li><i class="fas fa-info-circle"></i> Pena reduzida pelo(s) motivo(s): ${motivosReducao}</li>
        <li><i class="fas fa-money-bill-wave"></i> Total de Multa: R$ ${totalFianca.toLocaleString('pt-BR')}</li>
        <li><i class="fas fa-hand-holding-usd"></i> Valor da Fiança Total: R$ ${totalFianca.toLocaleString('pt-BR')}</li>
        <li><i class="fas fa-money-check"></i> Fiança Paga: ${fiancaPaga}</li>
        <li><i class="fas fa-balance-scale"></i> Crimes Cometidos: ${crimesList}</li>
        <li><i class="fas fa-users"></i> Auxiliares: ${auxiliares}</li>
        <li><i class="fas fa-file-alt"></i> Descrição QRU: ${descricaoQru}</li>
    `;
    
    // Mostrar notificação de sucesso
    mostrarToast('Pena calculada com sucesso!', 'success');
    
    // Rolar até a seção de resultado
    document.querySelector('.resultado-section').scrollIntoView({ behavior: 'smooth' });
}

// Copiar resultado para a área de transferência
function copiarResultado() {
    const resultado = document.getElementById('detalhes-ficha');
    let textoResultado = '';
    
    resultado.querySelectorAll('li').forEach(item => {
        textoResultado += item.textContent + '\n';
    });
    
    navigator.clipboard.writeText(textoResultado)
        .then(() => {
            mostrarToast('Resultado copiado para a área de transferência!', 'success');
        })
        .catch(err => {
            console.error('Erro ao copiar texto: ', err);
            mostrarToast('Erro ao copiar resultado.', 'error');
        });
}

// Limpar resultado e formulário
function limparResultado() {
    // Limpar campos do formulário
    document.getElementById('nome-acusado').value = '';
    document.getElementById('id-acusado').value = '';
    document.getElementById('nome-responsavel').value = '';
    document.getElementById('id-responsavel').value = '';
    document.getElementById('auxiliares').value = '';
    document.getElementById('descricao-qru').value = '';
    document.getElementById('fianca-paga').checked = false;
    document.getElementById('char-count').textContent = '0';
    
    // Desmarcar todos os crimes
    document.querySelectorAll('#crimes-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });
    document.querySelectorAll('#crimes-list li').forEach(li => {
        li.classList.remove('selected');
        
        // Esconder e limpar campos de quantidade
        const quantidadeInput = li.querySelector('.quantidade-input');
        if (quantidadeInput) {
            quantidadeInput.style.display = 'none';
            const input = quantidadeInput.querySelector('input');
            if (input) input.value = '';
        }
    });
    
    // Desmarcar todos os atenuantes
    document.querySelectorAll('#atenuantes-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Limpar arrays
    crimesSelecionados = [];
    atenuantesSelecionados = [];
    
    // Resetar resultado
    document.getElementById('detalhes-ficha').innerHTML = `
        <li><i class="fas fa-user"></i> Nome do Acusado: Não informado</li>
        <li><i class="fas fa-id-card"></i> ID do Acusado: Não informado</li>
        <li><i class="fas fa-user-shield"></i> Responsável pela Prisão: Não informado</li>
        <li><i class="fas fa-clock"></i> Total da Pena: 0 meses</li>
        <li><i class="fas fa-chart-line"></i> Redução Aplicada: 0%</li>
        <li><i class="fas fa-calendar-alt"></i> Total da Pena Reduzida: 0 meses</li>
        <li><i class="fas fa-info-circle"></i> Pena reduzida pelo(s) motivo(s): Nenhum</li>
        <li><i class="fas fa-money-bill-wave"></i> Total de Multa: R$ 0</li>
        <li><i class="fas fa-hand-holding-usd"></i> Valor da Fiança Total: R$ 0</li>
        <li><i class="fas fa-money-check"></i> Fiança Paga: Não</li>
        <li><i class="fas fa-balance-scale"></i> Crimes Cometidos: Nenhum</li>
        <li><i class="fas fa-users"></i> Auxiliares: Não informado</li>
        <li><i class="fas fa-file-alt"></i> Descrição QRU: Não informado</li>
    `;
    
    // Mostrar notificação
    mostrarToast('Formulário e resultado limpos com sucesso!', 'success');
}

// Mostrar notificação toast
function mostrarToast(mensagem, tipo) {
    // Remover toast existente
    const toastExistente = document.querySelector('.toast');
    if (toastExistente) {
        toastExistente.remove();
    }
    
    // Criar novo toast
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;
    
    document.body.appendChild(toast);
    
    // Mostrar toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Ocultar toast após 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}
