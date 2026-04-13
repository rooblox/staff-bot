const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxIdFromUsername, getAvatarUrl, getUserRankInGroup, kickFromGroup } = require('./roblox');

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
        .setName('rankterminate')
        .setDescription('Remove a user from the dev Roblox group')
        .addStringOption(option =>
            option.setName('roblox_username').setDescription('Roblox username of the user to terminate').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for termination').setRequired(true))
        .addStringOption(option =>
            option.setName('appealable').setDescription('Is this termination appealable?').setRequired(true)
                .addChoices({ name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' }))
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
            const appealable = interaction.options.getString('appealable');
            const department = interaction.options.getString('department');
            const discordUser = interaction.options.getUser('discord_user');
            const devGroupId = process.env.ROBLOX_DEV_GROUP;

            const robloxId = await getRobloxIdFromUsername(robloxUsername);
            if (!robloxId) {
                return interaction.editReply({ content: `❌ Could not find Roblox user **${robloxUsername}**. Check the username and try again.` });
            }

            const [devRole, avatarUrl] = await Promise.all([
                getUserRankInGroup(devGroupId, robloxId),
                getAvatarUrl(robloxId)
            ]);

            if (!devRole) {
                return interaction.editReply({ content: `❌ **${robloxUsername}** is not in the dev Roblox group.` });
            }

            const success = await kickFromGroup(devGroupId, robloxId);
            if (!success) {
                return interaction.editReply({ content: '❌ Failed to remove user from the dev group. Make sure the bot account has permission.' });
            }

            if (discordUser) {
                const today = new Date();
                const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;
                const dmMessage = `# <:kaviacafe:1387492814916685845> | Termination Notice
-# ${date}
Hello ${discordUser},
Following review, you have been **removed** from the Kavià Café development group effective immediately.
> **Reason →** *${reason}*
> **Appealable →** *${appealable}*
If this is appealable, please open a ticket in the appeals server.
<:reply:1467007523981627392> This action was discussed and approved by members of the SHR+ team.
***Sincerely,***
**${interaction.user.username} || ${department}**`;
                try { await discordUser.send({ content: dmMessage }); } catch {}
            }

            const logEmbed = new EmbedBuilder()
                .setTitle('⚡ User Removed from Dev Group')
                .setColor(0xE74C3C)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '🎮 Roblox Username', value: robloxUsername, inline: true },
                    { name: '👤 Discord User', value: discordUser ? `${discordUser.tag}` : 'Not provided', inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '🏷️ Previous Rank', value: devRole.name, inline: true },
                    { name: '🔧 Dev Group', value: '✅ Kicked', inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '📝 Reason', value: reason },
                    { name: '⚖️ Appealable', value: appealable, inline: true },
                    { name: '🏢 Department', value: department, inline: true },
                    { name: '👮 Actioned By', value: interaction.user.tag, inline: true },
                    { name: '💬 DM Sent', value: discordUser ? 'Yes' : 'No', inline: true }
                )
                .setFooter({ text: 'Kavià Café • Ranking System' })
                .setTimestamp();

            const logChannel = await client.channels.fetch(process.env.RANKING_LOG_CHANNEL);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [logEmbed] });

            const replyEmbed = new EmbedBuilder()
                .setTitle('✅ Termination Successful')
                .setColor(0xE74C3C)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '🎮 Roblox User', value: robloxUsername, inline: true },
                    { name: '🏷️ Previous Rank', value: devRole.name, inline: true },
                    { name: '🔧 Dev Group', value: '✅ Removed', inline: true }
                )
                .setFooter({ text: 'Kavià Café • Ranking System' })
                .setTimestamp();

            await interaction.editReply({ embeds: [replyEmbed] });

        } catch (err) {
            console.error('Error in /rankterminate command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};