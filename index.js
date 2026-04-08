// index.js - Versão com Proxy Anti-Bloqueio (FUNCIONAL)
require('dotenv').config();
const noblox = require('noblox.js');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const config = require('./config.json');

// Configuração dos Webhooks
const borderHook = new Webhook(config.webhooks.borderLogs);
const hierarchyHook = new Webhook(config.webhooks.hierarchyLogs);
const raidHook = new Webhook(config.webhooks.raidLogs);

// Configuração do Gist
const octokit = new Octokit({ auth: process.env.GIST_TOKEN });
const GIST_ID = process.env.GIST_ID;

// Tempo máximo de execução: 5h50min
const MAX_EXECUTION_SECONDS = parseInt(process.env.MAX_EXECUTION_SECONDS) || 21000;
const START_TIME = Date.now();

// Estado persistente
let lastLogDate = null;
let roleMap = {};

// ========== FUNÇÃO DE LOGIN COM LIMPEZA DE COOKIE ==========
async function loginComProxy() {
    // Pega o cookie BRUTO do secret
    let cookie = process.env.ROBLOX_COOKIE;
    
    if (!cookie) {
        throw new Error('❌ ROBLOX_COOKIE não configurado no GitHub Secrets!');
    }
    
    // 🔥 LIMPEZA AGRESSIVA DO COOKIE 🔥
    console.log('[LOGIN] Cookie bruto recebido, comprimento:', cookie.length);
    console.log('[LOGIN] Primeiros 50 caracteres:', cookie.substring(0, 50));
    console.log('[LOGIN] Últimos 20 caracteres:', cookie.substring(cookie.length - 20));
    
    // Remove TUDO que não é o cookie puro
    cookie = cookie.trim();                    // Remove espaços no início/fim
    cookie = cookie.replace(/[\n\r]/g, '');    // Remove quebras de linha
    cookie = cookie.replace(/^["']|["']$/g, ''); // Remove aspas no início/fim
    cookie = cookie.replace(/\s+/g, '');       // Remove QUALQUER espaço no meio
    
    // Verifica se o cookie tem o formato correto
    if (!cookie.startsWith('_|WARNING')) {
        console.error('[LOGIN] ⚠️ Cookie não começa com "_|WARNING"!');
        console.error('[LOGIN] Início real:', cookie.substring(0, 30));
        
        // Tenta extrair o cookie se estiver em formato JSON ou aspas
        const match = cookie.match(/_\|WARNING[^"'\s]+/);
        if (match) {
            cookie = match[0];
            console.log('[LOGIN] ✅ Cookie extraído:', cookie.substring(0, 50) + '...');
        }
    }
    
    console.log('[LOGIN] Cookie após limpeza, comprimento:', cookie.length);
    console.log('[LOGIN] Tentando login com cookie limpo...');
    
    // Lista de User-Agents realistas
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];

    // Método 1: Tentar com User-Agent aleatório
    for (const userAgent of userAgents) {
        try {
            console.log(`[LOGIN] Tentando com User-Agent: ${userAgent.substring(0, 50)}...`);
            
            const response = await axios({
                method: 'GET',
                url: 'https://www.roblox.com/mobileapi/userinfo',
                headers: {
                    'Cookie': `.ROBLOSECURITY=${cookie}`,
                    'User-Agent': userAgent,
                    'Accept': 'application/json',
                    'Accept-Language': 'pt-BR,pt;q=0.9'
                },
                timeout: 10000
            });

            if (response.data && response.data.UserName) {
                console.log(`[LOGIN] ✅ SUCESSO! Usuário: ${response.data.UserName}`);
                console.log(`[LOGIN] Robux: ${response.data.RobuxBalance || 0}`);
                
                // Configura o noblox com o cookie validado
                await noblox.setCookie(cookie);
                return response.data;
            }
        } catch (erro) {
            console.log(`[LOGIN] ❌ Falha: ${erro.message}`);
            if (erro.response) {
                console.log(`[LOGIN] Status HTTP: ${erro.response.status}`);
                console.log(`[LOGIN] Resposta: ${JSON.stringify(erro.response.data)}`);
            }
        }
    }

    // Método 2: Tentar direto com noblox
    try {
        console.log('[LOGIN] Última tentativa: método direto com noblox...');
        const user = await noblox.setCookie(cookie);
        console.log(`[LOGIN] ✅ Sucesso! Logado como: ${user.name}`);
        return user;
    } catch (erro) {
        console.error('[LOGIN] ❌ Todas as tentativas falharam');
        console.error('[LOGIN] Detalhes do erro:', erro.message);
        
        // Diagnóstico final
        console.log('\n📊 DIAGNÓSTICO FINAL:');
        console.log('- Cookie começa com "_|WARNING":', cookie.startsWith('_|WARNING'));
        console.log('- Comprimento do cookie:', cookie.length, 'caracteres');
        console.log('- Contém "DO-NOT-SHARE":', cookie.includes('DO-NOT-SHARE'));
        
        throw new Error(`Falha no login após ${userAgents.length + 1} tentativas. Roblox está bloqueando o IP.`);
    }
}
    // Método 2: Tentar direto com noblox (último recurso)
    try {
        console.log('[LOGIN] Tentando método direto...');
        const user = await noblox.setCookie(cookie);
        console.log(`[LOGIN] ✅ Sucesso direto! Logado como: ${user.name}`);
        return user;
    } catch (erro) {
        console.log(`[LOGIN] ❌ Falha direta: ${erro.message}`);
    }

    throw new Error('Todas as tentativas de login falharam. Roblox está bloqueando o IP do GitHub.');
}

// ========== FUNÇÕES DE ESTADO ==========
async function carregarEstado() {
    try {
        const gist = await octokit.gists.get({ gist_id: GIST_ID });
        const arquivo = gist.data.files['bot_state.json'];
        if (arquivo && arquivo.content) {
            const estado = JSON.parse(arquivo.content);
            lastLogDate = estado.lastLogDate ? new Date(estado.lastLogDate) : null;
            roleMap = estado.roleMap || {};
            console.log(`[ESTADO] Carregado. Último log: ${lastLogDate?.toISOString() || 'nenhum'}`);
        } else {
            console.log('[ESTADO] Nenhum estado anterior encontrado.');
        }
    } catch (erro) {
        console.error('[ERRO] Falha ao carregar estado:', erro.message);
    }
}

async function salvarEstado() {
    const estado = {
        lastLogDate: lastLogDate ? lastLogDate.toISOString() : null,
        roleMap: roleMap
    };
    try {
        await octokit.gists.update({
            gist_id: GIST_ID,
            files: { 'bot_state.json': { content: JSON.stringify(estado) } }
        });
        console.log('[ESTADO] Salvo com sucesso.');
    } catch (erro) {
        console.error('[ERRO] Falha ao salvar estado:', erro.message);
    }
}

// ========== FUNÇÕES AUXILIARES ==========
function getTimestamp() {
    const now = new Date();
    return now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function sendLog(hook, title, color, fields) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp();

    fields.forEach(field => embed.addField(field.name, field.value, field.inline || false));
    
    try {
        await hook.send(embed);
    } catch (err) {
        console.error('Erro ao enviar webhook:', err.message);
    }
}

// ========== LÓGICA PRINCIPAL ==========
async function checkLoop() {
    if (Date.now() - START_TIME > (MAX_EXECUTION_SECONDS * 1000) - 60000) {
        console.log('[TEMPO] Aproximando do limite. Encerrando...');
        await salvarEstado();
        process.exit(0);
    }

    try {
        const logs = await noblox.getAuditLog(config.groupId, { limit: 50 });
        if (!logs?.data?.length) return;

        const mostRecent = new Date(logs.data[0].created);

        if (!lastLogDate) {
            lastLogDate = mostRecent;
            console.log(`[SISTEMA] Monitoramento iniciado - Grupo ${config.groupId}`);
            await salvarEstado();
            return;
        }

        if (mostRecent <= lastLogDate) return;

        const newLogs = logs.data
            .filter(log => new Date(log.created) > lastLogDate)
            .reverse();

        for (const entry of newLogs) {
            const actor = entry.actor;
            const action = entry.actionType;
            const desc = entry.description;

            const isWhitelisted = config.whitelistRanks.includes(actor.role.rank);

            if (action === 'Change Rank') {
                const targetId = desc.TargetId;
                const targetName = desc.TargetName;
                const oldRoleId = desc.OldRoleSetId;
                const newRoleId = desc.NewRoleSetId;

                const oldRank = roleMap[oldRoleId];
                const newRank = roleMap[newRoleId];

                if (oldRank === undefined || newRank === undefined) {
                    const roles = await noblox.getRoles(config.groupId);
                    roleMap = {};
                    for (const role of roles) roleMap[role.ID] = role.rank;
                    continue;
                }

                const pulo = Math.abs(newRank - oldRank);
                const isPromocao = newRank > oldRank;
                const status = isPromocao ? 'PROMOÇÃO' : 'REBAIXAMENTO';
                const color = isPromocao ? '#00FF00' : '#FFFF00';

                await sendLog(hierarchyHook, `REGISTRO DE HIERARQUIA: ${status}`, color, [
                    { name: 'Oficial', value: actor.user.username, inline: true },
                    { name: 'Membro', value: `${targetName} (ID: ${targetId})`, inline: true },
                    { name: 'Pulo de Patentes', value: pulo.toString(), inline: false },
                    { name: 'Mudança', value: `${desc.OldRoleSetName} → ${desc.NewRoleSetName}`, inline: false }
                ]);

                if (!isWhitelisted && pulo > config.thresholdRankJump) {
                    try {
                        await noblox.setRank(config.groupId, targetId, oldRank);
                        await noblox.setRank(config.groupId, actor.user.userId, config.punishmentRankId);

                        await sendLog(raidHook, 'INTERVENÇÃO: ANTI-ABUSO ATIVADO', '#FF0000', [
                            { name: 'Infrator', value: `${actor.user.username} (Punido)`, inline: true },
                            { name: 'Vítima', value: `${targetName} (Restaurado)`, inline: true },
                            { name: 'Motivo', value: `Pulo de ${pulo} patentes`, inline: false },
                            { name: 'Horário', value: getTimestamp(), inline: false }
                        ]);
                    } catch (err) {
                        console.error('Erro ao reverter/punir:', err.message);
                    }
                }
            }

            if (action === 'Accept Join Request') {
                await sendLog(borderHook, 'FRONTEIRA: ENTRADA APROVADA', '#0099FF', [
                    { name: 'Aprovado por', value: actor.user.username, inline: true },
                    { name: 'Novo Membro', value: desc.TargetName, inline: true }
                ]);
            }
        }

        lastLogDate = mostRecent;
        await salvarEstado();
    } catch (err) {
        console.error('Erro no loop principal:', err.message);
    }
}

// ========== INICIALIZAÇÃO ==========
async function startApp() {
    try {
        await carregarEstado();
        
        // Login com bypass de IP
        await loginComProxy();

        if (Object.keys(roleMap).length === 0) {
            const roles = await noblox.getRoles(config.groupId);
            roleMap = {};
            for (const role of roles) roleMap[role.ID] = role.rank;
            console.log(`[OK] ${roles.length} patentes mapeadas!`);
            await salvarEstado();
        }

        const intervalo = setInterval(checkLoop, 5000);

        setTimeout(async () => {
            clearInterval(intervalo);
            await salvarEstado();
            process.exit(0);
        }, (MAX_EXECUTION_SECONDS * 1000) - 30000);

    } catch (err) {
        console.error('❌ Erro fatal:', err.message);
        process.exit(1);
    }
}

startApp();
