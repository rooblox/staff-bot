const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { activeSessions } = require('./startmodtraining');

const REQUIRED_ROLE_ID = '1495951292605009930';
const MAIN_GUILD_ID = '1301333604315561994';
const LOG_CHANNEL_ID = '1485349514486480947';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endtraining')
    .setDescription('Force end a training session for a user')
    .addUserOption(option =>
      option.setName('user').setDescription('User whose training to end').setRequired(true)),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
    const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
    if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
    }

    const user = interaction.options.getUser('user');

    if (!activeSessions.has(user.id)) {
      return interaction.editReply({ content: `❌ ${user.tag} does not have an active training session.` });
    }

    activeSessions.delete(user.id);

    try {
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('<:emoji_1:1464065515579248854>  Training Ended')
            .setDescription(`Hello, ${user},\n\nYour moderation training session has been **ended** by a staff member. If you have any questions or concerns, please reach out to a member of our team.\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
            .setColor(0xE74C3C)
            .setTimestamp()
        ]
      });
    } catch {}

    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel?.isTextBased()) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🛑 Training Session Ended')
            .setColor(0xE74C3C)
            .addFields(
              { name: '👤 Trainee', value: `${user.tag} (${user.id})` },
              { name: '👮 Ended By', value: `${interaction.user.tag}` }
            )
            .setTimestamp()
        ]
      });
    }

    await interaction.editReply({ content: `✅ Training session for ${user.tag} has been ended.` });
  }
};