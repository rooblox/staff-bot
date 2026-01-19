const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a staff direct message to a user')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('Select the user to DM')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to send')
                .setRequired(true)),

    async execute(interaction, client) {
        const user = interaction.options.getUser('member');
        const messageContent = interaction.options.getString('message');
        const logChannelId = '1462580398935642144';

        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

        try {
            // 📩 USER DM EMBED
            const userEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // Blue
                .setTitle('📩 **Staff Direct Message**')
                .setDescription(`**${messageContent}**`)
                .addFields(
                    { name: '\u200B', value: '**Kavia Human Resources**' },
                    { name: '🕒 Time & Date', value: timestamp }
                )
                .setFooter({ text: 'Kavia Cafe Staff Team' });

            await user.send({ embeds: [userEmbed] });

            // ✅ CONFIRM TO STAFF
            await interaction.reply({
                content: `✅ DM sent to **${user.tag}**`,
                ephemeral: true
            });

            // 💬 LOG EMBED
            const logEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('💬 **DM Sent**')
                .addFields(
                    {
                        name: '📤 From (Staff)',
                        value: `${interaction.user.tag} (${interaction.user.id})`
                    },
                    {
                        name: '📥 To (User)',
                        value: `${user.tag} (${user.id})`
                    },
                    {
                        name: '📝 Message',
                        value: messageContent
                    },
                    {
                        name: '🕒 Date & Time',
                        value: timestamp
                    }
                )
                .setFooter({ text: 'Kavia Cafe • DM Logs' });

            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel) {
                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error('DM command error:', error);

            if (!interaction.replied) {
                await interaction.reply({
                    content: `❌ Could not DM ${user.tag}. They may have DMs closed.`,
                    ephemeral: true
                });
            }
        }
    }
};
