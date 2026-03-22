const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { activeSessions, sections, quizQuestions } = require('./startmodtraining');

const REQUIRED_ROLE_ID = '1464028127440273458';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trainingstatus')
    .setDescription('Check the training status of a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to check')
        .setRequired(true)),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
    const roleExists = interaction.guild.roles.cache.has(REQUIRED_ROLE_ID);
    if (roleExists && !member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
    }

    const user = interaction.options.getUser('user');
    const session = activeSessions.get(user.id);

    if (!session) {
      return interaction.editReply({ content: `❌ ${user.tag} does not have an active training session.` });
    }

    let statusText = '';
    let progressText = '';

    if (session.phase === 'sections') {
      statusText = '📖 Reading Sections';
      progressText = `Section **${session.section + 1}** of **${sections.length}**\n*${sections[session.section].title}*`;
    } else if (session.phase === 'quiz') {
      statusText = '📝 Taking Quiz';
      progressText = `Question **${session.quizIndex + 1}** of **${quizQuestions.length}**\nCurrent Score: **${session.score}**`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 Training Status — ${user.tag}`)
      .setColor(0x3498DB)
      .addFields(
        { name: '📍 Current Phase', value: statusText },
        { name: '📈 Progress', value: progressText },
        { name: '🔒 Session Locked', value: session.locked ? '⛔ Yes — waiting for staff to resolve help request' : '✅ No' }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};