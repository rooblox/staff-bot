const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEPARTMENTS, MAIN_GUILD_ID, MAIN_REQUIRED_ROLE_ID } = require('./departments');

const ESCALATE_CHANNEL_ID = '1418677967185252506';
const ESCALATE_GUILD_ID = '1370892833182974035';
const SHR_ROLE_ID = '1372833756489973823';
const PRES_ROLE_ID = '1394903949227589763';

async function hasBotPermsRole(client, guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }
        if (guildId === MAIN_GUILD_ID && member.roles.cache.has(MAIN_REQUIRED_ROLE_ID)) return true;
        return false;
    } catch {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('escalate')
        .setDescription('Escalate a situation to SHR or Presidential leadership')
        .addStringOption(option =>
            option.setName('escalate_to')
                .setDescription('Who to escalate to')
                .setRequired(true)
                .addChoices(
                    { name: 'SHR', value: 'shr' },
                    { name: 'Presidential', value: 'presidential' }
                ))
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Details about the situation')
                .setRequired(true)),

    async execute(interaction, client) {
        const hasPerms = await hasBotPermsRole(client, interaction.guildId, interaction.user.id);
        if (!hasPerms) {
            return interaction.reply({ content: '❌ You do not have permission to use this command in this server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const escalateTo = interaction.options.getString('escalate_to');
            const details = interaction.options.getString('details');

            const roleId = escalateTo === 'shr' ? SHR_ROLE_ID : PRES_ROLE_ID;
            const label = escalateTo === 'shr' ? 'SHR' : 'Presidential';

            const guild = await client.guilds.fetch(ESCALATE_GUILD_ID);
            const channel = await guild.channels.fetch(ESCALATE_CHANNEL_ID);

            await channel.send({
                content: `<@&${roleId}>`,
                embeds: [new EmbedBuilder()
                    .setTitle(`🚨 Escalation — ${label}`)
                    .setColor(0xE74C3C)
                    .addFields(
                        { name: '👤 Escalated By', value: `${interaction.user.tag} (${interaction.user.id})` },
                        { name: '🏢 Server', value: interaction.guild.name },
                        { name: '📝 Details', value: details }
                    )
                    .setFooter({ text: 'Kavià Café • Escalation System' })
                    .setTimestamp()
                ]
            });

            await interaction.editReply({ content: `✅ Your escalation has been sent to **${label}**.` });

        } catch (err) {
            console.error('Error in /escalate:', err);
            try { await interaction.editReply({ content: '❌ Error sending escalation.' }); } catch {}
        }
    }
};