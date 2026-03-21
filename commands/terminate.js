<<<<<<< HEAD
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('terminate')
    .setDescription('Terminate a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to terminate')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for termination')
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

      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
      }

      record.rank = rank;
      record.terminations.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        proof,
        removed: false
      });

      await record.save();

      const dmMessage = `# 📢 Termination Notice\n\nGreetings, ${user},\n\nWe regret to inform you that you have been **terminated** from **Kavià Café**.\n\n> 🗒️ Reason: **${reason}**\n\nIf you wish to appeal this decision, please open a support ticket in our main server.\n\n*Signed,*\n**${interaction.user.username}**\n|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⚡ Staff Terminated')
        .setDescription('A staff member has been terminated.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Terminated', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been terminated.` });

    } catch (err) {
      console.error('Error in /terminate command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
=======
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('terminate')
    .setDescription('Terminate a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to terminate')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for termination')
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

      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
      }

      record.rank = rank;
      record.terminations.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        proof,
        removed: false
      });

      await record.save();

      const dmMessage = `# 📢 Termination Notice\n\nGreetings, ${user},\n\nWe regret to inform you that you have been **terminated** from **Kavià Café**.\n\n> 🗒️ Reason: **${reason}**\n\nIf you wish to appeal this decision, please open a support ticket in our main server.\n\n*Signed,*\n**${interaction.user.username}**\n|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⚡ Staff Terminated')
        .setDescription('A staff member has been terminated.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Terminated', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been terminated.` });

    } catch (err) {
      console.error('Error in /terminate command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
>>>>>>> 8b86fc578aa2a34d5ae210dc7b7fd480f3fce44e
};