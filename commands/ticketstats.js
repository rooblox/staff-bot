const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Ticket } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketstats')
        .setDescription('View ticket statistics across all servers'),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
            const allGuilds = client.guilds.cache;
            const embeds = [];

            for (const guild of allGuilds.values()) {
                const total = await Ticket.countDocuments({ serverId: guild.id });
                if (total === 0) continue;

                const open = await Ticket.countDocuments({ serverId: guild.id, status: 'open' });
                const claimed = await Ticket.countDocuments({ serverId: guild.id, status: 'claimed' });
                const closed = await Ticket.countDocuments({ serverId: guild.id, status: 'closed' });

                // Top 5 staff by claims
                const topStaff = await Ticket.aggregate([
                    { $match: { serverId: guild.id, claimedBy: { $ne: null } } },
                    { $group: { _id: '$claimedBy', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 5 }
                ]);

                // Top 5 categories
                const topCategories = await Ticket.aggregate([
                    { $match: { serverId: guild.id } },
                    { $group: { _id: '$category', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 5 }
                ]);

                // Avg close time in minutes
                const closedTickets = await Ticket.find({ serverId: guild.id, status: 'closed', createdAt: { $exists: true }, closedAt: { $exists: true } });
                let avgCloseTime = 'N/A';
                if (closedTickets.length > 0) {
                    const totalMs = closedTickets.reduce((sum, t) => sum + (new Date(t.closedAt) - new Date(t.createdAt)), 0);
                    const avgMins = Math.round(totalMs / closedTickets.length / 1000 / 60);
                    avgCloseTime = avgMins < 60 ? `${avgMins}m` : `${Math.round(avgMins / 60)}h ${avgMins % 60}m`;
                }

                const topStaffText = topStaff.length > 0
                    ? topStaff.map((s, i) => `**${i + 1}.** <@${s._id}> — ${s.count} tickets`).join('\n')
                    : 'No data';

                const topCatText = topCategories.length > 0
                    ? topCategories.map((c, i) => `**${i + 1}.** ${c._id} — ${c.count} tickets`).join('\n')
                    : 'No data';

                const embed = new EmbedBuilder()
                    .setTitle(`🎫 Ticket Stats — ${guild.name}`)
                    .setColor(0x5865F2)
                    .addFields(
                        { name: '📊 Overview', value: `Total: **${total}** | Open: **${open}** | Claimed: **${claimed}** | Closed: **${closed}**`, inline: false },
                        { name: '⏱️ Avg Close Time', value: avgCloseTime, inline: true },
                        { name: '🏆 Top Staff by Claims', value: topStaffText, inline: false },
                        { name: '📂 Top Categories', value: topCatText, inline: false }
                    )
                    .setFooter({ text: 'Kavià Café • Ticket Statistics' })
                    .setTimestamp();

                embeds.push(embed);
            }

            if (embeds.length === 0) {
                return interaction.editReply({ content: '❌ No ticket data found across any servers.' });
            }

            // Discord allows max 10 embeds per message
            await interaction.editReply({ embeds: embeds.slice(0, 10) });

        } catch (err) {
            console.error('Error in /ticketstats:', err);
            try { await interaction.editReply({ content: '❌ Error fetching ticket stats.' }); } catch {}
        }
    }
};