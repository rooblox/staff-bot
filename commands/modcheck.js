const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const MOD_GUILD_ID = '1301333604315561994';
const MOD_LEADERSHIP_ROLE = '1464028782980632587';

// Mod server role -> Main server role
// If user HAS left side role in mod server, give them right side role in main server
// If user is MISSING left side role in mod server, remove right side role from main server
const MOD_ROLE_MAP = [
    { dept: '1372326605518802955', main: '1464028063909019882' }, // Moderation Team
    { dept: '1373135168784695416', main: '1464027433476030690' }, // Trial Moderator
    { dept: '1373135108092989440', main: '1464027469999902812' }, // Junior Moderator
    { dept: '1373134928337965056', main: '1464027469999902812' }, // Moderator
    { dept: '1373134577174057080', main: '1464027539537137938' }, // Senior Moderator
    { dept: '1373134536111820881', main: '1464027539537137938' }, // Head Moderator
    { dept: '1373551504773877790', main: '1464028279131340843' }, // Moderation Department
    { dept: '1434612807223218216', main: '1434563855354167358' }, // Human Resources Department
];

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

            const mainMembers = await mainGuild.members.fetch();
            const modMembers = await modGuild.members.fetch();

            const targetUser = interaction.options.getUser('user');
            const membersToSync = targetUser
                ? [modMembers.get(targetUser.id)].filter(Boolean)
                : [...modMembers.values()];

            let added = 0, removed = 0, skipped = 0;
            const changes = [];

            for (const modMember of membersToSync) {
                if (modMember.user.bot) continue;

                const mainMember = mainMembers.get(modMember.id);
                if (!mainMember) { skipped++; continue; }

                // Work out which main roles this user should have based on their dept roles
                const mainRolesNeeded = new Set();
                for (const { dept, main } of MOD_ROLE_MAP) {
                    if (modMember.roles.cache.has(dept)) {
                        mainRolesNeeded.add(main);
                    }
                }

                // All unique main roles covered by this map (excluding manual ones)
                const allMainRoles = new Set(
                    MOD_ROLE_MAP.map(r => r.main).filter(id => !MANUAL_MAIN_ROLES.has(id))
                );

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
                .setTitle('✅ Mod Role Sync Complete')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '➕ Roles Added', value: String(added), inline: true },
                    { name: '➖ Roles Removed', value: String(removed), inline: true },
                    { name: '⏭️ Not in main server', value: String(skipped), inline: true }
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
            try { await interaction.editReply({ content: `❌ Error: ${err.message}` }); } catch {}
        }
    }
};