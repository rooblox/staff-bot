const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAuditLog, getGroupRanks, setRank, getRobloxUsername } = require('./roblox');

const ALLOWED_USER_IDS = ['576954029016481802', '723993357700956181'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revertabuse')
        .setDescription('Revert all rank changes made in the past 24 hours'),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const groupId = process.env.ROBLOX_MAIN_GROUP;
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

            await interaction.editReply({ content: '⏳ Fetching audit log and reverting rank changes...' });

            const auditLog = await getAuditLog(groupId, 100);

            if (!auditLog || auditLog.length === 0) {
                return interaction.editReply({ content: '✅ No rank changes found in the audit log.' });
            }

            // Filter to last 24 hours only
            const recentChanges = auditLog.filter(entry => {
                const entryDate = new Date(entry.created);
                return entryDate >= cutoff;
            });

            if (recentChanges.length === 0) {
                return interaction.editReply({ content: '✅ No rank changes found in the past 24 hours.' });
            }

            const allRanks = await getGroupRanks(groupId);
            const reverted = [];
            const failed = [];

            for (const entry of recentChanges) {
                try {
                    const userId = entry.actor?.user?.userId || entry.targetId;
                    const oldRoleId = entry.description?.OldRoleSetId;
                    const oldRoleName = entry.description?.OldRoleSetName;
                    const newRoleName = entry.description?.NewRoleSetName;
                    const targetUserId = entry.description?.TargetId || entry.targetId;
                    const targetUsername = entry.description?.TargetName || await getRobloxUsername(targetUserId);

                    if (!oldRoleId || !targetUserId) continue;

                    // Find the old role in our ranks list
                    const oldRole = allRanks.find(r => String(r.id) === String(oldRoleId));
                    if (!oldRole) continue;

                    const success = await setRank(groupId, targetUserId, oldRoleId);

                    if (success) {
                        reverted.push(`**${targetUsername}**: ${newRoleName} → ${oldRoleName}`);
                    } else {
                        failed.push(`**${targetUsername}**: failed to revert`);
                    }

                    // Small delay to avoid rate limits
                    await new Promise(r => setTimeout(r, 500));

                } catch (err) {
                    console.error('Error reverting entry:', err);
                    failed.push(`Unknown user: error reverting`);
                }
            }

            // Log to ranking channel
            const logChannel = await client.channels.fetch(process.env.RANKING_LOG_CHANNEL);
            if (logChannel?.isTextBased()) {
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⚠️ Rank Abuse Revert Executed')
                            .setColor(0xE74C3C)
                            .addFields(
                                { name: '👮 Executed By', value: interaction.user.tag },
                                { name: `✅ Successfully Reverted (${reverted.length})`, value: reverted.length > 0 ? reverted.slice(0, 20).join('\n') : 'None' },
                                { name: `❌ Failed (${failed.length})`, value: failed.length > 0 ? failed.join('\n') : 'None' },
                                { name: '📅 Timeframe', value: 'Last 24 hours' }
                            )
                            .setFooter({ text: 'Kavià Café • Revert Abuse' })
                            .setTimestamp()
                    ]
                });
            }

            await interaction.editReply({
                content: `✅ Revert complete!\n\n**Reverted (${reverted.length}):**\n${reverted.length > 0 ? reverted.slice(0, 10).join('\n') : 'None'}\n\n**Failed (${failed.length}):**\n${failed.length > 0 ? failed.join('\n') : 'None'}`
            });

        } catch (err) {
            console.error('Error in /revertabuse command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};