const { SlashCommandBuilder, ActivityType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Change the bot\'s status/activity')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of activity')
        .setRequired(true)
        .addChoices(
          { name: 'Playing', value: 'PLAYING' },
          { name: 'Watching', value: 'WATCHING' },
          { name: 'Listening', value: 'LISTENING' },
          { name: 'Streaming', value: 'STREAMING' }
        ))
    .addStringOption(option =>
      option.setName('text')
        .setDescription('The status text')
        .setRequired(true)),

  async execute(interaction) {
    const typeStr = interaction.options.getString('type');
    const text = interaction.options.getString('text');

    // Map string to Discord.js ActivityType
    const typeMap = {
      PLAYING: ActivityType.Playing,
      WATCHING: ActivityType.Watching,
      LISTENING: ActivityType.Listening,
      STREAMING: ActivityType.Streaming
    };

    try {
      await interaction.client.user.setActivity(text, { type: typeMap[typeStr] });

      // Use flags instead of ephemeral: true
      await interaction.reply({
        content: `✅ Bot status updated to **${typeStr.toLowerCase()} ${text}**.`,
        flags: 64
      });
    } catch (err) {
      console.error('Error updating bot status:', err);
      await interaction.reply({
        content: '❌ Failed to update bot status.',
        flags: 64
      });
    }
  }
};
