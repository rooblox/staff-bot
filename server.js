const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const INTERVIEW_LOG_CHANNEL = process.env.INTERVIEW_LOG_CHANNEL || '1422682430099165266';
const TRAINING_LOG_CHANNEL = process.env.TRAINING_LOG_CHANNEL || '';
const EXPRESS_SECRET = process.env.EXPRESS_SECRET || 'kavia_secret_2026';
const GROUP_ID = '13827902';
const TRAINEE_RANK_ID = 105241068;
const BARISTA_RANK_ID = process.env.BARISTA_RANK_ID || 0;
const REQUIRED_ROLE_ID = process.env.RANKING_REQUIRED_ROLE || '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

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

    try {
        const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
        const member = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(REQUIRED_ROLE_ID)) {
            await interaction.reply({ content: '❌ You do not have permission to rank users.', ephemeral: true });
            return true;
        }
    } catch {
        await interaction.reply({ content: '❌ Permission check failed.', ephemeral: true });
        return true;
    }

    const prefix        = isInterview ? 'rank_interview_' : 'rank_training_';
    const rankId        = isInterview ? TRAINEE_RANK_ID : parseInt(BARISTA_RANK_ID);
    const rankLabel     = isInterview ? 'Trainee (Awaiting Training)' : 'Barista';
    const withoutPrefix = interaction.customId.replace(prefix, '');
    const firstUnderscore = withoutPrefix.indexOf('_');
    const userId   = withoutPrefix.substring(0, firstUnderscore);
    const username = withoutPrefix.substring(firstUnderscore + 1);

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

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