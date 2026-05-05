/**
 * ============================================================
 *  ROLE GUARD — Sistema de proteção de cargos
 * ============================================================
 *
 *  Como funciona o discernimento de intenção:
 *  ─────────────────────────────────────────
 *  Toda alteração de cargo dispara o evento guildMemberUpdate.
 *  O bot consulta o Audit Log do Discord (até 1500ms de delay
 *  para o log ser populado) e identifica o "ator" da mudança.
 *
 *  Um ator é considerado LEGÍTIMO se:
 *    1. É um bot (alterações feitas por bots são confiáveis)
 *    2. É o dono do servidor (Owner ID hardcoded)
 *    3. Possui a permissão "Administrador" no servidor
 *    4. Possui um dos cargos autorizados (AUTHORIZED_ROLES)
 *
 *  Um ator é considerado ILEGÍTIMO se:
 *    1. Não se enquadra em nenhum critério acima
 *    2. O Audit Log não retornou o ator (ex.: falha de permissão)
 *       → Neste caso, o bot reverte por precaução.
 *
 *  Cargos IMUNES (exempt):
 *    Alterações envolvendo esses cargos NUNCA são revertidas,
 *    independentemente de quem fez a mudança. Isso protege
 *    cargos estruturais do servidor.
 * ============================================================
 */

const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Configurações ───────────────────────────────────────────

/** Canal onde todos os logs serão enviados */
const LOG_CHANNEL_ID = '1491836289652101211';

/** ID do dono principal — sempre considerado legítimo */
const OWNER_ID = '1451961500595126394';

/**
 * Cargos cujos membros estão autorizados a alterar cargos de terceiros.
 * Se o ator possuir qualquer um destes cargos, a ação é considerada legítima.
 */
const AUTHORIZED_ROLES = [
    '1462284795374473260',
    '1462533718001320130',
    '1462284795919990998',
    '1462284795374473262',
];

/**
 * Cargos IMUNES ao Role Guard (lista padrão, não editável via comando).
 * Alterações nestes cargos — em qualquer direção — são sempre ignoradas.
 */
const DEFAULT_EXEMPT_ROLES = [
    '1462284797169893419',
    '1462284795374473260',
    '1462284795919991002',
    '1497333013615476917',
    '1462284795919990998',
    '1462533718001320130',
];

// ─── Persistência de isenções dinâmicas ──────────────────────

const EXEMPTIONS_FILE = path.join(__dirname, '../data/roleExemptions.json');

/** Retorna apenas as isenções adicionadas dinamicamente via comando. */
function getDynamicExemptions() {
    try {
        if (!fs.existsSync(EXEMPTIONS_FILE)) return [];
        return JSON.parse(fs.readFileSync(EXEMPTIONS_FILE, 'utf8')).exempt ?? [];
    } catch {
        return [];
    }
}

/** Retorna a lista completa de cargos imunes (padrão + dinâmicos). */
function loadExemptions() {
    return [...new Set([...DEFAULT_EXEMPT_ROLES, ...getDynamicExemptions()])];
}

/** Persiste alterações na lista dinâmica de isenções. */
function saveExemptions(dynamicList) {
    fs.mkdirSync(path.dirname(EXEMPTIONS_FILE), { recursive: true });
    fs.writeFileSync(EXEMPTIONS_FILE, JSON.stringify({ exempt: dynamicList }, null, 2));
}

// ─── Audit Log ───────────────────────────────────────────────

/**
 * Busca no Audit Log quem alterou os cargos do membro alvo.
 * Retorna o executor ou null se não for possível determinar.
 * @param {import('discord.js').Guild} guild
 * @param {string} targetId
 * @returns {Promise<import('discord.js').User|null>}
 */
async function getAuditActor(guild, targetId) {
    try {
        const logs = await guild.fetchAuditLogs({
            limit: 5,
            type: AuditLogEvent.MemberRoleUpdate,
        });

        const entry = logs.entries.find(
            e => e.target?.id === targetId && Date.now() - e.createdTimestamp < 6000
        );

        return entry?.executor ?? null;
    } catch (err) {
        console.error('[ROLE GUARD] Erro ao buscar Audit Log:', err.message);
        return null;
    }
}

