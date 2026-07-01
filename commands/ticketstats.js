const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Ticket, Review } = require('../db');

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

                // Staff ratings — real reviews + troll reviews layered on top
                const realReviews = await Review.find({ serverId: guild.id });
                const trollReviews = client.trollReviews || new Map();

                const ratingMap = new Map();
                for (const review of realReviews) {
                    if (!ratingMap.has(review.staffId)) {
                        ratingMap.set(review.staffId, { total: 0, count: 0, tag: review.staffTag });
                    }
                    const entry = ratingMap.get(review.staffId);
                    entry.total += review.rating;
                    entry.count += 1;
                }

                // Apply troll reviews (1 star each, not saved to DB)
                for (const [userId, fakeCount] of trollReviews.entries()) {
                    if (!ratingMap.has(userId)) {
                        let tag = 'Unknown';
                        try { const u = await client.users.fetch(userId); tag = u.tag; } catch {}
                        ratingMap.set(userId, { total: 0, count: 0, tag });
                    }
                    const entry = ratingMap.get(userId);
                    entry.total += fakeCount * 1;
                    entry.count += fakeCount;
                    entry.trolled = true;
                    entry.trollCount = fakeCount;
                }

                let ratingsText = 'No reviews yet';
                if (ratingMap.size > 0) {
                    const sorted = [...ratingMap.entries()]
                        .map(([id, data]) => ({
                            id,
                            avg: data.total / data.count,
                            count: data.count,
                            tag: data.tag,
                            trolled: data.trolled || false,
                            trollCount: data.trollCount || 0
                        }))
                        .sort((a, b) => b.avg - a.avg);

                    ratingsText = sorted.slice(0, 5).map((s, i) => {
                        const stars = '⭐'.repeat(Math.round(s.avg));
                        const trollNote = s.trolled ? ` 🤡 (+${s.trollCount} fake)` : '';
                        return `**${i + 1}.** <@${s.id}> — ${stars} (${s.avg.toFixed(1)}/5, ${s.count} reviews)${trollNote}`;
                    }).join('\n');
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
                        { name: '⭐ Staff Ratings', value: ratingsText, inline: false },
                        { name: '📂 Top Categories', value: topCatText, inline: false }
                    )
                    .setFooter({ text: 'Kavià Café • Ticket Statistics' })
                    .setTimestamp();

                embeds.push(embed);
            }

            if (embeds.length === 0) {
                return interaction.editReply({ content: '❌ No ticket data found across any servers.' });
            }

            await interaction.editReply({ embeds: embeds.slice(0, 10) });

        } catch (err) {
            console.error('Error in /ticketstats:', err);
            try { await interaction.editReply({ content: '❌ Error fetching ticket stats.' }); } catch {}
        }
    }
};