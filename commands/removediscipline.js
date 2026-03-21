const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removediscipline')
    .setDescription('Remove a strike, termination, or blacklist entry from a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of discipline to remove')
        .setRequired(true)
        .addChoices(
          { name: 'Strike', value: 'strike' },
          { name: 'Termination', value: 'termination' },
          { name: 'Blacklist', value: 'blacklist' }
        ))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removal')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Strike number (required if removing a strike)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const type = interaction.options.getString('type');
      const number = interaction.options.getInteger('number');
      const reason = interaction.options.getString('reason');

      const record = await StaffRecord.findById(user.id);
      if (!record) {
        return interaction.editReply({ content: '❌ This user has no discipline records.' });
      }

      if (type === 'strike') {
        const activeStrikes = record.strikes.filter(s => !s.removed);
        if (!number || number < 1 || number > activeStrikes.length) {
          return interaction.editReply({ content: '❌ Invalid strike number.' });
        }
        const strike = activeStrikes[number - 1];
        strike.removed = true;
        strike.removedBy = interaction.user.id;
        strike.removedReason = reason;
        strike.removedAt = new Date().toISOString();

      } else if (type === 'termination') {
        if (!record.terminations || record.terminations.length === 0) {
          return interaction.editReply({ content: '❌ No terminations found for this user.' });
        }
        const term = record.terminations[record.terminations.length - 1];
        term.removed = true;
        term.removedBy = interaction.user.id;
        term.removedReason = reason;
        term.removedAt = new Date().toISOString();

      } else if (type === 'blacklist') {
        if (!record.blacklists || record.blacklists.length === 0) {
          return interaction.editReply({ content: '❌ No blacklists found for this user.' });
        }
        const bl = record.blacklists[record.blacklists.length - 1];
        bl.removed = true;
        bl.removedBy = interaction.user.id;
        bl.removedReason = reason;
        bl.removedAt = new Date().toISOString();
      }

      await record.save();

      const embed = new EmbedBuilder()
        .setTitle('✅ Discipline Removed')
        .setColor(0x2ECC71)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Member', value: user.username },
          { name: '🗂️ Type', value: type.charAt(0).toUpperCase() + type.slice(1) },
          { name: '📝 Reason for Removal', value: reason }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ Successfully removed ${type} record from ${user.tag}.` });

    } catch (err) {
      console.error('Error in /removediscipline command:', err);
      try { await interaction.editReply({ content: '❌ Error removing discipline.' }); } catch {}
    }
  }
};