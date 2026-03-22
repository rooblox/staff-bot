const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1484973859513045224';

const DEPARTMENTS = [
  { name: 'SHR', value: 'SHR' },
  { name: 'PR Member', value: 'PR Member' },
  { name: 'MR Member', value: 'MR Member' },
  { name: 'HR Member', value: 'HR Member' },
  { name: 'Media Team', value: 'Media Team' },
  { name: 'Development Member', value: 'Development Member' },
  { name: 'Development Tester', value: 'Development Tester' },
  { name: 'Human Resources', value: 'Human Resources' },
];

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
      option.setName('department')
        .setDescription('Your department')
        .setRequired(true)
        .addChoices(...DEPARTMENTS))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const department = interaction.options.getString('department');
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

      const dmMessage = `# ⛔ Blacklist Notice
Greetings, ${user},
I regret to inform you that you have been **blacklisted** following actions at **Kavià Café**.
> 🗒️ **Reason →** *${reason}*
If you would like clarification, please open a support ticket in the server.
***Sincerely,***
**${interaction.user.username} || ${department}**`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⛔ Staff Blacklisted')
        .setDescription('A staff member has been blacklisted.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Blacklisted Member', value: user.username },
          { name: '🏢 Department', value: department },
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