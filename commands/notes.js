const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1484973859513045224';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notes')
    .setDescription('Add or view private internal notes on a staff member')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Add or view notes')
        .setRequired(true)
        .addChoices(
          { name: 'Add Note', value: 'add' },
          { name: 'View Notes', value: 'view' }
        ))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('note')
        .setDescription('The note to add (only required when adding)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
    }

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('user');
      const noteText = interaction.options.getString('note');

      let record = await StaffRecord.findById(user.id);

      if (action === 'add') {
        if (!noteText) {
          return interaction.editReply({ content: '❌ You must provide a note to add.' });
        }

        if (!record) {
          record = new StaffRecord({ _id: user.id, strikes: [], terminations: [], blacklists: [], notes: [] });
        }

        if (!record.notes) record.notes = [];

        record.notes.push({
          note: noteText,
          date: new Date().toISOString(),
          addedBy: { id: interaction.user.id, username: interaction.user.username }
        });

        await record.save();

        const embed = new EmbedBuilder()
          .setTitle('📝 Note Added')
          .setColor(0x3498DB)
          .addFields(
            { name: '👮 Added By', value: interaction.user.username },
            { name: '⚡ About', value: user.username },
            { name: '📝 Note', value: noteText }
          )
          .setFooter({ text: 'Human Resources Department' })
          .setTimestamp();

        const logChannel = await interaction.client.channels.fetch(logChannelID);
        if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

        await interaction.editReply({ content: `✅ Note added to ${user.tag}'s record.` });

      } else if (action === 'view') {
        if (!record || !record.notes || record.notes.length === 0) {
          return interaction.editReply({ content: '❌ No notes found for this user.' });
        }

        const embed = new EmbedBuilder()
          .setTitle(`📝 Notes for ${user.tag}`)
          .setColor(0x3498DB)
          .setTimestamp();

        for (const [index, n] of record.notes.entries()) {
          embed.addFields({
            name: `Note #${index + 1} — ${n.addedBy?.username || 'Unknown'} — ${n.date.slice(0, 10)}`,
            value: n.note
          });
        }

        await interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error('Error in /notes command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};