// ─── Discernimento de intenção ────────────────────────────────

/**
 * Determina se o ator de uma alteração de cargo é legítimo.
 *
 * Critérios (em ordem):
 *   1. Bot → legítimo (bots operam via API com permissões explícitas)
 *   2. Owner ID → legítimo
 *   3. Permissão de Administrador → legítimo
 *   4. Possui cargo autorizado → legítimo
 *   5. Qualquer outro caso → ilegítimo
 *
 * @param {import('discord.js').User|null} actor
 * @param {import('discord.js').Guild} guild
 * @returns {{ legitimate: boolean, reason: string }}
 */
function evaluateActor(actor, guild) {
    if (!actor) {
        return {
            legitimate: false,
            reason: 'Ator não identificado no Audit Log — revertido por precaução.',
        };
    }

    if (actor.bot) {
        return {
            legitimate: true,
            reason: `Ação realizada pelo bot \`${actor.tag}\` via API — considerada legítima.`,
        };
    }

    if (actor.id === OWNER_ID) {
        return {
            legitimate: true,
            reason: `Ação realizada pelo dono do servidor (\`${actor.tag}\`).`,
        };
    }

    const member = guild.members.cache.get(actor.id);

    if (member?.permissions.has('Administrator')) {
        return {
            legitimate: true,
            reason: `Ator \`${actor.tag}\` possui permissão de Administrador.`,
        };
    }

    const hasAuthRole = AUTHORIZED_ROLES.some(id => member?.roles.cache.has(id));
    if (hasAuthRole) {
        return {
            legitimate: true,
            reason: `Ator \`${actor.tag}\` possui cargo de staff autorizado.`,
        };
    }

    return {
        legitimate: false,
        reason: `Ator \`${actor.tag}\` (ID: ${actor.id}) não possui permissão para alterar cargos.`,
    };
}

// ─── Logging ─────────────────────────────────────────────────

const ACTION_COLORS = {
    REVERTIDO:          0xff4444,
    IGNORADO_EXCEÇÃO:   0xffaa00,
    IGNORADO_LEGÍTIMO:  0x00cc44,
};

const ACTION_LABELS = {
    REVERTIDO:         '🔴 REVERTIDO',
    IGNORADO_EXCEÇÃO:  '🟡 IGNORADO — Cargo Imune',
    IGNORADO_LEGÍTIMO: '🟢 IGNORADO — Ação Legítima',
};

/**
 * Envia um embed de log no canal configurado.
 */
async function sendLog(client, { action, changeType, actor, target, roles, reason }) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(`🛡️ Role Guard — ${ACTION_LABELS[action]}`)
            .setColor(ACTION_COLORS[action])
            .addFields(
                {
                    name: '🕐 Horário',
                    value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    inline: true,
                },
                {
                    name: '⚙️ Tipo de alteração',
                    value: changeType === 'add' ? '➕ Adição de cargo' : '➖ Remoção de cargo',
                    inline: true,
                },
                { name: '\u200b', value: '\u200b', inline: true },
                {
                    name: '👤 Quem alterou',
                    value: actor
                        ? `<@${actor.id}> \`${actor.tag}\`\nID: \`${actor.id}\``
                        : '`Não identificado`',
                    inline: true,
                },
                {
                    name: '🎯 Usuário afetado',
                    value: `<@${target.id}> \`${target.user?.tag ?? target.id}\`\nID: \`${target.id}\``,
                    inline: true,
                },
                { name: '\u200b', value: '\u200b', inline: true },
                {
                    name: `🏷️ Cargo(s) alterado(s)`,
                    value: roles.map(r => `<@&${r.id}> \`${r.name}\``).join('\n') || '`—`',
                    inline: false,
                },
                {
                    name: '📋 Motivo da decisão',
                    value: reason,
                    inline: false,
                }
            )
            .setFooter({ text: 'Role Guard System' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[ROLE GUARD] Erro ao enviar log:', err.message);
    }
}

