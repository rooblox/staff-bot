const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const REQUIRED_ROLE_ID_MOD = '1495951292605009930';
const REQUIRED_GUILD_ID_MOD = '1301333604315561994';
const REQUIRED_ROLE_ID_HR = '1484973859513045224';
const REQUIRED_GUILD_ID_HR = '1434556801096876034';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('endtraining')
        .setDescription('Force end a training session for a user')
        .addUserOption(option =>
            option.setName('user').setDescription('User whose training to end').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            // Check perms in either dept server
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

            if (!activeSessions.has(user.id)) {
                return interaction.editReply({ content: `❌ **${user.tag}** does not have an active training session.` });
            }

            const session = activeSessions.get(user.id);

            // Clear any age verif reping timeout
            if (session.ageVerifRepingTimeout) clearTimeout(session.ageVerifRepingTimeout);

            activeSessions.delete(user.id);

            try {
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🛑 Training Ended')
                            .setDescription(`Hello, ${user},\n\nYour **${session.training}** training session for the **${session.department}** department has been **ended** by a staff member.\n\nIf you have any questions or concerns, please reach out to a member of our team.\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
                            .setColor(0xE74C3C)
                            .setTimestamp()
                    ]
                });
            } catch {}

            // Log
            try {
                const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🛑 Training Session Force Ended')
                                .setColor(0xE74C3C)
                                .addFields(
                                    { name: '👤 Trainee', value: `${user.tag} (${user.id})` },
                                    { name: '🏢 Department', value: session.department },
                                    { name: '📖 Training', value: session.training },
                                    { name: '👮 Ended By', value: interaction.user.tag },
                                    { name: '📍 Phase', value: session.phase === 'sections' ? `Section ${session.section + 1}` : `Quiz Q${session.quizIndex + 1}` }
                                )
                                .setTimestamp()
                        ]
                    });
                }
            } catch {}

            await interaction.editReply({ content: `✅ Training session for **${user.tag}** has been ended.` });

        } catch (err) {
            console.error('Error in /endtraining:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};