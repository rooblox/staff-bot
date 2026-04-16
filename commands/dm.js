const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const SERVER_LOG_CHANNELS = {
    '1370892833182974035': '1493733252203151390', // Main server
    '1462152073478017243': '1493733454041583667', // Development
    '1229426371592327250': '1493733516075208865', // SHR
    '1385081586285940796': '1493733583926460436', // PR
    '1313780438061420584': '1493733656118952036', // Media
    '1372680943592280217': '1493733777887858959', // MR/HR
    '1434556801096876034': '1462580398935642144', // Human Resources
};

const DEFAULT_LOG_CHANNEL = '1462580398935642144';

const DEPT_NAMES = {
    '1370892833182974035': 'Kavià Café',
    '1462152073478017243': 'Development Department',
    '1229426371592327250': 'SHR Department',
    '1385081586285940796': 'PR Department',
    '1313780438061420584': 'Media Team',
    '1372680943592280217': 'MR/HR Department',
    '1434556801096876034': 'Human Resources Department',
};

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
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

        const logChannelId = SERVER_LOG_CHANNELS[interaction.guildId] || DEFAULT_LOG_CHANNEL;
        const deptName = DEPT_NAMES[interaction.guildId] || 'Kavià Café';

        console.log(`📬 /dm used in guild: ${interaction.guildId}`);
        console.log(`📬 Mapped log channel: ${SERVER_LOG_CHANNELS[interaction.guildId]}`);
        console.log(`📬 Using channel: ${logChannelId}`);
        console.log(`📬 Setting dmLogChannels for user: ${user.id}`);

        if (!client.dmLogChannels) client.dmLogChannels = new Map();
        client.dmLogChannels.set(user.id, logChannelId);

        console.log(`📬 Map size after set: ${client.dmLogChannels.size}`);
        console.log(`📬 Map contents: ${JSON.stringify([...client.dmLogChannels.entries()])}`);

        try {
            const userEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📩 **Staff Direct Message**')
                .setDescription(`**${messageContent}**`)
                .addFields(
                    { name: '\u200B', value: `**${deptName}**` },
                    { name: '🕒 Time & Date', value: timestamp }
                )
                .setFooter({ text: 'Kavia Cafe Staff Team' });

            await user.send({ embeds: [userEmbed] });

            await interaction.reply({
                content: `✅ DM sent to **${user.tag}**`,
                ephemeral: true
            });

            const logEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('💬 **DM Sent**')
                .addFields(
                    { name: '📤 From (Staff)', value: `${interaction.user.tag} (${interaction.user.id})` },
                    { name: '📥 To (User)', value: `${user.tag} (${user.id})` },
                    { name: '📝 Message', value: messageContent },
                    { name: '🏢 Department', value: deptName },
                    { name: '🕒 Date & Time', value: timestamp }
                )
                .setFooter({ text: 'Kavia Cafe • DM Logs' });

            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel) await logChannel.send({ embeds: [logEmbed] });

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