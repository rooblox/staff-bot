const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const HRD_GUILD_ID = '1434556801096876034';
const HRD_LEADERSHIP_ROLE = '1464029366034890812';

// HRD server role -> Main server role
// If user HAS left side role in HRD server, give them right side role in main server
// If user is MISSING left side role in HRD server, remove right side role from main server
const HRD_ROLE_MAP = [
    { dept: '1372326605518802955', main: '1464028063909019882' }, // Moderation Team
    { dept: '1373135168784695416', main: '1464027433476030690' }, // Trial Moderator
    { dept: '1373135108092989440', main: '1464027469999902812' }, // Junior Moderator
    { dept: '1373134928337965056', main: '1464027469999902812' }, // Moderator
    { dept: '1373134577174057080', main: '1464027539537137938' }, // Senior Moderator
    { dept: '1373134536111820881', main: '1464027539537137938' }, // Head Moderator
    { dept: '1373551504773877790', main: '1464028279131340843' }, // Moderation Department
];

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

            const mainMembers = await mainGuild.members.fetch();
            const hrdMembers = await hrdGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [hrdMembers.get(targetUser.id)].filter(Boolean)
                : [...hrdMembers.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const hrdMember of membersToSync) {
                if (hrdMember.user.bot) continue;

                const mainMember = mainMembers.get(hrdMember.id);
                if (!mainMember) { skipped++; continue; }

                // Group by main role — if ANY dept role maps to it, they should have it
                const mainRolesNeeded = new Set();
                for (const { dept, main } of HRD_ROLE_MAP) {
                    if (hrdMember.roles.cache.has(dept)) {
                        mainRolesNeeded.add(main);
                    }
                }

                // All unique main roles covered by this map
                const allMainRoles = new Set(HRD_ROLE_MAP.map(r => r.main));

                for (const mainRoleId of allMainRoles) {
                    const shouldHave = mainRolesNeeded.has(mainRoleId);
                    const hasInMain = mainMember.roles.cache.has(mainRoleId);

                    if (shouldHave && !hasInMain) {
                        await mainMember.roles.add(mainRoleId).catch(err => console.error(`Failed to add ${mainRoleId} to ${mainMember.user.tag}:`, err));
                        added++;
                        changes.push(`➕ **${mainMember.user.tag}** → added <@&${mainRoleId}>`);
                    } else if (!shouldHave && hasInMain) {
                        await mainMember.roles.remove(mainRoleId).catch(err => console.error(`Failed to remove ${mainRoleId} from ${mainMember.user.tag}:`, err));
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
                    { name: '⏭️ Not in main server', value: String(skipped), inline: true }
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
            try { await interaction.editReply({ content: `❌ Error: ${err.message}` }); } catch {}
        }
    }
};