const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { sendGroupAnnouncement } = require('./roblox');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announcements')
        .setDescription('Post an announcement to the Roblox group')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Title of the announcement (max 120 characters)')
                .setRequired(true)
                .setMaxLength(120))
        .addStringOption(option =>
            option.setName('content')
                .setDescription('Content of the announcement (max 1000 characters)')
                .setRequired(true)
                .setMaxLength(1000)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
            const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
            if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const title = interaction.options.getString('title');
            const content = interaction.options.getString('content');
            const groupId = process.env.ROBLOX_MAIN_GROUP;

            const success = await sendGroupAnnouncement(groupId, title, content);

            if (!success) {
                return interaction.editReply({ content: '❌ Failed to post announcement. Make sure the bot account has permission to post announcements in the group.' });
            }

            const logChannel = await client.channels.fetch(process.env.RANKING_LOG_CHANNEL);
            if (logChannel?.isTextBased()) {
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📢 Group Announcement Posted')
                            .setColor(0x3498DB)
                            .addFields(
                                { name: '👮 Posted By', value: interaction.user.tag },
                                { name: '📌 Title', value: title },
                                { name: '📝 Content', value: content }
                            )
                            .setFooter({ text: 'Kavià Café • Announcements' })
                            .setTimestamp()
                    ]
                });
            }

            await interaction.editReply({ content: `✅ Announcement **"${title}"** posted to the Roblox group!` });

        } catch (err) {
            console.error('Error in /announcements command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};