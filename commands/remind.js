const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Reminder } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a reminder that will be DMed to you')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What do you want to be reminded about?')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Days from now')
        .setRequired(false)
        .setMinValue(0))
    .addIntegerOption(option =>
      option.setName('hours')
        .setDescription('Hours from now')
        .setRequired(false)
        .setMinValue(0))
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('Minutes from now')
        .setRequired(false)
        .setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const message = interaction.options.getString('message');
      const days = interaction.options.getInteger('days') || 0;
      const hours = interaction.options.getInteger('hours') || 0;
      const minutes = interaction.options.getInteger('minutes') || 0;

      const totalMs = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);

      if (totalMs === 0) {
        return interaction.editReply({ content: '❌ Please provide at least one time value (days, hours, or minutes).' });
      }

      const fireAt = new Date(Date.now() + totalMs);

      const reminder = new Reminder({
        userId: interaction.user.id,
        message,
        fireAt,
        createdAt: new Date()
      });
      await reminder.save();

      scheduleReminder(reminder, interaction.client);

      const timestamp = `<t:${Math.floor(fireAt.getTime() / 1000)}:F>`;

      const embed = new EmbedBuilder()
        .setTitle('⏰ Reminder Set')
        .setColor(0x2ECC71)
        .addFields(
          { name: '👮 Set By', value: interaction.user.username },
          { name: '📝 Reminder', value: message },
          { name: '🕒 Fires At', value: timestamp }
        )
        .setFooter({ text: 'Kavia Cafe • Reminders' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ Reminder set! I'll DM you on ${timestamp} about:\n> ${message}` });

    } catch (err) {
      console.error('Error in /remind command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};

function scheduleReminder(reminder, client) {
    const delay = new Date(reminder.fireAt).getTime() - Date.now();
    if (delay <= 0) return;

    setTimeout(async () => {
        try {
            const user = await client.users.fetch(reminder.userId);
            await user.send({
                content: `⏰ **Reminder!**\n> ${reminder.message}`
            });
            await Reminder.findByIdAndDelete(reminder._id);
        } catch (err) {
            console.error('Failed to send reminder:', err);
        }
    }, delay);
}

module.exports.scheduleReminder = scheduleReminder;