const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const HRD_GUILD_ID = '1434556801096876034';
const HRD_LEADERSHIP_ROLE = '1464029366034890812';

// HRD server role -> Main server role
const HRD_ROLE_MAP = {
    '1372326605518802955': '1464028063909019882', // Moderation Team
    '1373135168784695416': '1464027433476030690', // Trial Moderator
    '1373135108092989440': '1464027469999902812', // Junior Moderator
    '1373134928337965056': '1464027469999902812', // Moderator
    '1373134577174057080': '1464027539537137938', // Senior Moderator
    '1373134536111820881': '1464027539537137938', // Head Moderator
    '1373551504773877790': '1464028279131340843', // Moderation Department
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hrdcheck')
        .setDescription('Sync HRD moderation roles to the main server')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to sync (leave blank to sync all)').setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.roles.cache.has(HRD_LEADERSHIP_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
            const hrdGuild = await client.guilds.fetch(HRD_GUILD_ID);
            await mainGuild.members.fetch();
            await hrdGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [hrdGuild.members.cache.get(targetUser.id)].filter(Boolean)
                : [...hrdGuild.members.cache.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const hrdMember of membersToSync) {
                if (hrdMember.user.bot) continue;
                const mainMember = mainGuild.members.cache.get(hrdMember.id);
                if (!mainMember) { skipped++; continue; }

                for (const [hrdRoleId, mainRoleId] of Object.entries(HRD_ROLE_MAP)) {
                    const hasInHRD = hrdMember.roles.cache.has(hrdRoleId);
                    const hasInMain = mainMember.roles.cache.has(mainRoleId);

                    if (hasInHRD && !hasInMain) {
                        await mainMember.roles.add(mainRoleId).catch(() => {});
                        added++;
                        changes.push(`➕ **${mainMember.user.tag}** → added \`${mainRoleId}\``);
                    } else if (!hasInHRD && hasInMain) {
                        // Only remove if they also don't have any other hrd role that maps to this main role
                        const anyOtherHRDRoleGivesThis = Object.entries(HRD_ROLE_MAP)
                            .filter(([k, v]) => v === mainRoleId && k !== hrdRoleId)
                            .some(([k]) => hrdMember.roles.cache.has(k));
                        if (!anyOtherHRDRoleGivesThis) {
                            await mainMember.roles.remove(mainRoleId).catch(() => {});
                            removed++;
                            changes.push(`➖ **${mainMember.user.tag}** → removed \`${mainRoleId}\``);
                        }
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ HRD Role Sync Complete')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '➕ Roles Added', value: String(added), inline: true },
                    { name: '➖ Roles Removed', value: String(removed), inline: true },
                    { name: '⏭️ Skipped (not in main)', value: String(skipped), inline: true }
                )
                .setFooter({ text: 'Kavià Café • HRD Role Sync' })
                .setTimestamp();

            if (changes.length > 0) {
                const changeText = changes.slice(0, 20).join('\n');
                embed.addFields({ name: '📋 Changes', value: changeText.substring(0, 1024) });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /hrdcheck:', err);
            try { await interaction.editReply({ content: '❌ Error running sync.' }); } catch {}
        }
    }
};