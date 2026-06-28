const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEPARTMENTS, MAIN_GUILD_ID, MAIN_REQUIRED_ROLE_ID } = require('./departments');

const INCIDENT_LOG_CHANNEL_ID = '1520825182908846092';
const INCIDENT_GUILD_ID = '1370892833182974035';

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
        .setName('incidentreport')
        .setDescription('File an incident report (for SHR blacklist review history)')
        .addStringOption(option =>
            option.setName('roblox_username')
                .setDescription('Roblox username involved')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('what_happened')
                .setDescription('What happened')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('witnesses')
                .setDescription('Witnesses (Discord tags or Roblox usernames, optional)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('proof')
                .setDescription('Proof link (optional)')
                .setRequired(false)),

    async execute(interaction, client) {
        const hasPerms = await hasBotPermsRole(client, interaction.guildId, interaction.user.id);
        if (!hasPerms) {
            return interaction.reply({ content: '❌ You do not have permission to use this command in this server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const robloxUsername = interaction.options.getString('roblox_username');
            const whatHappened = interaction.options.getString('what_happened');
            const witnesses = interaction.options.getString('witnesses') || 'None provided';
            const proof = interaction.options.getString('proof') || 'None provided';

            const guild = await client.guilds.fetch(INCIDENT_GUILD_ID);
            const channel = await guild.channels.fetch(INCIDENT_LOG_CHANNEL_ID);

            await channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('📋 Incident Report Filed')
                    .setColor(0xF39C12)
                    .addFields(
                        { name: '🎮 Roblox Username', value: robloxUsername, inline: true },
                        { name: '👤 Filed By', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: '🏢 Server', value: interaction.guild.name, inline: true },
                        { name: '📝 What Happened', value: whatHappened },
                        { name: '👁️ Witnesses', value: witnesses },
                        { name: '📎 Proof', value: proof }
                    )
                    .setFooter({ text: 'Kavià Café • Incident Report Archive' })
                    .setTimestamp()
                ]
            });

            await interaction.editReply({ content: '✅ Your incident report has been logged for future reference.' });

        } catch (err) {
            console.error('Error in /incidentreport:', err);
            try { await interaction.editReply({ content: '❌ Error filing incident report.' }); } catch {}
        }
    }
};