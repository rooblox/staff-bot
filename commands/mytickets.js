const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Ticket } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mytickets')
        .setDescription('View your open and recently closed tickets'),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
            const userId = interaction.user.id;

            const openTickets = await Ticket.find({ userId, status: { $in: ['open', 'claimed'] } }).sort({ createdAt: -1 });
            const closedTickets = await Ticket.find({ userId, status: 'closed' }).sort({ closedAt: -1 }).limit(5);

            if (openTickets.length === 0 && closedTickets.length === 0) {
                return interaction.editReply({ content: '📭 You have no tickets on record.' });
            }

            const embeds = [];

            if (openTickets.length > 0) {
                const openFields = await Promise.all(openTickets.map(async t => {
                    let serverName = 'Unknown Server';
                    try { const g = await client.guilds.fetch(t.serverId); serverName = g.name; } catch {}
                    const status = t.status === 'claimed' ? `✋ Claimed by <@${t.claimedBy}>` : '⏳ Unclaimed';
                    return {
                        name: `🎫 #${t.caseId} — ${t.category}`,
                        value: `**Server:** ${serverName}\n**Status:** ${status}\n**Opened:** <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`,
                        inline: false
                    };
                }));

                embeds.push(new EmbedBuilder()
                    .setTitle('🟢 Your Open Tickets')
                    .setColor(0x2ECC71)
                    .addFields(openFields)
                    .setFooter({ text: 'Kavià Café • My Tickets' })
                    .setTimestamp()
                );
            }

            if (closedTickets.length > 0) {
                const closedFields = await Promise.all(closedTickets.map(async t => {
                    let serverName = 'Unknown Server';
                    try { const g = await client.guilds.fetch(t.serverId); serverName = g.name; } catch {}
                    const duration = t.createdAt && t.closedAt
                        ? `${Math.round((new Date(t.closedAt) - new Date(t.createdAt)) / 1000 / 60)}m`
                        : 'Unknown';
                    return {
                        name: `🔒 #${t.caseId} — ${t.category}`,
                        value: `**Server:** ${serverName}\n**Closed:** <t:${Math.floor(new Date(t.closedAt).getTime() / 1000)}:R>\n**Duration:** ${duration}`,
                        inline: false
                    };
                }));

                embeds.push(new EmbedBuilder()
                    .setTitle('🔴 Recently Closed Tickets (Last 5)')
                    .setColor(0xE74C3C)
                    .addFields(closedFields)
                    .setFooter({ text: 'Kavià Café • My Tickets' })
                    .setTimestamp()
                );
            }

            await interaction.editReply({ embeds });

        } catch (err) {
            console.error('Error in /mytickets:', err);
            try { await interaction.editReply({ content: '❌ Error fetching your tickets.' }); } catch {}
        }
    }
};