const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const MOD_GUILD_ID = '1301333604315561994';
const MOD_LEADERSHIP_ROLE = '1464028782980632587';

// main role ID -> mod server role ID(s)
const MOD_ROLE_MAP = {
    '1464028063909019882': ['1372326605518802955'], // Moderation Team
    '1464027433476030690': ['1373135168784695416'], // Trial Moderator
    '1464027469999902812': ['1373135108092989440', '1373134928337965056'], // Junior Mod / Moderator
    '1464027539537137938': ['1373134577174057080', '1373134536111820881'], // Senior Mod / Head Mod
    '1464028279131340843': ['1373551504773877790'], // Moderation Department
    '1434563855354167358': ['1434612807223218216'], // Human Resources Department
};

// Never touch these — assigned manually
const MANUAL_MAIN_ROLES = new Set([
    '1464028782980632587', // Moderation Leadership
    '1464029366034890812', // HR Leadership
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

            // Fetch all members into Maps directly
            const mainMembers = await mainGuild.members.fetch();
            const modMembers = await modGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [mainMembers.get(targetUser.id)].filter(Boolean)
                : [...mainMembers.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const mainMember of membersToSync) {
                if (mainMember.user.bot) continue;

                const modMember = modMembers.get(mainMember.id);

                if (!modMember) {
                    // Not in mod server — remove all mapped main roles except manual ones
                    for (const mainRoleId of Object.keys(MOD_ROLE_MAP)) {
                        if (MANUAL_MAIN_ROLES.has(mainRoleId)) continue;
                        if (mainMember.roles.cache.has(mainRoleId)) {
                            await mainMember.roles.remove(mainRoleId).catch(err => console.error(`Failed to remove role ${mainRoleId}:`, err));
                            removed++;
                            changes.push(`➖ **${mainMember.user.tag}** → removed <@&${mainRoleId}>`);
                        }
                    }
                    skipped++;
                    continue;
                }

                for (const [mainRoleId, modRoleIds] of Object.entries(MOD_ROLE_MAP)) {
                    if (MANUAL_MAIN_ROLES.has(mainRoleId)) continue;

                    const hasInMod = modRoleIds.some(id => modMember.roles.cache.has(id));
                    const hasInMain = mainMember.roles.cache.has(mainRoleId);

                    if (hasInMod && !hasInMain) {
                        await mainMember.roles.add(mainRoleId).catch(err => console.error(`Failed to add role ${mainRoleId}:`, err));
                        added++;
                        changes.push(`➕ **${mainMember.user.tag}** → added <@&${mainRoleId}>`);
                    } else if (!hasInMod && hasInMain) {
                        await mainMember.roles.remove(mainRoleId).catch(err => console.error(`Failed to remove role ${mainRoleId}:`, err));
                        removed++;
                        changes.push(`➖ **${mainMember.user.tag}** → removed <@&${mainRoleId}>`);
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Mod Role Sync Complete')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '➕ Roles Added', value: String(added), inline: true },
                    { name: '➖ Roles Removed', value: String(removed), inline: true },
                    { name: '⏭️ Not in Mod server', value: String(skipped), inline: true }
                )
                .setFooter({ text: 'Kavià Café • Mod Role Sync' })
                .setTimestamp();

            embed.addFields({
                name: '📋 Changes',
                value: changes.length > 0 ? changes.slice(0, 20).join('\n').substring(0, 1024) : 'No changes needed — all roles are in sync!'
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /modcheck:', err);
            try { await interaction.editReply({ content: `❌ Error running sync: ${err.message}` }); } catch {}
        }
    }
};