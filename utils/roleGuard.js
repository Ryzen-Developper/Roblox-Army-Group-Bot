const { SlashCommandBuilder } = require('discord.js');
const {
    getDynamicExemptions,
    saveExemptions,
    DEFAULT_EXEMPT_ROLES,
} = require('../../utils/roleGuard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roleguard')
        .setDescription('Gerencia o sistema de proteção de cargos (Role Guard)')
        .addSubcommand(sub =>
            sub
                .setName('addexempt')
                .setDescription('Adiciona um cargo à lista de imunidade (nunca será revertido)')
                .addRoleOption(opt =>
                    opt
                        .setName('cargo')
                        .setDescription('Cargo a tornar imune')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('removeexempt')
                .setDescription('Remove um cargo da lista de imunidade dinâmica')
                .addRoleOption(opt =>
                    opt
                        .setName('cargo')
                        .setDescription('Cargo a remover da imunidade')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('listexempt')
                .setDescription('Exibe todos os cargos atualmente imunes ao Role Guard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        // ── addexempt ─────────────────────────────────────
        if (sub === 'addexempt') {
            const role    = interaction.options.getRole('cargo');
            const dynamic = getDynamicExemptions();

            if (DEFAULT_EXEMPT_ROLES.includes(role.id)) {
                return interaction.reply({
                    content: `⚠️ <@&${role.id}> já faz parte da lista de imunidade **padrão** e não pode ser alterado.`,
                    flags: 64,
                });
            }

            if (dynamic.includes(role.id)) {
                return interaction.reply({
                    content: `⚠️ <@&${role.id}> já está na lista de imunidade dinâmica.`,
                    flags: 64,
                });
            }

            dynamic.push(role.id);
            saveExemptions(dynamic);

            return interaction.reply({
                content: `✅ <@&${role.id}> adicionado à imunidade do Role Guard.\nAlterações neste cargo **não serão revertidas** daqui em diante.`,
                flags: 64,
            });
        }

        // ── removeexempt ──────────────────────────────────
        if (sub === 'removeexempt') {
            const role    = interaction.options.getRole('cargo');
            const dynamic = getDynamicExemptions();

            if (DEFAULT_EXEMPT_ROLES.includes(role.id)) {
                return interaction.reply({
                    content: `❌ <@&${role.id}> é um cargo de imunidade **padrão** e não pode ser removido via comando.`,
                    flags: 64,
                });
            }

            const idx = dynamic.indexOf(role.id);
            if (idx === -1) {
                return interaction.reply({
                    content: `⚠️ <@&${role.id}> não está na lista de imunidade dinâmica.`,
                    flags: 64,
                });
            }

            dynamic.splice(idx, 1);
            saveExemptions(dynamic);

            return interaction.reply({
                content: `✅ <@&${role.id}> removido da imunidade dinâmica.\nAlterações neste cargo **passarão a ser monitoradas** pelo Role Guard.`,
                flags: 64,
            });
        }

        // ── listexempt ────────────────────────────────────
        if (sub === 'listexempt') {
            const dynamic = getDynamicExemptions();

            const defaultList = DEFAULT_EXEMPT_ROLES.map(id => `• <@&${id}> \`${id}\` *(padrão)*`);
            const dynamicList = dynamic
                .filter(id => !DEFAULT_EXEMPT_ROLES.includes(id))
                .map(id => `• <@&${id}> \`${id}\` *(dinâmico)*`);

            const allLines = [...defaultList, ...dynamicList];

            return interaction.reply({
                content: [
                    '**🛡️ Cargos imunes ao Role Guard**',
                    '',
                    allLines.length > 0 ? allLines.join('\n') : '*Nenhum cargo imune cadastrado.*',
                    '',
                    `> Total: **${allLines.length}** cargo(s) imune(s)`,
                ].join('\n'),
                flags: 64,
            });
        }
    },
};
