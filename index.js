// index.js - Versão Corrigida (Sem fallback para config.cookie)
require('dotenv').config();
const noblox = require('noblox.js');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const { Octokit } = require('@octokit/rest');
const config = require('./config.json');

// Configuração dos Webhooks
const borderHook = new Webhook(config.webhooks.borderLogs);
const hierarchyHook = new Webhook(config.webhooks.hierarchyLogs);
const raidHook = new Webhook(config.webhooks.raidLogs);

// Configuração do Gist (persistência)
const octokit = new Octokit({ auth: process.env.GIST_TOKEN });
const GIST_ID = process.env.GIST_ID;

// Tempo máximo de execução: 5h50min
const MAX_EXECUTION_SECONDS = parseInt(process.env.MAX_EXECUTION_SECONDS) || 21000;
const START_TIME = Date.now();

// Estado persistente
let lastLogDate = null;
let roleMap = {};

// ========== FUNÇÕES DE ESTADO (GIST) ==========
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
            console.log('[ESTADO] Nenhum estado anterior encontrado. Iniciando do zero.');
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
        console.log('[TEMPO] Aproximando do limite. Salvando estado e encerrando...');
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
                    console.log(`[AVISO] Rank não mapeado. Atualizando roleMap...`);
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
                    console.log(`[ANTI-ABUSO] Detectado por ${actor.user.username} - pulo ${pulo}`);

                    try {
                        await noblox.setRank(config.groupId, targetId, oldRank);
                        await noblox.setRank(config.groupId, actor.user.userId, config.punishmentRankId);

                        await sendLog(raidHook, 'INTERVENÇÃO: ANTI-ABUSO ATIVADO', '#FF0000', [
                            { name: 'Infrator', value: `${actor.user.username} (Punido → 3º SGT)`, inline: true },
                            { name: 'Vítima', value: `${targetName} (Restaurado)`, inline: true },
                            { name: 'Motivo', value: `Pulo de ${pulo} patentes (máx: ${config.thresholdRankJump})`, inline: false },
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
        
        // 🔥 CORREÇÃO: Usa APENAS a variável de ambiente (sem fallback para config.cookie)
        const cookie = process.env.ROBLOX_COOKIE;
        if (!cookie) {
            throw new Error('❌ ROBLOX_COOKIE não encontrado! Configure o secret no GitHub Actions.');
        }
        
        console.log(`[LOGIN] Tentando conectar com cookie (${cookie.substring(0, 30)}...)`);
        const user = await noblox.setCookie(cookie);
        console.log(`[LOGIN] ✅ Logado como: ${user.name} (ID: ${user.id})`);

        if (Object.keys(roleMap).length === 0) {
            const roles = await noblox.getRoles(config.groupId);
            roleMap = {};
            for (const role of roles) roleMap[role.ID] = role.rank;
            console.log(`[OK] ${roles.length} patentes mapeadas!`);
            await salvarEstado();
        }

        const intervalo = setInterval(async () => {
            await checkLoop();
        }, 5000);

        const timer = setTimeout(async () => {
            console.log('[TEMPO] Limite máximo. Encerrando...');
            clearInterval(intervalo);
            await salvarEstado();
            process.exit(0);
        }, (MAX_EXECUTION_SECONDS * 1000) - 30000);

        process.on('SIGTERM', async () => {
            console.log('[SINAL] Recebido SIGTERM. Salvando...');
            clearInterval(intervalo);
            clearTimeout(timer);
            await salvarEstado();
            process.exit(0);
        });

    } catch (err) {
        console.error('❌ Erro fatal na inicialização:', err.message);
        process.exit(1);
    }
}

startApp();
