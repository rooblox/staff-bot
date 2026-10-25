const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const INTERVIEW_LOG_CHANNEL = process.env.INTERVIEW_LOG_CHANNEL || '1422682430099165266';
const TRAINING_LOG_CHANNEL = process.env.TRAINING_LOG_CHANNEL || '';
const STAFF_LOG_CHANNEL = process.env.STAFF_LOG_CHANNEL || '1469767525725376595';
const WEEKLY_BOARD_CHANNEL = process.env.WEEKLY_BOARD_CHANNEL || '';
const EXPRESS_SECRET = process.env.EXPRESS_SECRET || 'kavia_secret_2026';
const GROUP_ID = '13827902';
const TRAINEE_RANK_ID = 105241068;
const BARISTA_RANK_ID = process.env.BARISTA_RANK_ID || 0;
const REQUIRED_ROLE_ID = process.env.RANKING_REQUIRED_ROLE || '1434976120687558667';
const MAIN_GUILD_ID = '1370892833182974035';

// XP auto-promotion: only these fromRoleId → toRoleId pairs are allowed
const ALLOWED_PROMOTIONS = {
    105241068: 105241076,
    105241076: 105241070,
    105241070: 105241078,
};

function createServer(client) {
    const app = express();
    app.use(express.json());

    process.on('uncaughtException', (err) => {
        console.error('❌ Uncaught Exception in server:', err);
    });

    // ========== INTERVIEW RESULT ENDPOINT ==========
    app.post('/interview', async (req, res) => {
        try {
            const { secret, username, userId, score, totalQuestions, duration, result, groupRole } = req.body;

            if (secret !== EXPRESS_SECRET) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            if (!username || !userId || score === undefined || !result) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            const isPassed = result === 'pass';
            const color = isPassed ? 0x2ECC71 : 0xE74C3C;
            const statusText = isPassed ? '✅ PASSED' : '❌ FAILED';
            const rankingStatus = isPassed ? '⏳ Awaiting Manual Rank' : '❌ Not Eligible';

            const embed = new EmbedBuilder()
                .setTitle('📋 Kavià Café Interview Log')
                .setColor(color)
                .addFields(
                    { name: '👤 Applicant', value: `${username} (\`${userId}\`)`, inline: false },
                    { name: '📊 Result', value: statusText, inline: true },
                    { name: '📝 Score', value: `${score} / ${totalQuestions || 10}`, inline: true },
                    { name: '⏱️ Duration', value: `${duration} seconds`, inline: true },
                    { name: '🎮 Group Rank', value: groupRole || 'Not in group / Unknown', inline: true },
                    { name: '🏷️ Ranking Status', value: rankingStatus, inline: false }
                )
                .setFooter({ text: 'Kavià Café Interview System • Automated Log' })
                .setTimestamp();

            const logChannel = await client.channels.fetch(INTERVIEW_LOG_CHANNEL);
            if (!logChannel?.isTextBased()) {
                return res.status(500).json({ success: false, error: 'Log channel not found' });
            }

            if (isPassed) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rank_interview_${userId}_${username}`)
                        .setLabel('🎮 Rank User')
                        .setStyle(ButtonStyle.Success)
                );
                await logChannel.send({ embeds: [embed], components: [row] });
            } else {
                await logChannel.send({ embeds: [embed] });
            }

            return res.status(200).json({ success: true });

        } catch (err) {
            console.error('Error handling interview result:', err);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });

    // ========== TRAINING RESULT ENDPOINT ==========
    app.post('/training', async (req, res) => {
        try {
            const secret = req.headers['x-secret'];
            if (secret !== EXPRESS_SECRET) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const { userId, username, displayName, passed, score, total } = req.body;

            if (!username || !userId || score === undefined || passed === undefined) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            const color = passed ? 0x2ECC71 : 0xE74C3C;
            const statusText = passed ? '✅ PASSED' : '❌ FAILED';
            const rankingStatus = passed ? '⏳ Awaiting Rank' : '❌ Not Eligible';

            const embed = new EmbedBuilder()
                .setTitle('☕  Kavià Café Training Log')
                .setColor(color)
                .addFields(
                    { name: '👤 Trainee',  value: `${username} (${displayName}) \`${userId}\``, inline: false },
                    { name: '📊 Result',   value: statusText, inline: true },
                    { name: '📝 Score',    value: `${score} / ${total}`, inline: true },
                    { name: '🏷️ Status',  value: rankingStatus, inline: false }
                )
                .setFooter({ text: 'Kavià Café Training Center • Automated Log' })
                .setTimestamp();

            if (!TRAINING_LOG_CHANNEL) {
                console.error('[/training] TRAINING_LOG_CHANNEL not set');
                return res.status(500).json({ success: false, error: 'TRAINING_LOG_CHANNEL not configured' });
            }

            const logChannel = await client.channels.fetch(TRAINING_LOG_CHANNEL);
            if (!logChannel?.isTextBased()) {
                return res.status(500).json({ success: false, error: 'Training log channel not found' });
            }

            if (passed) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rank_training_${userId}_${username}`)
                        .setLabel('🎮 Rank to Barista')
                        .setStyle(ButtonStyle.Success)
                );
                await logChannel.send({ embeds: [embed], components: [row] });
            } else {
                await logChannel.send({ embeds: [embed] });
            }

            return res.status(200).json({ success: true });

        } catch (err) {
            console.error('Error handling training result:', err);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });

    // ========== XP AUTO-PROMOTION ENDPOINT ==========
    app.post('/staff-promote', async (req, res) => {
        try {
            const { secret, userId, username, displayName, fromRoleId, toRoleId, fromRank, toRank, xp } = req.body;

            if (secret !== EXPRESS_SECRET) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            if (!userId || !fromRoleId || !toRoleId) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            // Validate the promotion pair is allowed
            const allowedTo = ALLOWED_PROMOTIONS[parseInt(fromRoleId)];
            if (!allowedTo || allowedTo !== parseInt(toRoleId)) {
                console.warn(`[/staff-promote] Not allowed: ${fromRoleId} → ${toRoleId}`);
                return res.status(200).json({ success: false, error: 'not_allowed' });
            }

            // Verify current group rank matches fromRoleId before ranking
            const { getUserRankInGroup, setRank } = require('./commands/roblox');
            let currentRole;
            try {
                currentRole = await getUserRankInGroup(GROUP_ID, userId);
            } catch (err) {
                console.error(`[/staff-promote] getUserRankInGroup failed for ${userId}:`, err);
                return res.status(200).json({ success: false, error: 'rank_check_failed' });
            }

            if (!currentRole) {
                return res.status(200).json({ success: false, error: 'not_in_group' });
            }

            if (currentRole.id !== parseInt(fromRoleId)) {
                // Their rank changed since Lua checked — likely already promoted or demoted
                console.warn(`[/staff-promote] Rank mismatch for ${userId}: expected ${fromRoleId}, got ${currentRole.id}`);
                return res.status(200).json({ success: false, error: 'rank_changed' });
            }

            // Perform the rank-up
            const success = await setRank(GROUP_ID, userId, parseInt(toRoleId));
            if (!success) {
                return res.status(200).json({ success: false, error: 'rank_failed' });
            }

            // Respond to Lua immediately — async log + DM won't block it
            res.status(200).json({ success: true });

            // ── Post promotion log embed ──
            try {
                if (STAFF_LOG_CHANNEL) {
                    const logChannel = await client.channels.fetch(STAFF_LOG_CHANNEL);
                    if (logChannel?.isTextBased()) {
                        const embed = new EmbedBuilder()
                            .setTitle('⬆️ XP Promotion')
                            .setColor(0xF1C40F)
                            .addFields(
                                { name: '👤 Player',         value: `${displayName || username} (\`${username}\`)`, inline: false },
                                { name: '🆔 Roblox ID',      value: `\`${userId}\``, inline: true },
                                { name: '📈 Promotion',      value: `${fromRank} → **${toRank}**`, inline: false },
                                { name: '✨ XP at Rank-Up',  value: `${xp ?? 'N/A'}`, inline: true }
                            )
                            .setFooter({ text: 'Kavià Café XP System • Auto Promotion' })
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] });
                    }
                }
            } catch (logErr) {
                console.error('[/staff-promote] Failed to post log embed:', logErr);
            }

            // ── DM the player via RoVer if they're linked ──
            try {
                const guild = await client.guilds.fetch(MAIN_GUILD_ID);
                const roverRes = await fetch(`https://registry.rover.link/api/guilds/${MAIN_GUILD_ID}/roblox-to-discord/${userId}`);
                if (roverRes.ok) {
                    const roverData = await roverRes.json();
                    const discordId = roverData?.discordId || roverData?.user?.id;
                    if (discordId) {
                        const member = await guild.members.fetch(discordId).catch(() => null);
                        if (member) {
                            await member.send(
                                `🎉 **Congratulations!** Your hard work in Kavià Café has paid off!\n` +
                                `You've been promoted from **${fromRank}** to **${toRank}** via the XP system.\n` +
                                `Keep it up! ☕`
                            ).catch(() => {});
                        }
                    }
                }
            } catch (dmErr) {
                console.error('[/staff-promote] RoVer DM failed:', dmErr);
            }

        } catch (err) {
            console.error('[/staff-promote] Unhandled error:', err);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, error: 'Internal server error' });
            }
        }
    });

    // ========== STAFF EVENT LOG ENDPOINT ==========
    app.post('/staff-log', async (req, res) => {
        try {
            const { secret, kind, data } = req.body;

            if (secret !== EXPRESS_SECRET) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // Respond immediately so Lua isn't waiting
            res.status(200).json({ success: true });

            // Weekly board events go to their own channel
            if (kind === 'weekly_board') {
                if (!WEEKLY_BOARD_CHANNEL) {
                    console.warn('[/staff-log] WEEKLY_BOARD_CHANNEL not set, skipping weekly_board');
                    return;
                }
                try {
                    const boardChannel = await client.channels.fetch(WEEKLY_BOARD_CHANNEL);
                    if (!boardChannel?.isTextBased()) return;

                    const embed = new EmbedBuilder()
                        .setTitle('🏆 Weekly XP Leaderboard')
                        .setColor(0x9B59B6)
                        .setDescription(data?.board || 'No data provided.')
                        .setFooter({ text: 'Kavià Café XP System • Weekly Reset' })
                        .setTimestamp();

                    await boardChannel.send({ embeds: [embed] });
                } catch (boardErr) {
                    console.error('[/staff-log] Failed to post weekly board:', boardErr);
                }
                return;
            }

            // All other events → STAFF_LOG_CHANNEL
            if (!STAFF_LOG_CHANNEL) {
                console.warn('[/staff-log] STAFF_LOG_CHANNEL not set, skipping log');
                return;
            }

            try {
                const logChannel = await client.channels.fetch(STAFF_LOG_CHANNEL);
                if (!logChannel?.isTextBased()) return;

                let embed;

                switch (kind) {
                    case 'shift_start': {
                        embed = new EmbedBuilder()
                            .setTitle('🟢 Shift Started')
                            .setColor(0x2ECC71)
                            .addFields(
                                { name: '👤 Player',    value: `${data?.displayName || data?.username} (\`${data?.username}\`)`, inline: false },
                                { name: '🆔 Roblox ID', value: `\`${data?.userId}\``, inline: true },
                                { name: '📍 Server',    value: data?.placeId ? `Place \`${data.placeId}\`` : 'Unknown', inline: true }
                            )
                            .setFooter({ text: 'Kavià Café XP System • Shift Log' })
                            .setTimestamp();
                        break;
                    }
                    case 'shift_end': {
                        embed = new EmbedBuilder()
                            .setTitle('🔴 Shift Ended')
                            .setColor(0xE74C3C)
                            .addFields(
                                { name: '👤 Player',       value: `${data?.displayName || data?.username} (\`${data?.username}\`)`, inline: false },
                                { name: '🆔 Roblox ID',    value: `\`${data?.userId}\``, inline: true },
                                { name: '⏱️ Duration',     value: data?.duration ? `${data.duration} min` : 'Unknown', inline: true },
                                { name: '✨ XP Earned',    value: `${data?.xpEarned ?? 0}`, inline: true },
                                { name: '📊 Total XP',     value: `${data?.totalXp ?? 'N/A'}`, inline: true }
                            )
                            .setFooter({ text: 'Kavià Café XP System • Shift Log' })
                            .setTimestamp();
                        break;
                    }
                    case 'xp_gain': {
                        embed = new EmbedBuilder()
                            .setTitle('✨ XP Gained')
                            .setColor(0x3498DB)
                            .addFields(
                                { name: '👤 Player',    value: `${data?.displayName || data?.username} (\`${data?.username}\`)`, inline: false },
                                { name: '🆔 Roblox ID', value: `\`${data?.userId}\``, inline: true },
                                { name: '➕ XP',        value: `+${data?.amount ?? 0}`, inline: true },
                                { name: '📊 Total XP',  value: `${data?.totalXp ?? 'N/A'}`, inline: true },
                                { name: '📝 Reason',    value: data?.reason || 'Shift', inline: false }
                            )
                            .setFooter({ text: 'Kavià Café XP System • XP Log' })
                            .setTimestamp();
                        break;
                    }
                    default: {
                        embed = new EmbedBuilder()
                            .setTitle(`📋 Staff Event: ${kind}`)
                            .setColor(0x95A5A6)
                            .setDescription('```json\n' + JSON.stringify(data, null, 2).slice(0, 1800) + '\n```')
                            .setFooter({ text: 'Kavià Café XP System • Event Log' })
                            .setTimestamp();
                        break;
                    }
                }

                if (embed) await logChannel.send({ embeds: [embed] });

            } catch (logErr) {
                console.error('[/staff-log] Failed to post log embed:', logErr);
            }

        } catch (err) {
            console.error('[/staff-log] Unhandled error:', err);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, error: 'Internal server error' });
            }
        }
    });

    // ========== HEALTH CHECK ==========
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', bot: client.user?.tag || 'not ready' });
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', (err) => {
        if (err) {
            console.error('❌ Express failed to start:', err);
        } else {
            console.log(`✅ Express server running on port ${PORT}`);
        }
    });

    return app;
}

