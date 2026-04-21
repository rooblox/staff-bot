const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const REQUIRED_ROLE_ID_MOD = '1495951292605009930';
const REQUIRED_GUILD_ID_MOD = '1301333604315561994';
const REQUIRED_ROLE_ID_HR = '1484973859513045224';
const REQUIRED_GUILD_ID_HR = '1434556801096876034';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trainingstatus')
        .setDescription('Check the training status of a user')
        .addUserOption(option =>
            option.setName('user').setDescription('User to check').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            let hasPerms = false;
            const modGuild = await client.guilds.fetch(REQUIRED_GUILD_ID_MOD);
            const modMember = await modGuild.members.fetch(interaction.user.id).catch(() => null);
            if (modMember && modMember.roles.cache.has(REQUIRED_ROLE_ID_MOD)) hasPerms = true;

            if (!hasPerms) {
                const hrGuild = await client.guilds.fetch(REQUIRED_GUILD_ID_HR);
                const hrMember = await hrGuild.members.fetch(interaction.user.id).catch(() => null);
                if (hrMember && hrMember.roles.cache.has(REQUIRED_ROLE_ID_HR)) hasPerms = true;
            }

            if (!hasPerms) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const user = interaction.options.getUser('user');
            const { activeSessions } = require('./starttraining');
            const session = activeSessions.get(user.id);

            if (!session) {
                return interaction.editReply({ content: `❌ **${user.tag}** does not have an active training session.` });
            }

            let statusText = '';
            let progressText = '';

            if (session.phase === 'sections') {
                statusText = session.awaitingAgeVerif ? '🔒 Awaiting Age Verification' : '📖 Reading Sections';
                progressText = `Section **${session.section + 1}** of **${session.trainingConfig.sections.length}**\n*${session.trainingConfig.sections[session.section].title}*`;
            } else if (session.phase === 'quiz') {
                statusText = '📝 Taking Quiz';
                progressText = `Question **${session.quizIndex + 1}** of **${session.trainingConfig.quiz.length}**\nCurrent Score: **${session.score}**`;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Training Status — ${user.tag}`)
                .setColor(0x3498DB)
                .addFields(
                    { name: '🏢 Department', value: session.department },
                    { name: '📖 Training', value: session.training },
                    { name: '📍 Current Phase', value: statusText },
                    { name: '📈 Progress', value: progressText },
                    { name: '🔒 Session Locked', value: session.locked ? '⛔ Yes — waiting for staff to resolve help request' : '✅ No' },
                    { name: '🪪 Age Verification', value: session.awaitingAgeVerif ? '⏳ Awaiting staff review' : '✅ Not pending' }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /trainingstatus:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};