const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const GROUP_ID = '13827902';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookuproblox')
        .setDescription('Look up a Roblox user\'s info and group rank')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox username to look up')
                .setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});

        try {
            const username = interaction.options.getString('username');

            const userLookupRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
            });
            const userLookupData = await userLookupRes.json();

            if (!userLookupData.data || userLookupData.data.length === 0) {
                return interaction.editReply({ content: `❌ No Roblox user found with the username **${username}**.` });
            }

            const robloxUser = userLookupData.data[0];
            const userId = robloxUser.id;

            const [userInfoRes, groupRolesRes, thumbnailRes] = await Promise.all([
                fetch(`https://users.roblox.com/v1/users/${userId}`),
                fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`),
                fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`)
            ]);

            const userInfo = await userInfoRes.json();
            const groupRolesData = await groupRolesRes.json();
            const thumbnailData = await thumbnailRes.json();

            const groupMembership = groupRolesData.data?.find(g => String(g.group.id) === GROUP_ID);
            const groupRank = groupMembership ? groupMembership.role.name : 'Not in group';

            const accountCreated = new Date(userInfo.created);
            const accountAge = Math.floor((Date.now() - accountCreated.getTime()) / (1000 * 60 * 60 * 24));

            const avatarUrl = thumbnailData.data?.[0]?.imageUrl || null;

            const embed = new EmbedBuilder()
                .setTitle(`🎮 Roblox Lookup — ${robloxUser.name}`)
                .setColor(0x3498DB)
                .setURL(`https://www.roblox.com/users/${userId}/profile`)
                .addFields(
                    { name: '🆔 User ID', value: String(userId), inline: true },
                    { name: '🏷️ Display Name', value: robloxUser.displayName || robloxUser.name, inline: true },
                    { name: '🏢 Group Rank', value: groupRank, inline: true },
                    { name: '📅 Account Created', value: `<t:${Math.floor(accountCreated.getTime() / 1000)}:D>`, inline: true },
                    { name: '⏳ Account Age', value: `${accountAge} days`, inline: true },
                    { name: '🚫 Banned', value: userInfo.isBanned ? 'Yes' : 'No', inline: true }
                )
                .setFooter({ text: 'Kavià Café • Roblox Lookup' })
                .setTimestamp();

            if (avatarUrl) embed.setThumbnail(avatarUrl);

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /lookuproblox:', err);
            try { await interaction.editReply({ content: '❌ Error looking up that Roblox user.' }); } catch {}
        }
    }
};