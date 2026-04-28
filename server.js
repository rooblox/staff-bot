const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const INTERVIEW_LOG_CHANNEL = process.env.INTERVIEW_LOG_CHANNEL || '1422682430099165266';
const EXPRESS_SECRET = process.env.EXPRESS_SECRET || 'kavia_secret_2026';
const GROUP_ID = '13827902';
const TRAINEE_RANK_ID = 105241068;
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
            const { secret, username, userId, score, totalQuestions, duration, result } = req.body;

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

    // ========== HEALTH CHECK ==========
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', bot: client.user?.tag || 'not ready' });
    });

    // ========== RANKS DEBUG ==========
    app.get('/ranks', async (req, res) => {
        try {
            const { getGroupRanks } = require('./commands/roblox');
            const ranks = await getGroupRanks('13827902');
            res.json(ranks);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
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
    if (!interaction.customId.startsWith('rank_interview_')) return false;

    console.log(`🎮 Raw customId: ${interaction.customId}`);

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

    const withoutPrefix = interaction.customId.replace('rank_interview_', '');
    const firstUnderscoreIndex = withoutPrefix.indexOf('_');
    const userId = withoutPrefix.substring(0, firstUnderscoreIndex);
    const username = withoutPrefix.substring(firstUnderscoreIndex + 1);

    console.log(`🎮 Parsed userId: ${userId}`);
    console.log(`🎮 Parsed username: ${username}`);

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
        const { setRank } = require('./commands/roblox');

        console.log(`🎮 Attempting setRank — group: ${GROUP_ID}, userId: ${userId}, rank: ${TRAINEE_RANK_ID}`);

        const success = await setRank(GROUP_ID, userId, TRAINEE_RANK_ID);

        console.log(`🎮 setRank result: ${success}`);

        const oldEmbed = interaction.message.embeds[0];

        if (success) {
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0x2ECC71)
                .spliceFields(4, 1, {
                    name: '🏷️ Ranking Status',
                    value: `✅ Ranked to **Trainee (Awaiting Training)** by ${interaction.user.tag}`,
                    inline: false
                });
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
            await interaction.editReply({ content: `✅ Successfully ranked **${username}** to Trainee (Awaiting Training)!` });
            console.log(`✅ Ranked ${username} (${userId}) to rank ${TRAINEE_RANK_ID} in group ${GROUP_ID}`);
        } else {
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0xE74C3C)
                .spliceFields(4, 1, {
                    name: '🏷️ Ranking Status',
                    value: `❌ Ranking failed — attempted by ${interaction.user.tag}`,
                    inline: false
                });
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
            await interaction.editReply({ content: `❌ Failed to rank **${username}**. They may not be in the group or the bot lacks permission.` });
        }

    } catch (err) {
        console.error('Error ranking interview user:', err);
        await interaction.editReply({ content: '❌ Error occurred while ranking.' });
    }

    return true;
}

module.exports = { createServer, handleRankButton };