// ─── Handler principal ────────────────────────────────────────

/**
 * Processa um evento guildMemberUpdate e aplica as regras do Role Guard.
 * Deve ser chamado dentro de client.on('guildMemberUpdate', ...).
 *
 * @param {import('discord.js').GuildMember} oldMember
 * @param {import('discord.js').GuildMember} newMember
 * @param {import('discord.js').Client} client
 */
async function handle(oldMember, newMember, client) {
    // ── Calcular diferenças de cargos ──────────────────────
    const oldIds = new Set(oldMember.roles.cache.keys());
    const newIds = new Set(newMember.roles.cache.keys());

    const added   = [...newIds].filter(id => !oldIds.has(id));
    const removed = [...oldIds].filter(id => !newIds.has(id));

    // Nenhuma alteração de cargo → ignorar (ex.: nick mudou)
    if (added.length === 0 && removed.length === 0) return;

    // ── Aguardar Audit Log ser populado ────────────────────
    await new Promise(r => setTimeout(r, 1500));

    const actor              = await getAuditActor(newMember.guild, newMember.id);
    const { legitimate, reason } = evaluateActor(actor, newMember.guild);
    const exemptRoles        = loadExemptions();

    // ── Processar cargos adicionados ───────────────────────
    for (const roleId of added) {
        const role = newMember.guild.roles.cache.get(roleId);
        if (!role) continue;

        // Cargo imune → apenas registrar, nunca reverter
        if (exemptRoles.includes(roleId)) {
            await sendLog(client, {
                action: 'IGNORADO_EXCEÇÃO',
                changeType: 'add',
                actor,
                target: newMember,
                roles: [role],
                reason: `Cargo está na lista de imunidade — alterações nele nunca são revertidas.`,
            });
            continue;
        }

        // Ação legítima → registrar e seguir em frente
        if (legitimate) {
            await sendLog(client, {
                action: 'IGNORADO_LEGÍTIMO',
                changeType: 'add',
                actor,
                target: newMember,
                roles: [role],
                reason,
            });
            continue;
        }

        // Ação ilegítima → reverter (remover o cargo adicionado)
        try {
            await newMember.roles.remove(role, 'Role Guard: reversão automática');
        } catch (err) {
            console.error(`[ROLE GUARD] Falha ao remover cargo "${role.name}":`, err.message);
        }

        await sendLog(client, {
            action: 'REVERTIDO',
            changeType: 'add',
            actor,
            target: newMember,
            roles: [role],
            reason,
        });
    }

    // ── Processar cargos removidos ─────────────────────────
    for (const roleId of removed) {
        const role = oldMember.guild.roles.cache.get(roleId);
        if (!role) continue;

        if (exemptRoles.includes(roleId)) {
            await sendLog(client, {
                action: 'IGNORADO_EXCEÇÃO',
                changeType: 'remove',
                actor,
                target: newMember,
                roles: [role],
                reason: `Cargo está na lista de imunidade — alterações nele nunca são revertidas.`,
            });
            continue;
        }

        if (legitimate) {
            await sendLog(client, {
                action: 'IGNORADO_LEGÍTIMO',
                changeType: 'remove',
                actor,
                target: newMember,
                roles: [role],
                reason,
            });
            continue;
        }

        // Reverter (restaurar o cargo removido)
        try {
            await newMember.roles.add(role, 'Role Guard: reversão automática');
        } catch (err) {
            console.error(`[ROLE GUARD] Falha ao restaurar cargo "${role.name}":`, err.message);
        }

        await sendLog(client, {
            action: 'REVERTIDO',
            changeType: 'remove',
            actor,
            target: newMember,
            roles: [role],
            reason,
        });
    }
}

module.exports = {
    handle,
    loadExemptions,
    getDynamicExemptions,
    saveExemptions,
    DEFAULT_EXEMPT_ROLES,
};
