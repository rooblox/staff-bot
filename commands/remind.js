const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Reminder } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set, manage or remove reminders')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('What do you want to do?')
        .setRequired(true)
        .addChoices(
          { name: 'Set Reminder', value: 'set' },
          { name: 'Remove Recurring Reminder', value: 'remove' },
          { name: 'List My Reminders', value: 'list' }
        ))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What is the reminder about? (required for set)')
        .setRequired(false))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Remind another user instead of yourself (optional)')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Days from now (for one-time reminders)')
        .setRequired(false)
        .setMinValue(0))
    .addIntegerOption(option =>
      option.setName('hours')
        .setDescription('Hours from now (for one-time reminders)')
        .setRequired(false)
        .setMinValue(0))
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('Minutes from now (for one-time reminders)')
        .setRequired(false)
        .setMinValue(1))
    .addStringOption(option =>
      option.setName('recurring')
        .setDescription('Make this a recurring reminder (optional)')
        .setRequired(false)
        .addChoices(
          { name: 'Daily', value: 'daily' },
          { name: 'Every 3 Days', value: '3days' },
          { name: 'Weekly', value: 'weekly' },
          { name: 'Every 2 Weeks', value: '2weeks' },
          { name: 'Every 3 Weeks', value: '3weeks' },
          { name: 'Monthly', value: 'monthly' }
        ))
    .addStringOption(option =>
      option.setName('reminder_id')
        .setDescription('Reminder ID to remove (use /remind list to find it)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const action = interaction.options.getString('action');

      // ========== LIST ==========
      if (action === 'list') {
        const reminders = await Reminder.find({ userId: interaction.user.id });

        if (!reminders || reminders.length === 0) {
          return interaction.editReply({ content: '❌ You have no active reminders.' });
        }

        const embed = new EmbedBuilder()
          .setTitle('⏰ Your Active Reminders')
          .setColor(0x3498DB)
          .setTimestamp();

        for (const r of reminders) {
          const fireAt = `<t:${Math.floor(new Date(r.fireAt).getTime() / 1000)}:F>`;
          const recurringText = r.recurring ? `🔁 Repeats: ${r.recurring}` : '🔂 One-time';
          embed.addFields({
            name: `ID: ${r._id}`,
            value: `**Message:** ${r.message}\n**Fires At:** ${fireAt}\n${recurringText}`
          });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // ========== REMOVE ==========
      if (action === 'remove') {
        const reminderId = interaction.options.getString('reminder_id');

        if (!reminderId) {
          return interaction.editReply({ content: '❌ Please provide a reminder ID. Use `/remind list` to find your reminder IDs.' });
        }

        const reminder = await Reminder.findById(reminderId);

        if (!reminder) {
          return interaction.editReply({ content: '❌ Reminder not found. Make sure you copied the ID correctly.' });
        }

        if (reminder.userId !== interaction.user.id) {
          return interaction.editReply({ content: '❌ You can only remove your own reminders.' });
        }

        await Reminder.findByIdAndDelete(reminderId);
        return interaction.editReply({ content: `✅ Recurring reminder removed successfully.` });
      }

      // ========== SET ==========
      if (action === 'set') {
        const message = interaction.options.getString('message');
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const days = interaction.options.getInteger('days') || 0;
        const hours = interaction.options.getInteger('hours') || 0;
        const minutes = interaction.options.getInteger('minutes') || 0;
        const recurring = interaction.options.getString('recurring');

        if (!message) {
          return interaction.editReply({ content: '❌ Please provide a message for your reminder.' });
        }

        const recurringMs = {
          daily: 24 * 60 * 60 * 1000,
          '3days': 3 * 24 * 60 * 60 * 1000,
          weekly: 7 * 24 * 60 * 60 * 1000,
          '2weeks': 14 * 24 * 60 * 60 * 1000,
          '3weeks': 21 * 24 * 60 * 60 * 1000,
          monthly: 30 * 24 * 60 * 60 * 1000
        };

        let totalMs = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);

        // If recurring and no time set, use the recurring interval as the first fire time
        if (totalMs === 0 && recurring) {
          totalMs = recurringMs[recurring];
        }

        if (totalMs === 0) {
          return interaction.editReply({ content: '❌ Please provide a time or select a recurring option.' });
        }

        const fireAt = new Date(Date.now() + totalMs);

        const reminder = new Reminder({
          userId: targetUser.id,
          message,
          fireAt,
          createdAt: new Date(),
          recurring: recurring || null,
          recurringMs: recurring ? recurringMs[recurring] : null,
          createdBy: interaction.user.id
        });

        await reminder.save();
        scheduleReminder(reminder, interaction.client);

        const timestamp = `<t:${Math.floor(fireAt.getTime() / 1000)}:F>`;
        const recurringText = recurring ? `\n🔁 Repeats: **${interaction.options.getString('recurring')}**` : '';
        const targetText = targetUser.id !== interaction.user.id ? `\n👤 Reminding: **${targetUser.tag}**` : '';

        const embed = new EmbedBuilder()
          .setTitle('⏰ Reminder Set')
          .setColor(0x2ECC71)
          .addFields(
            { name: '👮 Set By', value: interaction.user.username },
            { name: '👤 Reminding', value: targetUser.username },
            { name: '📝 Reminder', value: message },
            { name: '🕒 Fires At', value: timestamp },
            { name: '🔁 Recurring', value: recurring ? recurring : 'No' }
          )
          .setFooter({ text: 'Kavia Cafe • Reminders' })
          .setTimestamp();

        const logChannel = await interaction.client.channels.fetch(logChannelID);
        if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

        await interaction.editReply({
          content: `✅ Reminder set! I'll DM ${targetUser.id === interaction.user.id ? 'you' : targetUser.tag} on ${timestamp} about:\n> ${message}${recurringText}${targetText}`
        });
      }

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
        embeds: [
          new EmbedBuilder()
            .setTitle('⏰ Reminder!')
            .setDescription(`${reminder.message}`)
            .setColor(0x3498DB)
            .setFooter({ text: reminder.recurring ? `🔁 This is a recurring reminder` : 'Kavia Cafe • Reminders' })
            .setTimestamp()
        ]
      });

      if (reminder.recurring && reminder.recurringMs) {
        // Update next fire time and reschedule
        reminder.fireAt = new Date(Date.now() + reminder.recurringMs);
        await Reminder.findByIdAndUpdate(reminder._id, { fireAt: reminder.fireAt });
        scheduleReminder(reminder, client);
      } else {
        await Reminder.findByIdAndDelete(reminder._id);
      }
    } catch (err) {
      console.error('Failed to send reminder:', err);
    }
  }, delay);
}

module.exports.scheduleReminder = scheduleReminder;