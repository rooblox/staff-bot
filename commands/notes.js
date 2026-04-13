const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notes')
    .setDescription('Add, view or remove private internal notes on a staff member')
    .addStringOption(option =>
      option.setName('action').setDescription('Add, view or remove notes').setRequired(true)
        .addChoices(
          { name: 'Add Note', value: 'add' },
          { name: 'View Notes', value: 'view' },
          { name: 'Remove Note', value: 'remove' }
        ))
    .addUserOption(option =>
      option.setName('user').setDescription('Staff member').setRequired(true))
    .addStringOption(option =>
      option.setName('note').setDescription('The note to add (only required when adding)').setRequired(false))
    .addIntegerOption(option =>
      option.setName('number').setDescription('Note number to remove (only required when removing)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
      const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('user');
      const noteText = interaction.options.getString('note');
      const number = interaction.options.getInteger('number');

      let record = await StaffRecord.findById(user.id);

      if (action === 'add') {
        if (!noteText) return interaction.editReply({ content: '❌ You must provide a note to add.' });

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

      } else if (action === 'remove') {
        if (!record || !record.notes || record.notes.length === 0) {
          return interaction.editReply({ content: '❌ No notes found for this user.' });
        }

        if (!number || number < 1 || number > record.notes.length) {
          return interaction.editReply({ content: `❌ Invalid note number. This user has ${record.notes.length} note(s).` });
        }

        const removedNote = record.notes[number - 1];
        record.notes.splice(number - 1, 1);
        await record.save();

        const embed = new EmbedBuilder()
          .setTitle('🗑️ Note Removed')
          .setColor(0xE74C3C)
          .addFields(
            { name: '👮 Removed By', value: interaction.user.username },
            { name: '⚡ About', value: user.username },
            { name: '📝 Removed Note', value: removedNote.note }
          )
          .setFooter({ text: 'Human Resources Department' })
          .setTimestamp();

        const logChannel = await interaction.client.channels.fetch(logChannelID);
        if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

        await interaction.editReply({ content: `✅ Note #${number} removed from ${user.tag}'s record.` });
      }

    } catch (err) {
      console.error('Error in /notes command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};