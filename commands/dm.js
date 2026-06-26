const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEPARTMENTS, MAIN_GUILD_ID, MAIN_REQUIRED_ROLE_ID } = require('./departments');

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

async function hasBotPermsRole(client, guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;

        // Check the department config for this server
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }

        // Fallback to main server required role
        if (guildId === MAIN_GUILD_ID && member.roles.cache.has(MAIN_REQUIRED_ROLE_ID)) return true;

        return false;
    } catch {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a staff direct message to a user or multiple roles')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Send to a single user or to roles')
                .setRequired(true)
                .addChoices(
                    { name: 'User', value: 'user' },
                    { name: 'Roles', value: 'roles' }
                ))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to send')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('member')
                .setDescription('Select the user to DM (required if mode is User)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('roles')
                .setDescription('Role IDs to DM, comma separated (required if mode is Roles)')
                .setRequired(false)),

    async execute(interaction, client) {
        const mode = interaction.options.getString('mode');
        const messageContent = interaction.options.getString('message');
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

        const logChannelId = SERVER_LOG_CHANNELS[interaction.guildId] || DEFAULT_LOG_CHANNEL;
        const deptName = DEPT_NAMES[interaction.guildId] || 'Kavià Café';

        const hasPerms = await hasBotPermsRole(client, interaction.guildId, interaction.user.id);
        if (!hasPerms) {
            return interaction.reply({ content: '❌ You do not have permission to use this command in this server.', ephemeral: true });
        }

        if (mode === 'user') {
            const user = interaction.options.getUser('member');
            if (!user) {
                return interaction.reply({ content: '❌ You must select a member when using User mode.', ephemeral: true });
            }

            if (!client.dmLogChannels) client.dmLogChannels = new Map();
            client.dmLogChannels.set(user.id, logChannelId);

            try {
                const userEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📩 **Staff Direct Message**')
                    .setDescription(`**${messageContent}**`)
                    .addFields(
                        { name: '\u200B', value: `**${deptName}**` },
                        { name: '🕒 Time & Date', value: timestamp }
                    )
                    .setFooter({ text: 'Kavià Café Staff Team' });

                await user.send({ embeds: [userEmbed] });

                await interaction.reply({ content: `✅ DM sent to **${user.tag}**`, ephemeral: true });

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
                    .setFooter({ text: 'Kavià Café • DM Logs' });

                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) await logChannel.send({ embeds: [logEmbed] });

            } catch (error) {
                console.error('DM command error:', error);
                if (!interaction.replied) {
                    await interaction.reply({ content: `❌ Could not DM ${user.tag}. They may have DMs closed.`, ephemeral: true });
                }
            }
            return;
        }

        if (mode === 'roles') {
            const rolesRaw = interaction.options.getString('roles');
            if (!rolesRaw) {
                return interaction.reply({ content: '❌ You must provide role IDs when using Roles mode.', ephemeral: true });
            }

            const roleIds = rolesRaw.split(',').map(r => r.trim()).filter(r => r.length > 0);
            if (roleIds.length === 0) {
                return interaction.reply({ content: '❌ No valid role IDs provided.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true }).catch(() => {});

            try {
                const guild = interaction.guild;
                await guild.members.fetch();

                const validRoleIds = roleIds.filter(id => guild.roles.cache.has(id));
                if (validRoleIds.length === 0) {
                    return interaction.editReply({ content: '❌ None of the provided role IDs exist in this server.' });
                }

                const targetMembers = new Map();
                for (const roleId of validRoleIds) {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) continue;
                    for (const member of role.members.values()) {
                        if (!member.user.bot) targetMembers.set(member.id, member);
                    }
                }

                if (targetMembers.size === 0) {
                    return interaction.editReply({ content: '❌ No members found with the provided roles.' });
                }

                let successCount = 0;
                let failCount = 0;

                if (!client.dmLogChannels) client.dmLogChannels = new Map();

                for (const member of targetMembers.values()) {
                    client.dmLogChannels.set(member.id, logChannelId);
                    try {
                        const userEmbed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('📩 **Staff Direct Message**')
                            .setDescription(`**${messageContent}**`)
                            .addFields(
                                { name: '\u200B', value: `**${deptName}**` },
                                { name: '🕒 Time & Date', value: timestamp }
                            )
                            .setFooter({ text: 'Kavià Café Staff Team' });

                        await member.send({ embeds: [userEmbed] });
                        successCount++;
                    } catch {
                        failCount++;
                    }
                }

                await interaction.editReply({ content: `✅ Mass DM complete!\n📨 Sent: **${successCount}**\n❌ Failed (DMs closed): **${failCount}**\n👥 Total targeted: **${targetMembers.size}**` });

                const roleMentions = validRoleIds.map(id => `<@&${id}>`).join(', ');
                const logEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('💬 **Mass DM Sent (Roles)**')
                    .addFields(
                        { name: '📤 From (Staff)', value: `${interaction.user.tag} (${interaction.user.id})` },
                        { name: '🏷️ Roles Targeted', value: roleMentions },
                        { name: '👥 Total Targeted', value: String(targetMembers.size), inline: true },
                        { name: '✅ Sent', value: String(successCount), inline: true },
                        { name: '❌ Failed', value: String(failCount), inline: true },
                        { name: '📝 Message', value: messageContent },
                        { name: '🏢 Department', value: deptName },
                        { name: '🕒 Date & Time', value: timestamp }
                    )
                    .setFooter({ text: 'Kavià Café • DM Logs' });

                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) await logChannel.send({ embeds: [logEmbed] });

            } catch (err) {
                console.error('Mass DM (roles) error:', err);
                try { await interaction.editReply({ content: '❌ Error sending mass DM.' }); } catch {}
            }
            return;
        }
    }
};