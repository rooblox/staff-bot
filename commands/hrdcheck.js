const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const HRD_GUILD_ID = '1434556801096876034';
const HRD_LEADERSHIP_ROLE = '1464029366034890812';

// main role ID -> HRD server role ID(s)
const HRD_ROLE_MAP = {
    '1464028063909019882': ['1372326605518802955'], // Moderation Team
    '1464027433476030690': ['1373135168784695416'], // Trial Moderator
    '1464027469999902812': ['1373135108092989440', '1373134928337965056'], // Junior Mod / Moderator
    '1464027539537137938': ['1373134577174057080', '1373134536111820881'], // Senior Mod / Head Mod
    '1464028279131340843': ['1373551504773877790'], // Moderation Department
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

            // Fetch all members into Maps directly
            const mainMembers = await mainGuild.members.fetch();
            const hrdMembers = await hrdGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [mainMembers.get(targetUser.id)].filter(Boolean)
                : [...mainMembers.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const mainMember of membersToSync) {
                if (mainMember.user.bot) continue;

                const hrdMember = hrdMembers.get(mainMember.id);

                if (!hrdMember) {
                    // Not in HRD server — remove all mapped main roles
                    for (const mainRoleId of Object.keys(HRD_ROLE_MAP)) {
                        if (mainMember.roles.cache.has(mainRoleId)) {
                            await mainMember.roles.remove(mainRoleId).catch(err => console.error(`Failed to remove role ${mainRoleId}:`, err));
                            removed++;
                            changes.push(`➖ **${mainMember.user.tag}** → removed <@&${mainRoleId}>`);
                        }
                    }
                    skipped++;
                    continue;
                }

                for (const [mainRoleId, hrdRoleIds] of Object.entries(HRD_ROLE_MAP)) {
                    const hasInHRD = hrdRoleIds.some(id => hrdMember.roles.cache.has(id));
                    const hasInMain = mainMember.roles.cache.has(mainRoleId);

                    if (hasInHRD && !hasInMain) {
                        await mainMember.roles.add(mainRoleId).catch(err => console.error(`Failed to add role ${mainRoleId}:`, err));
                        added++;
                        changes.push(`➕ **${mainMember.user.tag}** → added <@&${mainRoleId}>`);
                    } else if (!hasInHRD && hasInMain) {
                        await mainMember.roles.remove(mainRoleId).catch(err => console.error(`Failed to remove role ${mainRoleId}:`, err));
                        removed++;
                        changes.push(`➖ **${mainMember.user.tag}** → removed <@&${mainRoleId}>`);
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ HRD Role Sync Complete')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '➕ Roles Added', value: String(added), inline: true },
                    { name: '➖ Roles Removed', value: String(removed), inline: true },
                    { name: '⏭️ Not in HRD server', value: String(skipped), inline: true }
                )
                .setFooter({ text: 'Kavià Café • HRD Role Sync' })
                .setTimestamp();

            embed.addFields({
                name: '📋 Changes',
                value: changes.length > 0 ? changes.slice(0, 20).join('\n').substring(0, 1024) : 'No changes needed — all roles are in sync!'
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /hrdcheck:', err);
            try { await interaction.editReply({ content: `❌ Error running sync: ${err.message}` }); } catch {}
        }
    }
};