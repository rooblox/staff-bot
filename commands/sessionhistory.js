const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Session } = require('../db');
const { DEPARTMENTS, MAIN_GUILD_ID, MAIN_REQUIRED_ROLE_ID } = require('./departments');

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

function getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    const weekStart = new Date(now);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sessionhistory')
        .setDescription('View a user\'s session history')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check')
                .setRequired(true)),

    async execute(interaction, client) {
        const hasPerms = await hasBotPermsRole(client, interaction.guildId, interaction.user.id);
        if (!hasPerms) {
            return interaction.reply({ content: '❌ You do not have permission to use this command in this server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false }).catch(() => {});

        try {
            const targetUser = interaction.options.getUser('user');
            const weekStart = getWeekStart();

            // This week — hosted
            const weekHosted = await Session.find({
                hostId: targetUser.id,
                createdAt: { $gte: weekStart },
                status: { $in: ['finished', 'active'] }
            });

            // This week — co-hosted
            const weekCoHosted = await Session.find({
                coHostId: targetUser.id,
                createdAt: { $gte: weekStart },
                status: { $in: ['finished', 'active'] }
            });

            // All time — hosted, broken down by status
            const allHosted = await Session.find({ hostId: targetUser.id });
            const allCoHosted = await Session.find({ coHostId: targetUser.id });

            const allCompleted = allHosted.filter(s => s.status === 'finished' || s.status === 'active').length;
            const allCancelled = allHosted.filter(s => s.status === 'cancelled').length;
            const allCoHostedCount = allCoHosted.length;

            const weekHostedList = weekHosted.length > 0
                ? weekHosted.map(s => `• **${s.shiftType}** — ${s.time}`).join('\n')
                : '_None this week_';

            const weekCoHostedList = weekCoHosted.length > 0
                ? weekCoHosted.map(s => `• **${s.shiftType}** — ${s.time}`).join('\n')
                : '_None this week_';

            const embed = new EmbedBuilder()
                .setTitle(`📋 Session History — ${targetUser.tag}`)
                .setColor(0x3498DB)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '🗓️ This Week — Hosted', value: weekHostedList, inline: false },
                    { name: '🗓️ This Week — Co-Hosted', value: weekCoHostedList, inline: false },
                    { name: '📊 All-Time Completed', value: String(allCompleted), inline: true },
                    { name: '❌ All-Time Cancelled', value: String(allCancelled), inline: true },
                    { name: '🤝 All-Time Co-Hosted', value: String(allCoHostedCount), inline: true }
                )
                .setFooter({ text: 'Kavià Café • Session History' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /sessionhistory:', err);
            try { await interaction.editReply({ content: '❌ Error fetching session history.' }); } catch {}
        }
    }
};