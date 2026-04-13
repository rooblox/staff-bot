const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxIdFromUsername, getAvatarUrl, getGroupRanks, getUserRankInGroup, setRank } = require('./roblox');

const REQUIRED_ROLE_ID = '1493354187109433434';
const SECONDARY_ROLE_ID = '1417859320321802362';
const MAIN_GUILD_ID = '1370892833182974035';
const SECONDARY_GUILD_ID = '1372680943592280217';

const DEPARTMENTS = [
    { name: 'SHR', value: 'SHR' },
    { name: 'PR Member', value: 'PR Member' },
    { name: 'MR Member', value: 'MR Member' },
    { name: 'HR Member', value: 'HR Member' },
    { name: 'Media Team', value: 'Media Team' },
    { name: 'Development Member', value: 'Development Member' },
    { name: 'Development Tester', value: 'Development Tester' },
    { name: 'Human Resources', value: 'Human Resources' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a user one rank up in the Roblox group')
        .addStringOption(option =>
            option.setName('roblox_username').setDescription('Roblox username of the user to promote').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for promotion').setRequired(true))
        .addStringOption(option =>
            option.setName('your_rank').setDescription('Your rank').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPARTMENTS))
        .addUserOption(option =>
            option.setName('discord_user').setDescription('Discord user to DM (optional)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            let hasPermission = false;
            const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
            const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
            if (mainMember && mainMember.roles.cache.has(REQUIRED_ROLE_ID)) hasPermission = true;

            if (!hasPermission) {
                const secondaryGuild = await interaction.client.guilds.fetch(SECONDARY_GUILD_ID);
                const secondaryMember = await secondaryGuild.members.fetch(interaction.user.id).catch(() => null);
                if (secondaryMember && secondaryMember.roles.cache.has(SECONDARY_ROLE_ID)) hasPermission = true;
            }

            if (!hasPermission) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const robloxUsername = interaction.options.getString('roblox_username');
            const reason = interaction.options.getString('reason');
            const yourRank = interaction.options.getString('your_rank');
            const department = interaction.options.getString('department');
            const discordUser = interaction.options.getUser('discord_user');
            const groupId = process.env.ROBLOX_MAIN_GROUP;

            const robloxId = await getRobloxIdFromUsername(robloxUsername);
            if (!robloxId) {
                return interaction.editReply({ content: `❌ Could not find Roblox user **${robloxUsername}**. Check the username and try again.` });
            }

            const [currentRole, allRanks, avatarUrl] = await Promise.all([
                getUserRankInGroup(groupId, robloxId),
                getGroupRanks(groupId),
                getAvatarUrl(robloxId)
            ]);

            if (!currentRole) {
                return interaction.editReply({ content: `❌ **${robloxUsername}** is not in the Roblox group.` });
            }

            const sortedRanks = allRanks.sort((a, b) => a.rank - b.rank);
            const currentIndex = sortedRanks.findIndex(r => r.id === currentRole.id);

            if (currentIndex === -1 || currentIndex === sortedRanks.length - 1) {
                return interaction.editReply({ content: `❌ **${robloxUsername}** is already at the highest rank.` });
            }

            const newRole = sortedRanks[currentIndex + 1];
            const success = await setRank(groupId, robloxId, newRole.id);

            if (!success) {
                return interaction.editReply({ content: '❌ Failed to promote user. Make sure the bot account has ranking permissions.' });
            }

            // DM discord user if provided
            if (discordUser) {
                const dmMessage = `# <:kaviacafe:1387492814916685845> **Promotion Notice**
Hello, ${discordUser},
We are delighted to inform you that you have been **promoted** at **Kavià Café**!
> <:pink_pin:1166850035611353148> **Old Rank →** *${currentRole.name}*
> <:pink_pin:1166850035611353148> **New Rank →** *${newRole.name}*
> <:pink_pin:1166850035611353148> **Reason →** *${reason}*
You have been ranked in the Roblox group. Should you have any questions, do not hesitate to reach out.
***Signed,***
**${interaction.user.username}**
**${yourRank} || ${department}**`;
                try { await discordUser.send({ content: dmMessage }); } catch {}
            }

            // Log embed
            const logEmbed = new EmbedBuilder()
                .setTitle('🎉 User Promoted')
                .setColor(0x2ECC71)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '🎮 Roblox Username', value: robloxUsername, inline: true },
                    { name: '👤 Discord User', value: discordUser ? `${discordUser.tag}` : 'Not provided', inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '⬅️ Old Rank', value: currentRole.name, inline: true },
                    { name: '➡️ New Rank', value: newRole.name, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '📝 Reason', value: reason },
                    { name: '🏢 Department', value: department, inline: true },
                    { name: '👮 Actioned By', value: interaction.user.tag, inline: true },
                    { name: '💬 DM Sent', value: discordUser ? 'Yes' : 'No', inline: true }
                )
                .setFooter({ text: 'Kavià Café • Ranking System' })
                .setTimestamp();

            const logChannel = await client.channels.fetch(process.env.RANKING_LOG_CHANNEL);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [logEmbed] });

            // Reply embed
            const replyEmbed = new EmbedBuilder()
                .setTitle('✅ Promotion Successful')
                .setColor(0x2ECC71)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '🎮 Roblox User', value: robloxUsername, inline: true },
                    { name: '⬅️ Old Rank', value: currentRole.name, inline: true },
                    { name: '➡️ New Rank', value: newRole.name, inline: true }
                )
                .setFooter({ text: 'Kavià Café • Ranking System' })
                .setTimestamp();

            await interaction.editReply({ embeds: [replyEmbed] });

        } catch (err) {
            console.error('Error in /promote command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};