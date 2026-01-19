const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const STAFF_FILE = path.join(__dirname, '../staffDiscipline.json'); // Use shared cache file

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removediscipline')
    .setDescription('Remove a strike, termination, or blacklist entry from a staff member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
      const staffRoleID = process.env.STAFF_ROLE_ID;
      const logChannelID = process.env.LOG_CHANNEL_ID;

      if (!interaction.member.roles.cache.has(staffRoleID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const user = interaction.options.getUser('user');
      const type = interaction.options.getString('type');
      const number = interaction.options.getInteger('number');
      const reason = interaction.options.getString('reason');

      const cache = interaction.client.staffDisciplineCache;

      if (!cache[user.id]) {
        return interaction.editReply({ content: '❌ This user has no discipline records.' });
      }

      const record = cache[user.id];
      let removedEntry;

      if (type === 'strike') {
        const activeStrikes = record.strikes?.filter(s => !s.removed) || [];
        if (!number || number < 1 || number > activeStrikes.length) {
          return interaction.editReply({ content: '❌ Invalid strike number.' });
        }

        removedEntry = activeStrikes[number - 1];
        removedEntry.removed = true;
        removedEntry.removedBy = interaction.user.id;
        removedEntry.removedReason = reason;
        removedEntry.removedAt = new Date().toISOString();

      } else if (type === 'termination') {
        if (!record.terminations || record.terminations.length === 0) {
          return interaction.editReply({ content: '❌ No terminations found for this user.' });
        }

        removedEntry = record.terminations.pop();
        removedEntry.removed = true;
        removedEntry.removedBy = interaction.user.id;
        removedEntry.removedReason = reason;
        removedEntry.removedAt = new Date().toISOString();

      } else if (type === 'blacklist') {
        if (!record.blacklists || record.blacklists.length === 0) {
          return interaction.editReply({ content: '❌ No blacklists found for this user.' });
        }

        removedEntry = record.blacklists.pop();
        removedEntry.removed = true;
        removedEntry.removedBy = interaction.user.id;
        removedEntry.removedReason = reason;
        removedEntry.removedAt = new Date().toISOString();
      }

      // Save cache immediately
      fs.writeFileSync(STAFF_FILE, JSON.stringify(cache, null, 2));

      // Build log embed
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
      if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      }

      await interaction.editReply({
        content: `✅ Successfully removed ${type} record from ${user.tag}.`
      });

    } catch (err) {
      console.error('Error in /removediscipline command:', err);
      try { await interaction.editReply({ content: '❌ Error removing discipline.' }); } catch {}
    }
  }
};
