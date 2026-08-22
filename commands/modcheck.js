const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const MOD_GUILD_ID = '1301333604315561994';
const MOD_LEADERSHIP_ROLE = '1464028782980632587';

// Mod server role -> Main server role
// Leadership roles (1464028782980632587, 1464029366034890812) are manual — bot does NOT touch them
const MOD_ROLE_MAP = {
    '1372326605518802955': '1464028063909019882', // Moderation Team
    '1373135168784695416': '1464027433476030690', // Trial Moderator
    '1373135108092989440': '1464027469999902812', // Junior Moderator
    '1373134928337965056': '1464027469999902812', // Moderator
    '1373134577174057080': '1464027539537137938', // Senior Moderator
    '1373134536111820881': '1464027539537137938', // Head Moderator
    '1373551504773877790': '1464028279131340843', // Moderation Department
    '1434612807223218216': '1434563855354167358', // Human Resources Department
};

// These main server roles are managed manually — bot never removes them
const MANUAL_MAIN_ROLES = new Set([
    '1464028782980632587', // Moderation Leadership (main)
    '1464029366034890812', // HR Leadership (main)
]);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modcheck')
        .setDescription('Sync mod server roles to the main server')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to sync (leave blank to sync all)').setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.roles.cache.has(MOD_LEADERSHIP_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
            const modGuild = await client.guilds.fetch(MOD_GUILD_ID);
            await mainGuild.members.fetch();
            await modGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [modGuild.members.cache.get(targetUser.id)].filter(Boolean)
                : [...modGuild.members.cache.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const modMember of membersToSync) {
                if (modMember.user.bot) continue;
                const mainMember = mainGuild.members.cache.get(modMember.id);
                if (!mainMember) { skipped++; continue; }

                for (const [modRoleId, mainRoleId] of Object.entries(MOD_ROLE_MAP)) {
                    // Never touch manually managed roles
                    if (MANUAL_MAIN_ROLES.has(mainRoleId)) continue;

                    const hasInMod = modMember.roles.cache.has(modRoleId);
                    const hasInMain = mainMember.roles.cache.has(mainRoleId);

                    if (hasInMod && !hasInMain) {
                        await mainMember.roles.add(mainRoleId).catch(() => {});
                        added++;
                        changes.push(`➕ **${mainMember.user.tag}** → added \`${mainRoleId}\``);
                    } else if (!hasInMod && hasInMain) {
                        // Only remove if no other mod role maps to this main role
                        const anyOtherModRoleGivesThis = Object.entries(MOD_ROLE_MAP)
                            .filter(([k, v]) => v === mainRoleId && k !== modRoleId)
                            .some(([k]) => modMember.roles.cache.has(k));
                        if (!anyOtherModRoleGivesThis) {
                            await mainMember.roles.remove(mainRoleId).catch(() => {});
                            removed++;
                            changes.push(`➖ **${mainMember.user.tag}** → removed \`${mainRoleId}\``);
                        }
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Mod Role Sync Complete')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '➕ Roles Added', value: String(added), inline: true },
                    { name: '➖ Roles Removed', value: String(removed), inline: true },
                    { name: '⏭️ Skipped (not in main)', value: String(skipped), inline: true }
                )
                .setFooter({ text: 'Kavià Café • Mod Role Sync' })
                .setTimestamp();

            if (changes.length > 0) {
                const changeText = changes.slice(0, 20).join('\n');
                embed.addFields({ name: '📋 Changes', value: changeText.substring(0, 1024) });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /modcheck:', err);
            try { await interaction.editReply({ content: '❌ Error running sync.' }); } catch {}
        }
    }
};