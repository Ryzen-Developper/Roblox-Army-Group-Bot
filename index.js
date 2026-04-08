// index.js - VERSÃO FINAL COM LOGIN CORRIGIDO
require('dotenv').config();
const noblox = require('noblox.js');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const config = require('./config.json');

const borderHook = new Webhook(config.webhooks.borderLogs);
const hierarchyHook = new Webhook(config.webhooks.hierarchyLogs);
const raidHook = new Webhook(config.webhooks.raidLogs);

const octokit = new Octokit({ auth: process.env.GIST_TOKEN });
const GIST_ID = process.env.GIST_ID;

const MAX_EXECUTION_SECONDS = parseInt(process.env.MAX_EXECUTION_SECONDS) || 21000;
const START_TIME = Date.now();

let lastLogDate = null;
let roleMap = {};

// ========== FUNÇÃO DE LOGIN (CORRIGIDA) ==========
async function fazerLogin() {
    let cookie = process.env.ROBLOX_COOKIE;
    
    console.log('[LOGIN] Iniciando processo de login...');
    console.log('[LOGIN] Cookie presente:', cookie ? 'SIM' : 'NÃO');
    
    if (!cookie) {
        throw new Error('ROBLOX_COOKIE não encontrado!');
    }
    
    // Limpeza do cookie
    cookie = cookie.trim().replace(/[\n\r]/g, '').replace(/\s+/g, '');
    console.log('[LOGIN] Cookie limpo. Comprimento:', cookie.length);
    console.log('[LOGIN] Início:', cookie.substring(0, 40));
    
    // Tenta login direto
    try {
        console.log('[LOGIN] Tentando login com noblox...');
        const user = await noblox.setCookie(cookie);
        console.log('[LOGIN] ✅ SUCESSO! Usuário:', user.name);
        return user;
    } catch (erro) {
        console.error('[LOGIN] ❌ Falha no noblox:', erro.message);
    }
    
    // Tenta com axios e User-Agent
    try {
        console.log('[LOGIN] Tentando com axios e User-Agent...');
        const response = await axios.get('https://www.roblox.com/mobileapi/userinfo', {
            headers: {
                'Cookie': `.ROBLOSECURITY=${cookie}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        if (response.data && response.data.UserName) {
            console.log('[LOGIN] ✅ SUCESSO via axios! Usuário:', response.data.UserName);
            await noblox.setCookie(cookie);
            return response.data;
        }
    } catch (erro) {
        console.error('[LOGIN] ❌ Falha no axios:', erro.message);
    }
    
    throw new Error('Todas as tentativas de login falharam. Roblox bloqueou o IP do GitHub Actions.');
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
        }
    } catch (erro) {
        console.error('[ERRO] Falha ao carregar estado:', erro.message);
    }
}

async function salvarEstado() {
    try {
        await octokit.gists.update({
            gist_id: GIST_ID,
            files: { 'bot_state.json': { content: JSON.stringify({ lastLogDate, roleMap }) } }
        });
    } catch (erro) {
        console.error('[ERRO] Falha ao salvar estado:', erro.message);
    }
}

function getTimestamp() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function sendLog(hook, title, color, fields) {
    try {
        const embed = new MessageBuilder().setTitle(title).setColor(color).setTimestamp();
        fields.forEach(f => embed.addField(f.name, f.value, f.inline || false));
        await hook.send(embed);
    } catch (err) {
        console.error('Erro webhook:', err.message);
    }
}

// ========== LOOP PRINCIPAL ==========
async function checkLoop() {
    if (Date.now() - START_TIME > (MAX_EXECUTION_SECONDS * 1000) - 60000) {
        await salvarEstado();
        process.exit(0);
    }

    try {
        const logs = await noblox.getAuditLog(config.groupId, { limit: 50 });
        if (!logs?.data?.length) return;

        const mostRecent = new Date(logs.data[0].created);

        if (!lastLogDate) {
            lastLogDate = mostRecent;
            await salvarEstado();
            return;
        }

        if (mostRecent <= lastLogDate) return;

        const newLogs = logs.data.filter(log => new Date(log.created) > lastLogDate).reverse();

        for (const entry of newLogs) {
            const actor = entry.actor;
            const action = entry.actionType;
            const desc = entry.description;

            if (action === 'Change Rank') {
                const targetId = desc.TargetId;
                const targetName = desc.TargetName;
                const oldRoleId = desc.OldRoleSetId;
                const newRoleId = desc.NewRoleSetId;

                let oldRank = roleMap[oldRoleId];
                let newRank = roleMap[newRoleId];

                if (oldRank === undefined || newRank === undefined) {
                    const roles = await noblox.getRoles(config.groupId);
                    roleMap = {};
                    roles.forEach(r => roleMap[r.ID] = r.rank);
                    oldRank = roleMap[oldRoleId];
                    newRank = roleMap[newRoleId];
                }

                const pulo = Math.abs(newRank - oldRank);
                const isPromocao = newRank > oldRank;
                const isWhitelisted = config.whitelistRanks.includes(actor.role.rank);

                await sendLog(hierarchyHook, `REGISTRO DE HIERARQUIA: ${isPromocao ? 'PROMOÇÃO' : 'REBAIXAMENTO'}`,
                    isPromocao ? '#00FF00' : '#FFFF00', [
                    { name: 'Oficial', value: actor.user.username, inline: true },
                    { name: 'Membro', value: `${targetName} (ID: ${targetId})`, inline: true },
                    { name: 'Pulo', value: pulo.toString(), inline: false },
                    { name: 'Mudança', value: `${desc.OldRoleSetName} → ${desc.NewRoleSetName}`, inline: false }
                ]);

                if (!isWhitelisted && pulo > config.thresholdRankJump) {
                    try {
                        await noblox.setRank(config.groupId, targetId, oldRank);
                        await noblox.setRank(config.groupId, actor.user.userId, config.punishmentRankId);
                        await sendLog(raidHook, 'INTERVENÇÃO: ANTI-ABUSO', '#FF0000', [
                            { name: 'Infrator', value: actor.user.username, inline: true },
                            { name: 'Vítima', value: targetName, inline: true },
                            { name: 'Motivo', value: `Pulo de ${pulo} patentes`, inline: false }
                        ]);
                    } catch (err) {
                        console.error('Erro ao punir:', err.message);
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
        console.error('Erro no loop:', err.message);
    }
}

// ========== INICIALIZAÇÃO ==========
async function startApp() {
    try {
        await carregarEstado();
        await fazerLogin();  // ← CHAMANDO A FUNÇÃO NOVA!

        if (Object.keys(roleMap).length === 0) {
            const roles = await noblox.getRoles(config.groupId);
            roleMap = {};
            roles.forEach(r => roleMap[r.ID] = r.rank);
            await salvarEstado();
        }

        setInterval(checkLoop, 5000);

        setTimeout(async () => {
            await salvarEstado();
            process.exit(0);
        }, (MAX_EXECUTION_SECONDS * 1000) - 30000);

    } catch (err) {
        console.error('❌ Erro fatal:', err.message);
        process.exit(1);
    }
}

startApp();
