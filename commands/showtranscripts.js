const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Ticket } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showtranscripts')
        .setDescription('View all closed tickets for a user')
        .addUserOption(option =>
            option.setName('user').setDescription('User to view transcripts for').setRequired(false))
        .addStringOption(option =>
            option.setName('userid').setDescription('User ID to view transcripts for (if not in server)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const user = interaction.options.getUser('user');
            const userId = user?.id || interaction.options.getString('userid');

            if (!userId) return interaction.editReply({ content: '❌ Please provide a user or user ID.' });

            const tickets = await Ticket.find({ userId, status: 'closed' }).sort({ createdAt: -1 }).limit(25);

            if (!tickets || tickets.length === 0) {
                return interaction.editReply({ content: `❌ No closed tickets found for that user.` });
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎫 Ticket History`)
                .setColor(0x5865F2)
                .setDescription(`Showing last **${tickets.length}** closed ticket(s) for <@${userId}>`)
                .setTimestamp();

            for (const ticket of tickets) {
                embed.addFields({
                    name: `#${ticket.caseId} — ${ticket.category}`,
                    value: `> **Opened:** <t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:F>\n> **Closed:** ${ticket.closedAt ? `<t:${Math.floor(new Date(ticket.closedAt).getTime() / 1000)}:F>` : 'Unknown'}\n> **Claimed By:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed'}\n> **Server:** ${ticket.serverId}`
                });
            }

            embed.setFooter({ text: `Transcripts are saved in each server's ticket-logs channel • Kavià Café` });

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /showtranscripts:', err);
            try { await interaction.editReply({ content: '❌ Error fetching transcripts.' }); } catch {}
        }
    }
};