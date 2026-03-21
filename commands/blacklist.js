const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to blacklist')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for blacklist')
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
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, strikes: [], terminations: [], blacklists: [] });
      }

      record.blacklists.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        removed: false
      });

      await record.save();

      const dmMessage = `# ⛔ Blacklist Notice\n\nGreetings, ${user},\n\nI regret to inform you that you have been **blacklisted** following actions at **Kavià Café**.\n\n> 🗒️ *Reason:* **${reason}**\n\nIf you would like clarification, please open a support ticket in the server.\n\n*Signed,*\n**${interaction.user.username}**\n|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⛔ Staff Blacklisted')
        .setDescription('A staff member has been blacklisted.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Blacklisted Member', value: user.username },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been blacklisted.` });

    } catch (err) {
      console.error('Error in /blacklist command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};