// ========== RANK BUTTON HANDLER ==========
async function handleRankButton(interaction, client) {
    const isInterview = interaction.customId.startsWith('rank_interview_');
    const isTraining  = interaction.customId.startsWith('rank_training_');
    if (!isInterview && !isTraining) return false;

    const prefix        = isInterview ? 'rank_interview_' : 'rank_training_';
    const rankId        = isInterview ? TRAINEE_RANK_ID : parseInt(BARISTA_RANK_ID);
    const rankLabel     = isInterview ? 'Trainee (Awaiting Training)' : 'Barista';
    const withoutPrefix = interaction.customId.replace(prefix, '');
    const firstUnderscore = withoutPrefix.indexOf('_');
    const userId   = withoutPrefix.substring(0, firstUnderscore);
    const username = withoutPrefix.substring(firstUnderscore + 1);

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
        const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
        const member = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(REQUIRED_ROLE_ID)) {
            await interaction.editReply({ content: '❌ You do not have permission to rank users.' });
            return true;
        }
    } catch {
        await interaction.editReply({ content: '❌ Permission check failed.' });
        return true;
    }

    try {
        const { setRank } = require('./commands/roblox');
        const success = await setRank(GROUP_ID, userId, rankId);
        const oldEmbed = interaction.message.embeds[0];

        if (success) {
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0x2ECC71)
                .spliceFields(isInterview ? 5 : 3, 1, {
                    name: '🏷️ Ranking Status',
                    value: `✅ Ranked to **${rankLabel}** by ${interaction.user.tag}`,
                    inline: false
                });
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
            await interaction.editReply({ content: `✅ Successfully ranked **${username}** to ${rankLabel}!` });
            console.log(`✅ Ranked ${username} (${userId}) to rank ${rankId}`);
        } else {
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0xE74C3C)
                .spliceFields(isInterview ? 5 : 3, 1, {
                    name: '🏷️ Ranking Status',
                    value: `❌ Ranking failed — attempted by ${interaction.user.tag}`,
                    inline: false
                });
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
            await interaction.editReply({ content: `❌ Failed to rank **${username}**. They may not be in the group or the bot lacks permission.` });
        }

    } catch (err) {
        console.error('Error ranking user:', err);
        await interaction.editReply({ content: '❌ Error occurred while ranking.' });
    }

    return true;
}

module.exports = { createServer, handleRankButton };