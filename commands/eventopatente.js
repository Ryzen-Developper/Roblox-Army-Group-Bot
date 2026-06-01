const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const noblox = require('noblox.js');
const config = require('../config.json');

// Lista completa de patentes do grupo (rankId => nome display)
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
        .setDescription('Ativa/desativa o modo de evento onde todos que entrarem no grupo recebem uma patente')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('patente')
                .setDescription('Selecione a patente do evento')
                .setRequired(true)
                .addChoices(
                    ...PATENTES.map(p => ({ name: p.nome, value: String(p.rankId) }))
                )
        )
        .addStringOption(option =>
            option
                .setName('status')
                .setDescription('Ligar ou desligar o evento')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 ON  – Ativar evento', value: 'on' },
                    { name: '🔴 OFF – Desativar evento', value: 'off' }
                )
        ),

    async execute(interaction, eventoPatenteState) {
        await interaction.deferReply({ ephemeral: false });

        const rankIdStr = interaction.options.getString('patente');
        const status    = interaction.options.getString('status');
        const rankId    = parseInt(rankIdStr);

        const patente = PATENTES.find(p => p.rankId === rankId);
        if (!patente) {
            return interaction.editReply({ content: '❌ Patente inválida.' });
        }

        if (status === 'on') {
            // Ativa o evento e salva a patente alvo no estado global
            eventoPatenteState.ativo   = true;
            eventoPatenteState.rankId  = rankId;
            eventoPatenteState.nome    = patente.nome;

            const embed = new EmbedBuilder()
                .setTitle('🎖️ Evento de Patente — ATIVADO')
                .setColor(0x00ff88)
                .addFields(
                    { name: 'Patente do Evento', value: `**${patente.nome}**`, inline: true },
                    { name: 'Rank ID',            value: `\`${rankId}\``,       inline: true },
                    { name: 'Status',             value: '🟢 **Ativo**',        inline: true },
                    {
                        name: 'Funcionamento',
                        value: 'Todos que entrarem no grupo agora receberão automaticamente a patente acima.',
                    }
                )
                .setFooter({ text: `Ativado por ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } else {
            // Desativa o evento
            const nomeAnterior = eventoPatenteState.nome || 'N/A';
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
                        name: 'Funcionamento',
                        value: 'Novos membros do grupo não receberão mais patente automática.',
                    }
                )
                .setFooter({ text: `Desativado por ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
    },
};
