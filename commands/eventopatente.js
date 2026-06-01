const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Lista de patentes do grupo (rankId → nome display)
// Baseada nos whitelistRanks do config.json: [255, 253, 24, 22, 21, 20, 19, 18, 17, 16, 15]
const PATENTES = [
    { rankId: 255, nome: '[MAR] Marechal' },
    { rankId: 253, nome: '[GEN] General de Exército' },
    { rankId: 24,  nome: '[GLT] General de Divisão' },
    { rankId: 22,  nome: '[GBR] General de Brigada' },
    { rankId: 21,  nome: '[CEL] Coronel' },
    { rankId: 20,  nome: '[TCL] Tenente-Coronel' },
    { rankId: 19,  nome: '[MAJ] Major' },
    { rankId: 18,  nome: '[CAP] Capitão' },
    { rankId: 17,  nome: '[TEN] Tenente' },
    { rankId: 16,  nome: '[SGT] Sargento' },
    { rankId: 15,  nome: '[CAB] Cabo' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('eventopatente')
        .setDescription('Ativa/desativa o modo de evento: todos que entrarem no grupo recebem uma patente')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('patente')
                .setDescription('Patente que todos os novos membros receberão automaticamente')
                .setRequired(true)
                .addChoices(
                    ...PATENTES.map(p => ({ name: p.nome, value: String(p.rankId) }))
                )
        )
        .addStringOption(option =>
            option
                .setName('status')
                .setDescription('Ligar ou desligar o evento de patente')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 ON  – Ativar evento',    value: 'on'  },
                    { name: '🔴 OFF – Desativar evento', value: 'off' }
                )
        ),

    // Assinatura igual aos outros comandos do bot: (interaction, client, config, eventoPatenteState)
    async execute(interaction, client, config, eventoPatenteState) {
        await interaction.deferReply();

        const rankId  = parseInt(interaction.options.getString('patente'));
        const status  = interaction.options.getString('status');
        const patente = PATENTES.find(p => p.rankId === rankId);

        if (!patente) {
            return interaction.editReply({ content: '❌ Patente inválida.' });
        }

        if (status === 'on') {
            eventoPatenteState.ativo  = true;
            eventoPatenteState.rankId = rankId;
            eventoPatenteState.nome   = patente.nome;

            const embed = new EmbedBuilder()
                .setTitle('🎖️ Evento de Patente — ATIVADO')
                .setColor(0x00ff88)
                .addFields(
                    { name: 'Patente do Evento', value: `**${patente.nome}**`, inline: true },
                    { name: 'Rank ID',            value: `\`${rankId}\``,       inline: true },
                    { name: 'Status',             value: '🟢 **Ativo**',        inline: true },
                    {
                        name: 'Como funciona',
                        value: 'Todos que **entrarem no grupo** a partir de agora receberão automaticamente esta patente.',
                    }
                )
                .setFooter({ text: `Ativado por ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } else {
            const nomeAnterior = eventoPatenteState.nome || 'Nenhuma';

            eventoPatenteState.ativo  = false;
            eventoPatenteState.rankId = null;
            eventoPatenteState.nome   = null;

            const embed = new EmbedBuilder()
                .setTitle('🎖️ Evento de Patente — DESATIVADO')
                .setColor(0xff4444)
                .addFields(
                    { name: 'Patente que estava ativa', value: `**${nomeAnterior}**`, inline: true },
                    { name: 'Status',                   value: '🔴 **Inativo**',       inline: true },
                    {
                        name: 'Como funciona',
                        value: 'Novos membros do grupo **não receberão mais** patente automática.',
                    }
                )
                .setFooter({ text: `Desativado por ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
    },
};
