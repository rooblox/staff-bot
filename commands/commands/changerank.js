const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getRobloxIdFromUsername, getAvatarUrl, getGroupRanks, getUserRankInGroup } = require('./roblox');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

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
        .setName('changerank')
        .setDescription('Change a user to a specific rank in the main Roblox group')
        .addStringOption(option =>
            option.setName('roblox_username').setDescription('Roblox username of the user').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for rank change').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPARTMENTS))
        .addUserOption(option =>
            option.setName('discord_user').setDescription('Discord user to DM (optional)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
            const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
            if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const robloxUsername = interaction.options.getString('roblox_username');
            const reason = interaction.options.getString('reason');
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

            const sortedRanks = allRanks.sort((a, b) => a.rank - b.rank).slice(0, 25);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`changerank_select_${robloxId}_${groupId}`)
                .setPlaceholder('Select a rank...')
                .addOptions(sortedRanks.map(r => ({
                    label: r.name,
                    value: String(r.id),
                    description: `Rank ${r.rank}`,
                    default: currentRole?.id === r.id
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const previewEmbed = new EmbedBuilder()
                .setTitle(`🔄 Change Rank — ${robloxUsername}`)
                .setColor(0x3498DB)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '🎮 Roblox User', value: robloxUsername, inline: true },
                    { name: '🏷️ Current Rank', value: currentRole.name, inline: true }
                )
                .setDescription('Select the new rank from the dropdown below.')
                .setFooter({ text: 'Kavià Café • Ranking System' })
                .setTimestamp();

            await interaction.editReply({
                embeds: [previewEmbed],
                components: [row]
            });

            if (!client.rankChangeContext) client.rankChangeContext = new Map();
            client.rankChangeContext.set(`${robloxId}_${groupId}`, {
                robloxUsername,
                robloxId,
                avatarUrl,
                groupId,
                reason,
                department,
                discordUser,
                staffUser: interaction.user,
                currentRole
            });

            setTimeout(() => {
                client.rankChangeContext?.delete(`${robloxId}_${groupId}`);
            }, 5 * 60 * 1000);

        } catch (err) {
            console.error('Error in /changerank command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};