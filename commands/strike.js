<<<<<<< HEAD
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strike')
    .setDescription('Issue a strike to a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      // Find or create the user's record in MongoDB
      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
      }

      record.rank = rank;
      record.strikes.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        removed: false
      });

      await record.save();

      const activeStrikes = record.strikes.filter(s => !s.removed).length;

      const dmMessage = `# 📢 Strike notice\n\nGreetings, ${user}\n\nYou have received an official strike at **Kavià Café**. This is your **${activeStrikes}${activeStrikes === 1 ? 'st' : activeStrikes === 2 ? 'nd' : 'th'} strike**.\n\n> 🗒️ *Reason:* **${reason}**\n\nPlease reach out to HR if you need clarification.`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('🛑 Staff Strike Issued')
        .setDescription('A strike has been issued to a staff member.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Striked', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📊 Current Strikes', value: String(activeStrikes) },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been issued a strike.` });

    } catch (err) {
      console.error('Error in /strike command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
=======
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strike')
    .setDescription('Issue a strike to a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      // Find or create the user's record in MongoDB
      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
      }

      record.rank = rank;
      record.strikes.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        removed: false
      });

      await record.save();

      const activeStrikes = record.strikes.filter(s => !s.removed).length;

      const dmMessage = `# 📢 Strike notice\n\nGreetings, ${user}\n\nYou have received an official strike at **Kavià Café**. This is your **${activeStrikes}${activeStrikes === 1 ? 'st' : activeStrikes === 2 ? 'nd' : 'th'} strike**.\n\n> 🗒️ *Reason:* **${reason}**\n\nPlease reach out to HR if you need clarification.`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('🛑 Staff Strike Issued')
        .setDescription('A strike has been issued to a staff member.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Striked', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📊 Current Strikes', value: String(activeStrikes) },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been issued a strike.` });

    } catch (err) {
      console.error('Error in /strike command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
>>>>>>> 8b86fc578aa2a34d5ae210dc7b7fd480f3fce44e
};